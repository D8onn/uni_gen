import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createHabitat } from "../src/utility/ecology/habitat.js";
import {
	createPopulation,
	DEFAULT_PRODUCER,
	EVOLVING_PRODUCER,
	getDispersalRegions,
	getPopulationSummary,
	stepPopulation,
	summarizeGroups,
} from "../src/utility/ecology/population.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";

// Cells at temperature and moisture 1; `links` lists each cell's neighbors and `water` the water cells.
function graphWorld(links, water = []) {
	return {
		cells: links.map((neighbors, id) => ({
			id,
			latitude: 0,
			temperature: 1,
			moisture: 1,
			biome: water.includes(id) ? "Water" : "Grassland",
			neighbors,
		})),
	};
}

// Cells in a line (each linked to the next).
function lineWorld(count, water = []) {
	const links = Array.from({ length: count }, (_, id) => [id - 1, id + 1].filter((n) => n >= 0 && n < count));
	return graphWorld(links, water);
}

function setup(world, options) {
	return { habitat: createHabitat(world), population: createPopulation(world, options) };
}

const FERTILE = { mortalityChance: 0, reproductionChance: 1 };

// Puts every organism in `cellId`, ready to reproduce.
function gather(population, cellId) {
	for (const organism of population.organisms) {
		organism.cellId = cellId;
		organism.biomass = 0.9;
	}
}

test("without dispersal, populations reproduce the WG-11 results exactly", () => {
	assert.equal(DEFAULT_PRODUCER.dispersalChance, 0);
	const world = createGlobeMap({ poleToPoleCells: 12, seed: 3 });
	// Hashes recorded from the WG-11 module (seed 9, 40 founders, 200 ticks) before dispersal existed.
	const expected = [
		[{}, "1c96cbe829c0d700a176ef8322c03f4480b47785b3c48c66eb1457f46f353267"],
		[{ dispersalChance: 0 }, "1c96cbe829c0d700a176ef8322c03f4480b47785b3c48c66eb1457f46f353267"],
		[EVOLVING_PRODUCER, "d9aa8d801d73e15176764c124ff3cf201cfeeba95c8f739e22c4528c6500ff52"],
	];
	for (const [species, hash] of expected) {
		const { habitat, population } = setup(world, { seed: 9, initialCount: 40, species });
		stepPopulation(population, habitat, 200);
		const { organisms, totals, nextId } = population;
		const state = JSON.stringify({ organisms, totals, nextId, resources: habitat.resources });
		assert.equal(createHash("sha256").update(state).digest("hex"), hash, JSON.stringify(species));
		assert.deepEqual(population.dispersals, { lastTick: 0, total: 0 });
		assert.deepEqual(
			population.habitable,
			world.cells.map((cell) => cell.biome !== "Water")
		);
	}
});

test("dispersing offspring move to a land neighbor of the parent's cell, never onto water", () => {
	// Cell 0 links to land cells 3, 1, 2 and water cell 4; cell 5 is unreachable.
	const world = graphWorld([[3, 1, 4, 2], [0], [0], [0], [0], []], [4]);
	const species = { ...FERTILE, dispersalChance: 1, maxPerCell: 100 };
	const { habitat, population } = setup(world, { initialCount: 60, species });
	gather(population, 0);
	stepPopulation(population, habitat);
	const offspring = population.organisms.filter(({ parentId }) => parentId !== null);
	assert.equal(offspring.length, 60);
	const destinations = new Set(offspring.map(({ cellId }) => cellId));
	assert.deepEqual([...destinations].sort(), [1, 2, 3]);
	assert.deepEqual(population.dispersals, { lastTick: 60, total: 60 });
	assert.deepEqual(getPopulationSummary(population).dispersals, { lastTick: 60, total: 60 });

	// Parents stay put, and the same seed gives the same destinations.
	assert.ok(population.organisms.filter(({ parentId }) => parentId === null).every(({ cellId }) => cellId === 0));
	const again = setup(world, { initialCount: 60, species });
	gather(again.population, 0);
	stepPopulation(again.population, again.habitat);
	assert.deepEqual(again.population, population);
});

test("offspring stay home with no land neighbor or a full target, and are blocked when both cells are full", () => {
	// Cell 0 is surrounded by water.
	const island = setup(graphWorld([[1], [0]], [1]), { initialCount: 3, species: { ...FERTILE, dispersalChance: 1 } });
	gather(island.population, 0);
	stepPopulation(island.population, island.habitat);
	assert.equal(island.population.lastTick.births, 3);
	assert.ok(island.population.organisms.every(({ cellId }) => cellId === 0));
	assert.equal(island.population.dispersals.lastTick, 0);

	// Cell 1 is at its cap, so the offspring fall back to the parent's cell 0.
	const species = { ...FERTILE, dispersalChance: 1, maxPerCell: 4 };
	const crowded = setup(lineWorld(2), { initialCount: 6, species });
	gather(crowded.population, 0);
	crowded.population.organisms.slice(2).forEach((organism) => (organism.cellId = 1));
	stepPopulation(crowded.population, crowded.habitat);
	assert.equal(crowded.population.lastTick.births, 2);
	assert.deepEqual(
		crowded.population.organisms.filter(({ parentId }) => parentId !== null).map(({ cellId }) => cellId),
		[0, 0]
	);
	assert.equal(crowded.population.dispersals.lastTick, 0);

	// With both cells full, births are blocked and the parents keep their biomass.
	const full = setup(lineWorld(2), { initialCount: 8, species });
	gather(full.population, 0);
	full.population.organisms.slice(4).forEach((organism) => (organism.cellId = 1));
	const parentBiomass = (state) => state.population.organisms.map(({ biomass }) => biomass);
	stepPopulation(full.population, full.habitat);
	assert.equal(full.population.lastTick.births, 0);
	const unchanged = setup(lineWorld(2), { initialCount: 8, species: { ...species, reproductionChance: 0 } });
	gather(unchanged.population, 0);
	unchanged.population.organisms.slice(4).forEach((organism) => (organism.cellId = 1));
	stepPopulation(unchanged.population, unchanged.habitat);
	assert.deepEqual(parentBiomass(full), parentBiomass(unchanged));
});

test("a population spreads along its land strip over generations but never crosses water", () => {
	// Cells 0-9 and 11-20 are land, joined only through water cell 10.
	const world = lineWorld(21, [10]);
	for (let seed = 1; seed <= 3; seed++) {
		const spreading = setup(world, { seed, initialCount: 5, species: { dispersalChance: 0.2 } });
		gather(spreading.population, 0);
		for (let tick = 1; tick <= 2000; tick++) {
			stepPopulation(spreading.population, spreading.habitat);
			assert.ok(spreading.population.organisms.every(({ cellId }) => cellId < 10), `seed ${seed} tick ${tick}`);
		}
		assert.equal(getPopulationSummary(spreading.population).occupiedCells, 10, `seed ${seed}`);
		assert.ok(spreading.population.dispersals.total > 0);

		const rooted = setup(world, { seed, initialCount: 5 });
		gather(rooted.population, 0);
		stepPopulation(rooted.population, rooted.habitat, 2000);
		assert.ok(rooted.population.organisms.length > 0);
		assert.ok(rooted.population.organisms.every(({ cellId }) => cellId === 0));
	}
});

test("dispersal regions are the connected land areas, and organisms never leave their founders' regions", () => {
	// Land 0-1 and 3-4 are split by water cell 2; cell 5 is isolated land.
	const world = graphWorld([[1], [0, 2], [1, 3], [2, 4], [3], []], [2]);
	const { habitat, population } = setup(world, { initialCount: 1 });
	assert.deepEqual(getDispersalRegions(population, habitat), { regionOfCell: [0, 0, -1, 1, 1, 2], regionCount: 3 });
	assert.throws(() => getDispersalRegions(population, createHabitat(lineWorld(2))), RangeError);

	// This globe has four land regions; the founders all land in the largest.
	const globe = createGlobeMap({ poleToPoleCells: 20, seed: 2 });
	const state = setup(globe, { seed: 4, initialCount: 30, species: { ...EVOLVING_PRODUCER, dispersalChance: 0.3 } });
	const { regionOfCell, regionCount } = getDispersalRegions(state.population, state.habitat);
	assert.equal(regionCount, 4);
	const firstCells = [];
	for (const cell of globe.cells) {
		assert.equal(regionOfCell[cell.id] === -1, cell.biome === "Water");
		if (regionOfCell[cell.id] === -1) continue;
		for (const neighborId of cell.neighbors) {
			if (regionOfCell[neighborId] !== -1) assert.equal(regionOfCell[neighborId], regionOfCell[cell.id]);
		}
		if (firstCells[regionOfCell[cell.id]] === undefined) firstCells[regionOfCell[cell.id]] = cell.id;
	}
	assert.deepEqual(
		firstCells,
		[...firstCells].sort((a, b) => a - b)
	);
	const regionsOf = (organisms) => new Set(organisms.map(({ cellId }) => regionOfCell[cellId]));
	const founded = regionsOf(state.population.organisms);
	assert.ok(founded.size < regionCount);
	stepPopulation(state.population, state.habitat, 300);
	assert.ok(state.population.dispersals.total > 0);
	assert.ok([...regionsOf(state.population.organisms)].every((region) => founded.has(region)));

	// Dispersing populations resume identically after a JSON round trip.
	const run = (ticks) => {
		const run = setup(globe, { seed: 4, initialCount: 30, species: { ...EVOLVING_PRODUCER, dispersalChance: 0.3 } });
		stepPopulation(run.population, run.habitat, ticks);
		return run;
	};
	const resumed = JSON.parse(JSON.stringify(run(150)));
	stepPopulation(resumed.population, resumed.habitat, 150);
	assert.deepEqual(resumed, state);
});

test("group summaries split trait variance into within-group and between-group parts", () => {
	const organism = (cellId, temperatureOptimum, biomass = 0.5) => ({
		cellId,
		biomass,
		traits: { temperatureOptimum, moistureOptimum: 0.5 },
	});
	const population = { organisms: [organism(0, 0.2), organism(1, 0.4, 0.25), organism(2, 0.8), organism(2, 0.8)] };
	const { groups, divergence } = summarizeGroups(population, [0, 0, 1]);
	assert.deepEqual(
		groups.map(({ group, count, totalBiomass, occupiedCells }) => ({ group, count, totalBiomass, occupiedCells })),
		[
			{ group: 0, count: 2, totalBiomass: 0.75, occupiedCells: 2 },
			{ group: 1, count: 2, totalBiomass: 1, occupiedCells: 1 },
		]
	);
	// Group means 0.3 and 0.8 around an overall 0.55; group variances 0.01 and 0.
	const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
	close(groups[0].traits.temperatureOptimum.mean, 0.3);
	close(divergence.temperatureOptimum.within, 0.005);
	close(divergence.temperatureOptimum.between, 0.0625);
	close(divergence.temperatureOptimum.betweenShare, 0.0625 / 0.0675);
	assert.deepEqual(divergence.moistureOptimum, { within: 0, between: 0, betweenShare: null });

	assert.deepEqual(summarizeGroups({ organisms: [] }, [0]), { groups: [], divergence: null });
	assert.throws(() => summarizeGroups(population, [0, 0]), RangeError);
	assert.throws(() => createPopulation(lineWorld(2), { species: { dispersalChance: 1.5 } }), RangeError);
});

test("isolated populations in warm and cold habitats diverge toward their own conditions only under selection", () => {
	// Two 10-cell land strips split by water cell 10 with identical resources; only the temperature condition differs.
	const evolve = (seed, selectionStrength) => {
		const world = lineWorld(21, [10]);
		const habitat = createHabitat(world);
		habitat.conditions.temperature.forEach((_, id) => (habitat.conditions.temperature[id] = id < 10 ? 0.8 : 0.2));
		habitat.conditions.moisture.fill(0.5);
		const species = { ...EVOLVING_PRODUCER, selectionStrength, dispersalChance: 0.1 };
		const population = createPopulation(world, { seed, initialCount: 20, species });
		const { regionOfCell, regionCount } = getDispersalRegions(population, habitat);
		assert.equal(regionCount, 2);
		stepPopulation(population, habitat, 3000);
		const { groups, divergence } = summarizeGroups(population, regionOfCell);
		assert.deepEqual(
			groups.map(({ group, occupiedCells }) => [group, occupiedCells]),
			[
				[0, 10],
				[1, 10],
			],
			`seed ${seed}`
		);
		return {
			warm: groups[0].traits.temperatureOptimum.mean,
			cold: groups[1].traits.temperatureOptimum.mean,
			share: divergence.temperatureOptimum.betweenShare,
		};
	};
	const selected = [];
	const neutral = [];
	for (let seed = 1; seed <= 5; seed++) {
		const run = evolve(seed, 2);
		const control = evolve(seed, 0);
		assert.ok(run.warm > run.cold, `seed ${seed}: warm ${run.warm}, cold ${run.cold}`);
		assert.ok(run.share > control.share, `seed ${seed}: share ${run.share} vs control ${control.share}`);
		selected.push(run);
		neutral.push(control);
	}
	const average = (runs, key) => runs.reduce((total, run) => total + run[key], 0) / runs.length;
	assert.ok(average(selected, "warm") >= 0.55 && average(selected, "cold") <= 0.45);
	assert.ok(average(selected, "share") > 3 * average(neutral, "share"));
});

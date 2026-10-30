import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHabitat } from "../src/utility/ecology/habitat.js";
import {
	createPopulation,
	DEATH_CAUSES,
	DEFAULT_PRODUCER,
	getCellOrganisms,
	getPopulationSummary,
	stepPopulation,
} from "../src/utility/ecology/population.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";

// Lifecycle rules without randomness: no background deaths and no reproduction.
const QUIET = { mortalityChance: 0, reproductionChance: 0 };

// Land cells in a line (each linked to the next).
function lineWorld(cells) {
	return {
		cells: cells.map(({ temperature = 1, moisture = 1, latitude = 0, biome = "Grassland" }, id) => ({
			id,
			latitude,
			temperature,
			moisture,
			biome,
			neighbors: [id - 1, id + 1].filter((neighborId) => neighborId >= 0 && neighborId < cells.length),
		})),
	};
}

function setup(world, options) {
	return { habitat: createHabitat(world), population: createPopulation(world, options) };
}

const close = (actual, expected, message) =>
	assert.ok(Math.abs(actual - expected) < 1e-12, `${message ?? ""} ${actual} != ${expected}`);

test("a population places seeded organisms on land cells without changing the world", () => {
	const world = createGlobeMap({ poleToPoleCells: 12, seed: 3 });
	const before = structuredClone(world);
	const population = createPopulation(world, { seed: 5, initialCount: 60, species: { maxPerCell: 2 } });
	assert.deepEqual(world, before);
	assert.deepEqual(JSON.parse(JSON.stringify(population)), population);
	assert.deepEqual(population.species, { ...DEFAULT_PRODUCER, maxPerCell: 2 });
	assert.equal(population.tick, 0);
	assert.equal(population.nextId, 60);

	const cellCounts = new Map();
	population.organisms.forEach((organism, index) => {
		assert.deepEqual(organism, {
			id: index,
			cellId: organism.cellId,
			biomass: DEFAULT_PRODUCER.offspringBiomass,
			age: 0,
			parentId: null,
			traits: DEFAULT_PRODUCER.founderTraits,
		});
		assert.notEqual(world.cells[organism.cellId].biome, "Water");
		cellCounts.set(organism.cellId, (cellCounts.get(organism.cellId) ?? 0) + 1);
	});
	assert.ok(Math.max(...cellCounts.values()) <= 2);

	const again = createPopulation(world, { seed: 5, initialCount: 60, species: { maxPerCell: 2 } });
	assert.deepEqual(again, population);
	const other = createPopulation(world, { seed: 6, initialCount: 60, species: { maxPerCell: 2 } });
	assert.notDeepEqual(other.organisms, population.organisms);
});

test("an organism takes its demand from the cell and grows by the documented rule", () => {
	const { habitat, population } = setup(lineWorld([{}]), { initialCount: 1, species: QUIET });
	stepPopulation(population, habitat);
	const { uptake, growthRate, maintenance, offspringBiomass } = DEFAULT_PRODUCER;
	close(population.organisms[0].biomass, offspringBiomass * (1 + growthRate - maintenance));
	assert.equal(population.organisms[0].age, 1);
	// The demand is taken before the habitat regenerates once.
	const water = 1 - uptake.water * offspringBiomass;
	close(habitat.resources.water[0], water + 0.1 * (1 - water));
	const nutrients = 1 - uptake.nutrients * offspringBiomass;
	close(habitat.resources.nutrients[0], nutrients + 0.02 * (1 - nutrients));

	// Light (cosine of latitude) scales growth.
	const shaded = setup(lineWorld([{ latitude: Math.PI / 3 }]), { initialCount: 1, species: QUIET });
	stepPopulation(shaded.population, shaded.habitat);
	close(shaded.population.organisms[0].biomass, offspringBiomass * (1 + growthRate * Math.cos(Math.PI / 3) - maintenance));
});

test("scarce resources are shared in proportion to biomass and the limiting resource sets growth", () => {
	const { habitat, population } = setup(lineWorld([{}]), { initialCount: 2, species: QUIET });
	population.organisms[1].biomass = 0.6;
	habitat.resources.nutrients[0] = 0.002;
	stepPopulation(population, habitat);
	const { uptake, growthRate, maintenance } = DEFAULT_PRODUCER;
	const met = 0.002 / (uptake.nutrients * 0.8);
	const factor = 1 + growthRate * met - maintenance;
	close(population.organisms[0].biomass, 0.2 * factor);
	close(population.organisms[1].biomass, 0.6 * factor);
	// Nutrients were used up; only the matching share of water was taken.
	close(habitat.resources.nutrients[0], 0.02);
	const water = 1 - met * uptake.water * 0.8;
	close(habitat.resources.water[0], water + 0.1 * (1 - water));
});

test("organisms starve, age out, die at random, and reproduce by the lifecycle rules", () => {
	// A dry cell has no water, so biomass shrinks by the maintenance rate until it falls below minBiomass.
	const dry = setup(lineWorld([{ moisture: 0 }]), { initialCount: 1, species: QUIET });
	stepPopulation(dry.population, dry.habitat, 27);
	close(dry.population.organisms[0].biomass, 0.2 * 0.95 ** 27);
	stepPopulation(dry.population, dry.habitat);
	assert.equal(dry.population.organisms.length, 0);
	assert.deepEqual(dry.population.lastTick, { births: 0, deaths: { starvation: 1, oldAge: 0, mortality: 0 } });

	const old = setup(lineWorld([{}]), { initialCount: 1, species: { ...QUIET, maxAge: 3 } });
	stepPopulation(old.population, old.habitat, 2);
	assert.equal(old.population.organisms.length, 1);
	stepPopulation(old.population, old.habitat);
	assert.deepEqual(old.population.lastTick.deaths, { starvation: 0, oldAge: 1, mortality: 0 });

	const doomed = setup(lineWorld([{}]), { initialCount: 5, species: { mortalityChance: 1 } });
	stepPopulation(doomed.population, doomed.habitat);
	assert.deepEqual(doomed.population.lastTick, { births: 0, deaths: { starvation: 0, oldAge: 0, mortality: 5 } });

	// Reproduction moves offspringBiomass from the parent into a new organism in the same cell.
	const world = lineWorld([{}, {}]);
	const fertile = setup(world, { initialCount: 1, species: { mortalityChance: 0, reproductionChance: 1 } });
	fertile.population.organisms[0].biomass = 0.7;
	const cellId = fertile.population.organisms[0].cellId;
	stepPopulation(fertile.population, fertile.habitat);
	close(fertile.population.organisms[0].biomass, 0.7 * 1.15 - 0.2);
	assert.deepEqual(fertile.population.organisms[1], {
		id: 1,
		cellId,
		biomass: 0.2,
		age: 0,
		parentId: 0,
		traits: DEFAULT_PRODUCER.founderTraits,
	});
	assert.equal(fertile.population.nextId, 2);
	assert.equal(fertile.population.lastTick.births, 1);
	// The parent is still above the threshold, but the offspring is below it.
	stepPopulation(fertile.population, fertile.habitat);
	assert.deepEqual(fertile.population.organisms.map(({ parentId }) => parentId), [null, 0, 0]);
});

test("the per-cell and global caps admit offspring in parent-id order, and only admitted parents pay", () => {
	const fertile = { mortalityChance: 0, reproductionChance: 1 };
	const crowded = setup(lineWorld([{}]), { initialCount: 3, species: { ...fertile, maxPerCell: 4 } });
	for (const organism of crowded.population.organisms) organism.biomass = 0.9;
	stepPopulation(crowded.population, crowded.habitat);
	assert.deepEqual(
		crowded.population.organisms.map(({ id, parentId }) => [id, parentId]),
		[[0, null], [1, null], [2, null], [3, 0]]
	);
	// Growth stops at maxBiomass before the offspring is split off.
	close(crowded.population.organisms[0].biomass, 1 - 0.2);
	close(crowded.population.organisms[1].biomass, Math.min(1, 0.9 * 1.15));

	const world = lineWorld([{}, {}]);
	const full = setup(world, { initialCount: 2, species: { ...fertile, maxOrganisms: 3, maxPerCell: 1 } });
	assert.notEqual(full.population.organisms[0].cellId, full.population.organisms[1].cellId);
	for (const organism of full.population.organisms) organism.biomass = 0.9;
	full.population.species.maxPerCell = 5;
	stepPopulation(full.population, full.habitat);
	assert.deepEqual(full.population.organisms.map(({ parentId }) => parentId), [null, null, 0]);
});

test("stepping is deterministic under a seed and resumes identically after a JSON round trip", () => {
	const world = createGlobeMap({ poleToPoleCells: 12, seed: 3 });
	const run = (seed, ticks) => {
		const state = setup(world, { seed, initialCount: 40 });
		stepPopulation(state.population, state.habitat, ticks);
		return state;
	};
	const full = run(9, 80);
	assert.deepEqual(run(9, 80), full);
	assert.ok(full.population.totals.births > 0);
	const ids = full.population.organisms.map(({ id }) => id);
	assert.deepEqual(ids, [...ids].sort((a, b) => a - b));

	const half = run(9, 40);
	const resumed = JSON.parse(JSON.stringify(half));
	stepPopulation(resumed.population, resumed.habitat, 40);
	assert.deepEqual(resumed, full);

	assert.notDeepEqual(run(10, 80).population.organisms, full.population.organisms);
});

test("an organism's random draws do not depend on other organisms", () => {
	const species = { mortalityChance: 0.05, reproductionChance: 0 };
	const deathTick = (initialCount) => {
		const world = lineWorld(Array.from({ length: 50 }, () => ({})));
		const { habitat, population } = setup(world, { seed: 4, initialCount, species: { ...species, maxPerCell: 1 } });
		for (let tick = 1; tick <= 200; tick++) {
			stepPopulation(population, habitat);
			if (!population.organisms.some(({ id }) => id === 0)) return tick;
		}
		return null;
	};
	const alone = deathTick(1);
	assert.ok(alone !== null);
	assert.equal(deathTick(30), alone);
});

test("a single uniform cell settles to a bounded, resource-limited population", () => {
	const world = lineWorld([{}]);
	for (let seed = 1; seed <= 20; seed++) {
		const { habitat, population } = setup(world, { seed, initialCount: 2 });
		let previous = getPopulationSummary(population);
		for (let tick = 1; tick <= 500; tick++) {
			stepPopulation(population, habitat);
			const summary = getPopulationSummary(population);
			const deaths = DEATH_CAUSES.reduce((total, cause) => total + summary.lastTick.deaths[cause], 0);
			assert.equal(summary.tick, tick);
			assert.equal(summary.count, previous.count + summary.lastTick.births - deaths);
			assert.ok(summary.count > 0, `seed ${seed} died out at tick ${tick}`);
			assert.ok(summary.totalBiomass <= 10, `seed ${seed} tick ${tick}: ${summary.totalBiomass}`);
			if (tick > 100) {
				// The cap never binds: nutrients run out each tick and only their regrowth remains.
				assert.ok(summary.count < DEFAULT_PRODUCER.maxPerCell);
				assert.ok(habitat.resources.nutrients[0] <= 0.05, `seed ${seed} tick ${tick}`);
			}
			previous = summary;
		}
		assert.ok(previous.totals.births > 0 && previous.totals.deaths.mortality > 0);
	}
});

test("summaries and cell queries inspect a population without exposing its state", () => {
	const world = createGlobeMap({ poleToPoleCells: 12, seed: 3 });
	const { habitat, population } = setup(world, { seed: 2, initialCount: 30 });
	stepPopulation(population, habitat, 25);
	const summary = getPopulationSummary(population);
	assert.equal(summary.count, population.organisms.length);
	assert.equal(summary.occupiedCells, new Set(population.organisms.map(({ cellId }) => cellId)).size);
	close(summary.totalBiomass, population.organisms.reduce((total, { biomass }) => total + biomass, 0));
	assert.equal(summary.totals.births - DEATH_CAUSES.reduce((t, c) => t + summary.totals.deaths[c], 0), summary.count - 30);
	summary.totals.births = -1;
	assert.notEqual(population.totals.births, -1);

	const { cellId } = population.organisms[0];
	const organisms = getCellOrganisms(population, cellId);
	assert.deepEqual(organisms, population.organisms.filter((organism) => organism.cellId === cellId));
	organisms[0].biomass = -1;
	assert.notEqual(population.organisms[0].biomass, -1);
});

test("invalid seeds, counts, species parameters, ticks, and cell ids throw a RangeError", () => {
	const world = lineWorld([{}, {}]);
	for (const options of [
		{ seed: -1 },
		{ seed: 2 ** 32 },
		{ seed: 1.5 },
		{ initialCount: -1 },
		{ initialCount: 0.5 },
		{ initialCount: 2 * DEFAULT_PRODUCER.maxPerCell + 1 },
		{ initialCount: 3, species: { maxOrganisms: 2 } },
		{ species: { size: 1 } },
		{ species: { uptake: { light: 0.1 } } },
		{ species: { uptake: { water: -0.1 } } },
		{ species: { growthRate: 1.5 } },
		{ species: { mortalityChance: Number.NaN } },
		{ species: { maxAge: 0 } },
		{ species: { maxPerCell: 2.5 } },
		{ species: { minBiomass: 0.3 } },
		{ species: { offspringBiomass: 0.6 } },
		{ species: { reproductionBiomass: 1.2 } },
	]) {
		assert.throws(() => createPopulation(world, options), RangeError, JSON.stringify(options));
	}
	assert.throws(() => createPopulation(lineWorld([{ biome: "Water" }]), { initialCount: 1 }), RangeError);

	const { habitat, population } = setup(world, { initialCount: 1 });
	for (const ticks of [-1, 1.5, "2"]) {
		assert.throws(() => stepPopulation(population, habitat, ticks), RangeError);
	}
	assert.throws(() => getCellOrganisms(population, -1), RangeError);
});

test("a full-size globe population steps in reasonable time and stays on land", () => {
	const world = createGlobeMap({ poleToPoleCells: 80, seed: 12345 });
	assert.equal(world.cells.length, 9612);
	const { habitat, population } = setup(world, { seed: 7, initialCount: 5000 });
	const start = performance.now();
	stepPopulation(population, habitat, 20);
	assert.ok(performance.now() - start < 15000);
	assert.ok(population.organisms.length > 0);
	for (const { cellId } of population.organisms) assert.notEqual(world.cells[cellId].biome, "Water");
});

test("the population model is independent of Three.js and of rendering", () => {
	const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
	const imports = [...read("../src/utility/ecology/population.js").matchAll(/from\s+["']([^"']+)["']/g)].map(
		(match) => match[1]
	);
	assert.deepEqual(imports.sort(), ["../planet/seededRandom.js", "./habitat.js"]);
	assert.doesNotMatch(read("../src/utility/planet/seededRandom.js"), /from\s+["']/);
});

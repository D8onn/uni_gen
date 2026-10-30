import assert from "node:assert/strict";
import test from "node:test";
import { createHabitat } from "../src/utility/ecology/habitat.js";
import {
	createPopulation,
	DEFAULT_PRODUCER,
	EVOLVING_PRODUCER,
	getCellOrganisms,
	getPopulationSummary,
	stepPopulation,
	summarizeTraits,
	TRAITS,
} from "../src/utility/ecology/population.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";

// Land cells in a line (each linked to the next).
function lineWorld(count, { temperature = 1, moisture = 1 } = {}) {
	return {
		cells: Array.from({ length: count }, (_, id) => ({
			id,
			latitude: 0,
			temperature,
			moisture,
			biome: "Grassland",
			neighbors: [id - 1, id + 1].filter((neighborId) => neighborId >= 0 && neighborId < count),
		})),
	};
}

function setup(world, options) {
	return { habitat: createHabitat(world), population: createPopulation(world, options) };
}

const close = (actual, expected, message) =>
	assert.ok(Math.abs(actual - expected) < 1e-12, `${message ?? ""} ${actual} != ${expected}`);

test("defaults are neutral, and the evolving preset turns on selection and mutation", () => {
	assert.deepEqual(TRAITS, ["temperatureOptimum", "moistureOptimum"]);
	assert.deepEqual(DEFAULT_PRODUCER.founderTraits, { temperatureOptimum: 0.5, moistureOptimum: 0.5 });
	assert.equal(DEFAULT_PRODUCER.selectionStrength, 0);
	assert.equal(DEFAULT_PRODUCER.mutationRate, 0);
	assert.deepEqual(EVOLVING_PRODUCER, {
		founderTraits: { temperatureOptimum: 0.5, moistureOptimum: 0.5 },
		selectionStrength: 2,
		mutationRate: 0.1,
		mutationSize: 0.05,
	});
	const population = createPopulation(lineWorld(1), { initialCount: 2, species: { founderTraits: { moistureOptimum: 0.9 } } });
	for (const organism of population.organisms) {
		assert.deepEqual(organism.traits, { temperatureOptimum: 0.5, moistureOptimum: 0.9 });
	}
	assert.notEqual(population.organisms[0].traits, population.organisms[1].traits);
});

test("growth is scaled by how well the traits match the cell's temperature and moisture", () => {
	const world = lineWorld(1, { temperature: 0.8, moisture: 0.3 });
	const species = { mortalityChance: 0, reproductionChance: 0, selectionStrength: 2 };
	const { habitat, population } = setup(world, { initialCount: 1, species });
	population.organisms[0].traits = { temperatureOptimum: 0.6, moistureOptimum: 0.7 };
	stepPopulation(population, habitat);
	const match = Math.exp(-2 * ((0.8 - 0.6) ** 2 + (0.3 - 0.7) ** 2));
	close(population.organisms[0].biomass, 0.2 * (1 + 0.2 * match - 0.05));

	// A perfectly matched organism grows exactly as it would without selection.
	const matched = setup(world, { initialCount: 1, species });
	matched.population.organisms[0].traits = { temperatureOptimum: 0.8, moistureOptimum: 0.3 };
	stepPopulation(matched.population, matched.habitat);
	close(matched.population.organisms[0].biomass, 0.2 * (1 + 0.2 - 0.05));
});

test("offspring copy the parent's traits exactly when mutation is off", () => {
	const species = { ...EVOLVING_PRODUCER, mutationRate: 0, mortalityChance: 0, reproductionChance: 1 };
	const { habitat, population } = setup(lineWorld(1), { initialCount: 1, species });
	const parent = population.organisms[0];
	parent.biomass = 0.9;
	parent.traits = { temperatureOptimum: 0.37, moistureOptimum: 0.81 };
	stepPopulation(population, habitat);
	const child = population.organisms[1];
	assert.equal(child.parentId, 0);
	assert.deepEqual(child.traits, { temperatureOptimum: 0.37, moistureOptimum: 0.81 });
	assert.notEqual(child.traits, parent.traits);
});

test("mutation changes offspring traits by seeded steps that stay within 0 to 1", () => {
	const fertile = { mortalityChance: 0, reproductionChance: 1, maxPerCell: 100 };
	const offspringTraits = (mutationSize) => {
		const species = { ...fertile, mutationRate: 1, mutationSize };
		const { habitat, population } = setup(lineWorld(1), { initialCount: 40, species });
		for (const organism of population.organisms) {
			organism.biomass = 0.9;
			organism.traits = { temperatureOptimum: 0.95, moistureOptimum: 0.05 };
		}
		stepPopulation(population, habitat);
		return population.organisms.filter(({ parentId }) => parentId !== null).map(({ traits }) => traits);
	};
	const small = offspringTraits(0.01);
	assert.equal(small.length, 40);
	for (const traits of small) {
		assert.notDeepEqual(traits, { temperatureOptimum: 0.95, moistureOptimum: 0.05 });
		assert.ok(Math.abs(traits.temperatureOptimum - 0.95) < 0.05);
		assert.ok(Math.abs(traits.moistureOptimum - 0.05) < 0.05);
	}
	// Large steps are clamped to the 0-1 range.
	const large = offspringTraits(5).flatMap((traits) => TRAITS.map((trait) => traits[trait]));
	assert.ok(large.every((value) => value >= 0 && value <= 1));
	assert.ok(large.includes(0) && large.includes(1));
	assert.deepEqual(offspringTraits(0.01), small);
});

test("trait variation grows from identical founders under neutral drift", () => {
	for (let seed = 1; seed <= 5; seed++) {
		const species = { ...EVOLVING_PRODUCER, selectionStrength: 0 };
		const { habitat, population } = setup(lineWorld(10), { seed, initialCount: 20, species });
		const start = getPopulationSummary(population).traits;
		for (const trait of TRAITS) assert.deepEqual(start[trait], { mean: 0.5, sd: 0 });
		stepPopulation(population, habitat, 100);
		const early = getPopulationSummary(population).traits;
		stepPopulation(population, habitat, 2900);
		const late = getPopulationSummary(population).traits;
		for (const trait of TRAITS) {
			assert.ok(late[trait].sd > early[trait].sd, `seed ${seed} ${trait}: ${early[trait].sd} -> ${late[trait].sd}`);
		}
	}
});

test("evolving populations are reproducible under a seed and resume identically after a JSON round trip", () => {
	const world = createGlobeMap({ poleToPoleCells: 12, seed: 3 });
	const run = (seed, ticks) => {
		const state = setup(world, { seed, initialCount: 40, species: EVOLVING_PRODUCER });
		stepPopulation(state.population, state.habitat, ticks);
		return state;
	};
	const full = run(9, 200);
	assert.deepEqual(run(9, 200), full);
	assert.ok(getPopulationSummary(full.population).traits.temperatureOptimum.sd > 0);
	const half = run(9, 100);
	const resumed = JSON.parse(JSON.stringify(half));
	stepPopulation(resumed.population, resumed.habitat, 100);
	assert.deepEqual(resumed, full);
	assert.deepEqual(getPopulationSummary(resumed.population).traits, getPopulationSummary(full.population).traits);
	assert.notDeepEqual(run(10, 200).population.organisms, full.population.organisms);

	// Cell queries copy traits, and an empty population has no trait summary.
	const { cellId } = full.population.organisms[0];
	getCellOrganisms(full.population, cellId)[0].traits.temperatureOptimum = -1;
	assert.notEqual(full.population.organisms[0].traits.temperatureOptimum, -1);
	assert.equal(summarizeTraits([]), null);
});

test("temperature optima evolve toward each habitat's temperature only when selection is on", () => {
	// Identical resources in both habitats; only the temperature condition differs.
	const evolve = (seed, temperature, selectionStrength) => {
		const world = lineWorld(10);
		const habitat = createHabitat(world);
		habitat.conditions.temperature.fill(temperature);
		habitat.conditions.moisture.fill(0.5);
		const species = { ...EVOLVING_PRODUCER, selectionStrength };
		const population = createPopulation(world, { seed, initialCount: 20, species });
		stepPopulation(population, habitat, 3000);
		return population;
	};
	const means = { warm: [], cold: [] };
	for (let seed = 1; seed <= 5; seed++) {
		const warm = getPopulationSummary(evolve(seed, 0.8, 2)).traits.temperatureOptimum.mean;
		const cold = getPopulationSummary(evolve(seed, 0.2, 2)).traits.temperatureOptimum.mean;
		assert.ok(warm > cold, `seed ${seed}: warm ${warm}, cold ${cold}`);
		means.warm.push(warm);
		means.cold.push(cold);
	}
	const average = (values) => values.reduce((total, value) => total + value, 0) / values.length;
	assert.ok(average(means.warm) >= 0.55, `warm ${means.warm}`);
	assert.ok(average(means.cold) <= 0.45, `cold ${means.cold}`);

	// Without selection the temperature has no effect: both habitats evolve identically.
	for (let seed = 1; seed <= 2; seed++) {
		assert.deepEqual(evolve(seed, 0.8, 0), evolve(seed, 0.2, 0));
	}
});

test("founders at the default traits survive the evolving preset in the most mismatched habitat", () => {
	// Temperature and moisture 1 are 0.5 from both founder optima: the match is exp(-1), about 0.37.
	for (let seed = 1; seed <= 20; seed++) {
		const { habitat, population } = setup(lineWorld(10), { seed, initialCount: 20, species: EVOLVING_PRODUCER });
		for (let tick = 1; tick <= 500; tick++) {
			stepPopulation(population, habitat);
			assert.ok(population.organisms.length > 0, `seed ${seed} died out at tick ${tick}`);
		}
	}
});

test("invalid trait and mutation parameters throw a RangeError", () => {
	const world = lineWorld(2);
	for (const species of [
		{ founderTraits: { height: 0.5 } },
		{ founderTraits: { temperatureOptimum: 1.5 } },
		{ founderTraits: { moistureOptimum: Number.NaN } },
		{ selectionStrength: -1 },
		{ selectionStrength: Number.POSITIVE_INFINITY },
		{ mutationRate: 1.5 },
		{ mutationSize: -0.1 },
	]) {
		assert.throws(() => createPopulation(world, { species }), RangeError, JSON.stringify(species));
	}
});

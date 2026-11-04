import assert from "node:assert/strict";
import test from "node:test";
import { createHabitat } from "../src/utility/ecology/habitat.js";
import {
	createPopulation,
	EVOLVING_PRODUCER,
	getCellOrganisms,
	getCellTraitMeans,
	getDispersalRegions,
	getGroupDivergence,
	stepPopulation,
	summarizeGroups,
	summarizeTraits,
	TRAITS,
} from "../src/utility/ecology/population.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";

const world = createGlobeMap({ poleToPoleCells: 30, seed: 11, radius: 10 });
const habitat = createHabitat(world);
const species = { ...EVOLVING_PRODUCER, dispersalChance: 0.15 };

// A population that has run long enough for traits to differ between cells and regions.
function evolved(ticks, seed = 5, initialCount = 300) {
	const population = createPopulation(world, { seed, initialCount, species });
	const habitatCopy = createHabitat(world);
	stepPopulation(population, habitatCopy, ticks);
	return population;
}

test("cell trait means equal each cell's summarizeTraits mean, and are NaN where a cell is empty", () => {
	for (const ticks of [0, 80]) {
		const population = evolved(ticks);
		const means = getCellTraitMeans(population);
		assert.deepEqual(Object.keys(means), TRAITS);
		let occupied = 0;
		let spread = 0;
		for (const cell of world.cells) {
			const traits = summarizeTraits(getCellOrganisms(population, cell.id));
			for (const trait of TRAITS) {
				assert.ok(means[trait] instanceof Float32Array && means[trait].length === world.cells.length);
				if (traits === null) assert.ok(Number.isNaN(means[trait][cell.id]), `${trait} of empty cell ${cell.id}`);
				else assert.equal(means[trait][cell.id], Math.fround(traits[trait].mean), `${trait} of cell ${cell.id} at tick ${ticks}`);
			}
			if (traits !== null) {
				occupied += 1;
				spread += Math.abs(traits.temperatureOptimum.mean - 0.5);
			}
		}
		assert.ok(occupied > 10);
		if (ticks === 0) assert.equal(spread, 0, "every founder starts at 0.5");
		else assert.ok(spread > 0, "after 80 ticks the cells differ from the founders");
	}
	const none = getCellTraitMeans(createPopulation(world, { seed: 1 }));
	assert.ok(Array.from(none.temperatureOptimum).every(Number.isNaN));
});

test("group divergence equals summarizeGroups' for the dispersal regions, from one pass", () => {
	for (const [ticks, seed] of [[60, 5], [150, 9]]) {
		const population = evolved(ticks, seed);
		const { regionOfCell } = getDispersalRegions(population, habitat);
		const reference = summarizeGroups(population, regionOfCell);
		const result = getGroupDivergence(population, regionOfCell);
		assert.equal(result.occupied, reference.groups.length);
		assert.ok(result.occupied >= 2, "the comparison needs more than one occupied region");
		for (const trait of TRAITS) {
			for (const part of ["within", "between"]) {
				assert.ok(Math.abs(result.divergence[trait][part] - reference.divergence[trait][part]) < 1e-12, `${trait} ${part}`);
			}
			assert.ok(Math.abs(result.divergence[trait].betweenShare - reference.divergence[trait].betweenShare) < 1e-9, `${trait} share`);
			assert.ok(result.divergence[trait].betweenShare > 0 && result.divergence[trait].betweenShare < 1);
		}
	}
});

test("group divergence handles identical traits, one group, and an empty population like summarizeGroups", () => {
	const founders = evolved(0);
	const { regionOfCell } = getDispersalRegions(founders, habitat);
	const reference = summarizeGroups(founders, regionOfCell);
	const result = getGroupDivergence(founders, regionOfCell);
	assert.equal(result.divergence.temperatureOptimum.betweenShare, null, "no variance at all");
	assert.deepEqual(result.divergence.temperatureOptimum.betweenShare, reference.divergence.temperatureOptimum.betweenShare);

	const single = getGroupDivergence(evolved(60), regionOfCell.map(() => 0));
	assert.equal(single.occupied, 1);
	assert.equal(single.divergence.temperatureOptimum.between < 1e-12, true, "one group has nothing between groups");
	assert.equal(single.divergence.temperatureOptimum.betweenShare < 1e-9, true);

	assert.deepEqual(getGroupDivergence(createPopulation(world, { seed: 1 }), regionOfCell), { occupied: 0, divergence: null });
});

test("group divergence rejects an organism whose cell has no group", () => {
	const population = evolved(0);
	assert.throws(() => getGroupDivergence(population, world.cells.map(() => undefined)), RangeError);
	assert.throws(() => getGroupDivergence(population, world.cells.map(() => -1.5)), RangeError);
});

// A population of `count` organisms whose traits are all `value` (or `value` plus a small step per organism), laid out in groups.
function withTraits(count, value, step = 0) {
	const population = createPopulation(world, { seed: 1, initialCount: count });
	population.organisms.forEach((organism, index) => {
		organism.traits = { temperatureOptimum: value + step * index, moistureOptimum: value };
	});
	return population;
}

test("identical traits give no share, whatever the value or the grouping, rather than a share made of rounding noise", () => {
	const layouts = [
		world.cells.map((cell) => cell.id % 3),
		world.cells.map((cell) => cell.id % 2),
		world.cells.map((cell) => Math.floor(cell.id / 40)),
		world.cells.map((cell) => (cell.id * 7919) % 5),
	];
	for (const value of [0.5, 0.3, 0.6, 0.1, 0.7, 1 / 3, 0.9, 0.05, 0.123456789]) {
		for (const count of [7, 50, 300]) {
			const population = withTraits(count, value);
			for (const [index, groupOfCell] of layouts.entries()) {
				const label = `value ${value}, ${count} organisms, layout ${index}`;
				const mine = getGroupDivergence(population, groupOfCell).divergence;
				const reference = summarizeGroups(population, groupOfCell).divergence;
				for (const trait of TRAITS) {
					assert.equal(mine[trait].betweenShare, null, `getGroupDivergence, ${trait}, ${label}`);
					assert.equal(reference[trait].betweenShare, null, `summarizeGroups, ${trait}, ${label}`);
				}
			}
		}
	}
});

test("a real but small difference between organisms still gives a share, equal in both functions", () => {
	// 0.0001 apart gives a variance of about 1e-6 on the temperature optimum, far above rounding noise.
	const population = withTraits(60, 0.4, 0.0001);
	const groupOfCell = world.cells.map((cell) => cell.id % 3);
	const mine = getGroupDivergence(population, groupOfCell).divergence;
	const reference = summarizeGroups(population, groupOfCell).divergence;
	assert.notEqual(mine.temperatureOptimum.betweenShare, null);
	assert.ok(mine.temperatureOptimum.within + mine.temperatureOptimum.between > 1e-7);
	assert.ok(Math.abs(mine.temperatureOptimum.betweenShare - reference.temperatureOptimum.betweenShare) < 1e-6);
	assert.equal(mine.moistureOptimum.betweenShare, null, "the other trait is identical everywhere");
	assert.equal(reference.moistureOptimum.betweenShare, null);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	consumeResource,
	createHabitat,
	DEFAULT_RESOURCE_RATES,
	getCellHabitat,
	RESOURCES,
	stepHabitat,
} from "../src/utility/ecology/habitat.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";

const sum = (values) => values.reduce((total, value) => total + value, 0);

// Cells in a line (each linked to the next), at the equator.
function lineWorld(moistures, temperature = 1) {
	return {
		cells: moistures.map((moisture, id) => ({
			id,
			latitude: 0,
			temperature,
			moisture,
			neighbors: [id - 1, id + 1].filter((neighborId) => neighborId >= 0 && neighborId < moistures.length),
		})),
	};
}

function assertWithinCapacity(habitat) {
	for (const resource of RESOURCES) {
		habitat.resources[resource].forEach((stock, id) => {
			assert.ok(stock >= 0 && stock <= habitat.capacity[resource][id], `${resource} ${id}: ${stock}`);
		});
	}
}

test("a habitat reads conditions and capacities from the world without changing it", () => {
	const world = createGlobeMap({ poleToPoleCells: 12, seed: 3 });
	const before = structuredClone(world);
	const habitat = createHabitat(world);
	assert.deepEqual(world, before);
	assert.deepEqual(JSON.parse(JSON.stringify(habitat)), habitat);
	assert.deepEqual(habitat.rates, DEFAULT_RESOURCE_RATES);

	const waterCells = world.cells.filter((cell) => cell.biome === "Water");
	assert.ok(waterCells.length > 0);
	for (const cell of world.cells) {
		const { conditions, capacity, resources } = getCellHabitat(habitat, cell.id);
		assert.deepEqual(conditions, {
			temperature: cell.temperature,
			moisture: cell.moisture,
			light: Math.cos(cell.latitude),
		});
		for (const value of Object.values(conditions)) assert.ok(value >= 0 && value <= 1);
		assert.equal(capacity.water, cell.moisture);
		assert.equal(capacity.nutrients, cell.temperature * cell.moisture);
		assert.deepEqual(resources, capacity);
	}
	for (const cell of waterCells) {
		assert.deepEqual(getCellHabitat(habitat, cell.id).capacity, {
			water: 1,
			nutrients: cell.temperature,
		});
	}
});

test("consuming takes at most the available stock and rejects invalid requests", () => {
	const habitat = createHabitat(lineWorld([0.8, 0.5]));
	assert.ok(Math.abs(consumeResource(habitat, 0, "water", 0.3) - 0.3) < 1e-15);
	assert.ok(Math.abs(consumeResource(habitat, 0, "water", 2) - 0.5) < 1e-15);
	assert.equal(getCellHabitat(habitat, 0).resources.water, 0);
	assert.equal(consumeResource(habitat, 0, "water", 1), 0);
	assert.equal(consumeResource(habitat, 1, "nutrients", 0), 0);
	assert.equal(getCellHabitat(habitat, 1).resources.nutrients, 0.5);

	for (const cellId of [-1, 2, 0.5, "0"]) {
		assert.throws(() => consumeResource(habitat, cellId, "water", 0.1), RangeError);
		assert.throws(() => getCellHabitat(habitat, cellId), RangeError);
	}
	for (const resource of ["light", "temperature", "Water"]) {
		assert.throws(() => consumeResource(habitat, 0, resource, 0.1), RangeError);
	}
	for (const amount of [-0.1, Number.NaN, Infinity]) {
		assert.throws(() => consumeResource(habitat, 0, "water", amount), RangeError);
	}
});

test("rates are configurable and must lie between 0 and 1", () => {
	const habitat = createHabitat(lineWorld([1]), { water: { spread: 0.5 } });
	assert.deepEqual(habitat.rates, {
		water: { regeneration: DEFAULT_RESOURCE_RATES.water.regeneration, spread: 0.5 },
		nutrients: DEFAULT_RESOURCE_RATES.nutrients,
	});
	for (const rates of [
		{ water: { spread: 1.5 } },
		{ nutrients: { regeneration: -0.1 } },
		{ water: { regeneration: Number.NaN } },
		{ light: { spread: 0.1 } },
	]) {
		assert.throws(() => createHabitat(lineWorld([1]), rates), RangeError);
	}
});

test("zero ticks change nothing and tick counts must be non-negative integers", () => {
	const habitat = createHabitat(lineWorld([0.9, 0.2, 0.6]));
	consumeResource(habitat, 0, "water", 0.5);
	const before = structuredClone(habitat);
	stepHabitat(habitat, 0);
	assert.deepEqual(habitat, before);
	for (const ticks of [-1, 1.5, Number.NaN]) {
		assert.throws(() => stepHabitat(habitat, ticks), RangeError);
	}
});

test("a depleted stock regenerates toward capacity without overshooting", () => {
	const regeneration = 0.1;
	const habitat = createHabitat(lineWorld([0.8]), { water: { regeneration } });
	consumeResource(habitat, 0, "water", 0.8);
	let previous = 0;
	for (let tick = 1; tick <= 100; tick++) {
		stepHabitat(habitat);
		const stock = habitat.resources.water[0];
		assert.ok(stock > previous && stock <= 0.8);
		assert.ok(Math.abs(stock - 0.8 * (1 - (1 - regeneration) ** tick)) < 1e-12);
		previous = stock;
	}
});

test("transfer conserves the total and evens out how full neighboring cells are", () => {
	const habitat = createHabitat(lineWorld([1, 0.4, 0.4, 0.2]), {
		water: { regeneration: 0, spread: 1 },
		nutrients: { regeneration: 0, spread: 1 },
	});
	consumeResource(habitat, 3, "water", 0.2);
	consumeResource(habitat, 1, "nutrients", 0.4);
	const totals = RESOURCES.map((resource) => sum(habitat.resources[resource]));

	stepHabitat(habitat);
	assert.ok(habitat.resources.water[3] > 0);
	assert.ok(habitat.resources.water[2] < 0.4);
	assert.equal(habitat.resources.water[0], 1);
	assert.ok(habitat.resources.nutrients[1] > 0);

	stepHabitat(habitat, 500);
	RESOURCES.forEach((resource, index) => {
		assert.ok(Math.abs(sum(habitat.resources[resource]) - totals[index]) < 1e-12, resource);
		const fills = habitat.resources[resource].map(
			(stock, id) => stock / habitat.capacity[resource][id]
		);
		for (const fill of fills) assert.ok(Math.abs(fill - fills[0]) < 1e-9, resource);
	});
	assertWithinCapacity(habitat);
});

test("stocks stay between zero and capacity under heavy use and long runs on a globe", () => {
	const world = createGlobeMap({ poleToPoleCells: 12, seed: 3 });
	const habitat = createHabitat(world, {
		water: { regeneration: 1, spread: 1 },
		nutrients: { regeneration: 0, spread: 1 },
	});
	for (let tick = 0; tick < 50; tick++) {
		for (const cell of world.cells) {
			if ((cell.id + tick) % 3 === 0) {
				consumeResource(habitat, cell.id, "water", 1);
				consumeResource(habitat, cell.id, "nutrients", 0.05);
			}
		}
		stepHabitat(habitat);
		assertWithinCapacity(habitat);
	}
	const defaults = createHabitat(world);
	for (const cell of world.cells) consumeResource(defaults, cell.id, "water", cell.id % 2);
	stepHabitat(defaults, 300);
	assertWithinCapacity(defaults);
	defaults.resources.water.forEach((stock, id) => {
		assert.ok(Math.abs(stock - defaults.capacity.water[id]) < 1e-6);
	});
});

test("stepping is deterministic and does not depend on cell order", () => {
	const world = createGlobeMap({ poleToPoleCells: 8, seed: 11 });
	const cellCount = world.cells.length;
	// Reverses ids, so every cell and neighbor list is visited in a different order.
	const newId = (id) => cellCount - 1 - id;
	const reordered = {
		cells: world.cells
			.map((cell) => ({ ...cell, id: newId(cell.id), neighbors: cell.neighbors.map(newId).reverse() }))
			.reverse(),
	};
	const run = (source, toId) => {
		const habitat = createHabitat(source);
		for (const id of [0, 5, 17]) {
			consumeResource(habitat, toId(id), "water", 0.7);
			consumeResource(habitat, toId(id), "nutrients", 0.2);
		}
		return stepHabitat(habitat, 40);
	};

	const original = run(world, (id) => id);
	assert.deepEqual(run(world, (id) => id), original);
	const permuted = run(reordered, newId);
	for (const resource of RESOURCES) {
		for (let id = 0; id < cellCount; id++) {
			const difference = permuted.resources[resource][newId(id)] - original.resources[resource][id];
			assert.ok(Math.abs(difference) < 1e-12, `${resource} ${id}`);
		}
	}
});

test("the habitat model is independent of Three.js and of rendering", () => {
	const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
	assert.doesNotMatch(read("../src/utility/ecology/habitat.js"), /from\s+["']/);
	for (const path of [
		"../src/utility/planet/createPlanet.js",
		"../src/utility/planet/planetMeshData.js",
	]) {
		assert.doesNotMatch(read(path), /ecology/);
	}
});

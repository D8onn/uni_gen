import assert from "node:assert/strict";
import test from "node:test";
import { calculateHydrology } from "../src/utility/planet/hydrology.js";
import { createMinHeap } from "../src/utility/planet/minHeap.js";
import { createSeededRandom } from "../src/utility/planet/seededRandom.js";

// A row of cells where each cell neighbors the ones beside it.
function createRow(elevations, waterIds = []) {
	return elevations.map((elevation, id) => ({
		id,
		elevation,
		biome: waterIds.includes(id) ? "Water" : "Grasslands",
		neighbors: [id - 1, id + 1].filter((neighborId) => neighborId >= 0 && neighborId < elevations.length),
	}));
}

test("a depression fills up to its spill point and drains over its lowest rim", () => {
	// Cells 3 and 5 are pits: 3 spills over cell 2 (0.3, lower than cell 4 at 0.4), and 5 over cell 4.
	const row = createRow([-0.2, 0.1, 0.3, 0.05, 0.4, 0.2, 0.5], [0]);
	const hydrology = calculateHydrology(row);

	assert.deepEqual(hydrology.flowTo, [null, 0, 1, 2, 3, 4, 5]);
	assert.deepEqual(hydrology.flowAccumulation, [0, 6, 5, 4, 3, 2, 1]);
	assert.deepEqual(hydrology.drainageBasin, [null, 1, 1, 1, 1, 1, 1]);
	assert.equal(hydrology.riverThreshold, 3);
	assert.deepEqual(hydrology.hasRiver, [false, true, true, true, true, false, false]);
});

test("a ridge drains toward the lower-numbered side when both sides are equal", () => {
	const row = createRow([-0.2, 0.1, 0.2, 0.4, 0.2, 0.1, -0.2], [0, 6]);
	const hydrology = calculateHydrology(row);

	assert.deepEqual(hydrology.flowTo, [null, 0, 1, 2, 5, 6, null]);
	assert.deepEqual(hydrology.flowAccumulation, [0, 3, 2, 1, 1, 2, 0]);
	assert.deepEqual(hydrology.drainageBasin, [null, 1, 1, 1, 5, 5, null]);
});

test("flat ground drains along the shortest route to water, not by cell id", () => {
	// Cell 6 touches cell 5 (two steps from water through cell 4) and cell 1 (three steps, through
	// cells 3 and 2). Without a strictly rising fill surface, the low id of cell 1 would win.
	const edges = [
		[0, 4],
		[4, 5],
		[5, 6],
		[0, 2],
		[2, 3],
		[3, 1],
		[1, 6],
	];
	const cells = Array.from({ length: 7 }, (_, id) => ({
		id,
		elevation: id === 0 ? -0.2 : 0.2,
		biome: id === 0 ? "Water" : "Grasslands",
		neighbors: edges
			.filter(([a, b]) => a === id || b === id)
			.map(([a, b]) => (a === id ? b : a))
			.sort((a, b) => a - b),
	}));
	const hydrology = calculateHydrology(cells);

	assert.deepEqual(hydrology.flowTo, [null, 3, 0, 2, 0, 4, 5]);
	assert.deepEqual(hydrology.flowAccumulation, [0, 1, 3, 2, 3, 2, 1]);
});

test("a world without water drains to its lowest cell", () => {
	const row = createRow([0.3, 0.1, 0.5, 0.2]);
	const hydrology = calculateHydrology(row);

	assert.deepEqual(hydrology.flowTo, [1, null, 1, 2]);
	assert.deepEqual(hydrology.flowAccumulation, [1, 4, 2, 1]);
	assert.deepEqual(hydrology.drainageBasin, [1, 1, 1, 1]);
});

test("rivers need a minimum upstream area even in tiny worlds", () => {
	const hydrology = calculateHydrology(createRow([-0.2, 0.1, 0.2], [0]));

	assert.deepEqual(hydrology.flowAccumulation, [0, 2, 1]);
	assert.deepEqual(hydrology.hasRiver, [false, false, false]);
});

test("the min-heap pops by priority and breaks ties by id", () => {
	const heap = createMinHeap();
	const random = createSeededRandom(7);
	const entries = [];
	for (let id = 0; id < 200; id++) {
		const priority = Math.floor(random() * 10);
		entries.push({ id, priority });
		heap.push(id, priority);
	}

	assert.equal(heap.size, entries.length);
	const expected = [...entries].sort((a, b) => a.priority - b.priority || a.id - b.id);
	const popped = [];
	while (heap.size > 0) popped.push(heap.pop());
	assert.deepEqual(popped, expected);
});

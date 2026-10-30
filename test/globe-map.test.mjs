import assert from "node:assert/strict";
import test from "node:test";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";

function snapshotWorld(globe) {
	return globe.cells.map((cell) => ({
		id: cell.id,
		center: cell.center.toArray(),
		latitude: cell.latitude,
		elevation: cell.elevation,
		temperature: cell.temperature,
		moisture: cell.moisture,
		biome: cell.biome,
		neighbors: cell.neighbors,
		boundaryFaceIds: cell.boundaryFaceIds,
		surfaceElevation: cell.surfaceElevation,
		hasTree: cell.hasTree,
	}));
}

test("80-cell globe is a closed hexagon-pentagon grid", () => {
	const globe = createGlobeMap({ poleToPoleCells: 80 });
	const pentagons = globe.cells.filter((cell) => cell.neighbors.length === 5);
	const hexagons = globe.cells.filter((cell) => cell.neighbors.length === 6);

	assert.equal(globe.cells.length, 10 * (globe.detail + 1) ** 2 + 2);
	assert.equal(pentagons.length, 12);
	assert.equal(hexagons.length, globe.cells.length - 12);
	assert.ok(Math.abs(globe.estimatedPoleToPoleCells - 80) <= 1.5);
	assert.equal(
		globe.edges.length,
		globe.cells.reduce((sum, cell) => sum + cell.neighbors.length, 0) / 2
	);

	const connected = new Set([0]);
	const pending = [0];
	while (pending.length > 0) {
		for (const neighborId of globe.cells[pending.pop()].neighbors) {
			if (connected.has(neighborId)) continue;
			connected.add(neighborId);
			pending.push(neighborId);
		}
	}
	assert.equal(connected.size, globe.cells.length);

	for (const cell of globe.cells) {
		assert.equal(cell.boundaryFaceIds.length, cell.neighbors.length);
		assert.ok(globe.biomes.includes(cell.biome));
		assert.ok(Math.abs(cell.center.length() - 1) < 1e-6);
		assert.ok(Number.isFinite(cell.latitude));
		assert.ok(Number.isFinite(cell.elevation));
		assert.ok(Number.isFinite(cell.temperature));
		assert.ok(Number.isFinite(cell.moisture));
		for (const neighborId of cell.neighbors) {
			assert.ok(globe.cells[neighborId].neighbors.includes(cell.id));
		}
	}
});

test("the same seed reproduces the same world data", () => {
	const seed = 123456789;
	const first = createGlobeMap({ poleToPoleCells: 12, seed });
	const second = createGlobeMap({ poleToPoleCells: 12, seed });

	assert.equal(first.seed, seed);
	assert.ok(first.cells.some((cell) => cell.hasTree));
	assert.deepEqual(snapshotWorld(first), snapshotWorld(second));
});

test("different seeds produce different terrain", () => {
	const first = createGlobeMap({ poleToPoleCells: 8, seed: 1 });
	const second = createGlobeMap({ poleToPoleCells: 8, seed: 2 });

	assert.notDeepEqual(
		first.cells.map((cell) => cell.elevation),
		second.cells.map((cell) => cell.elevation)
	);
});

test("globe resolution and seed must be valid integers", () => {
	assert.throws(() => createGlobeMap({ poleToPoleCells: 0 }), RangeError);
	assert.throws(() => createGlobeMap({ poleToPoleCells: 2.5 }), RangeError);
	assert.throws(() => createGlobeMap({ seed: -1 }), RangeError);
	assert.throws(() => createGlobeMap({ seed: 1.5 }), RangeError);
	assert.throws(() => createGlobeMap({ seed: 0x100000000 }), RangeError);
});

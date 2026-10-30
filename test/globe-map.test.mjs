import assert from "node:assert/strict";
import test from "node:test";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";

function snapshotWorld(globe) {
	return globe.cells.map((cell) => ({
		id: cell.id,
		center: cell.center.toArray(),
		latitude: cell.latitude,
		elevation: cell.elevation,
		slope: cell.slope,
		distanceToWater: cell.distanceToWater,
		flowTo: cell.flowTo,
		flowAccumulation: cell.flowAccumulation,
		drainageBasin: cell.drainageBasin,
		hasRiver: cell.hasRiver,
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
		assert.ok(Number.isFinite(cell.slope));
		assert.ok(cell.slope >= 0 && cell.slope <= Math.PI / 2);
		assert.ok(Number.isFinite(cell.distanceToWater));
		assert.ok(cell.distanceToWater >= 0);
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

test("terrain fields stay bounded and water distance is spatially consistent", () => {
	const globe = createGlobeMap({ poleToPoleCells: 20, seed: 12345 });
	const waterCells = globe.cells.filter((cell) => cell.biome === "Water");
	const shoreCells = globe.cells.filter(
		(cell) =>
			cell.biome !== "Water" &&
			cell.neighbors.some((neighborId) => globe.cells[neighborId].biome === "Water")
	);

	assert.ok(waterCells.length > 0);
	assert.ok(shoreCells.length > 0);
	assert.ok(globe.cells.some((cell) => cell.slope > 0));
	assert.ok(globe.cells.some((cell) => cell.distanceToWater > 0));

	for (const cell of globe.cells) {
		assert.ok(cell.elevation >= -0.45 && cell.elevation <= 0.45);
		assert.ok(cell.slope >= 0 && cell.slope <= Math.PI / 2);
		assert.ok(Number.isFinite(cell.distanceToWater));
		if (cell.biome === "Water") assert.equal(cell.distanceToWater, 0);
		for (const neighborId of cell.neighbors) {
			const neighbor = globe.cells[neighborId];
			const edgeLength = Math.acos(
				Math.max(-1, Math.min(1, cell.center.dot(neighbor.center)))
			);
			assert.ok(
				Math.abs(cell.distanceToWater - neighbor.distanceToWater) <= edgeLength + 1e-10
			);
		}
	}

	const meanNeighborElevationChange =
		globe.edges.reduce(
			(sum, edge) =>
				sum + Math.abs(globe.cells[edge.cellA].elevation - globe.cells[edge.cellB].elevation),
			0
		) / globe.edges.length;
	const distantOffset = Math.floor(globe.cells.length / 2);
	const meanDistantElevationChange =
		globe.cells.reduce(
			(sum, cell, index) =>
				sum +
					Math.abs(
						cell.elevation -
							globe.cells[(index + distantOffset) % globe.cells.length].elevation
					),
			0
		) / globe.cells.length;
	assert.ok(meanNeighborElevationChange < meanDistantElevationChange);
});

test("distance to water is the shortest path along cell-center arcs", () => {
	const globe = createGlobeMap({ poleToPoleCells: 20, seed: 12345 });

	for (const cell of globe.cells) {
		if (cell.biome === "Water") continue;
		const viaNeighbors = Math.min(
			...cell.neighbors.map((neighborId) => {
				const neighbor = globe.cells[neighborId];
				const edgeLength = Math.acos(
					Math.max(-1, Math.min(1, cell.center.dot(neighbor.center)))
				);
				return neighbor.distanceToWater + edgeLength;
			})
		);
		assert.ok(Math.abs(cell.distanceToWater - viaNeighbors) < 1e-10);
	}
});

test("slope is measured in the planet's units and scales with radius", () => {
	const small = createGlobeMap({ poleToPoleCells: 20, seed: 12345, radius: 10 });
	const large = createGlobeMap({ poleToPoleCells: 20, seed: 12345, radius: 20 });

	assert.equal(small.radius, 10);
	assert.equal(createGlobeMap({ poleToPoleCells: 4 }).radius, 10);
	assert.equal(large.radius, 20);
	assert.ok(small.cells.some((cell) => cell.slope > 0));
	for (const cell of small.cells) {
		const other = large.cells[cell.id];
		assert.equal(cell.elevation, other.elevation);
		assert.ok(Math.abs(Math.tan(cell.slope) * 10 - Math.tan(other.slope) * 20) < 1e-9);
	}
});

test("terrain keeps usable ocean and mountain coverage across seeds", () => {
	for (const seed of [1, 42, 99999]) {
		const globe = createGlobeMap({ poleToPoleCells: 80, seed });
		const share = (biome) =>
			globe.cells.filter((cell) => cell.biome === biome).length / globe.cells.length;

		assert.ok(share("Water") > 0.2 && share("Water") < 0.5, `water share, seed ${seed}`);
		assert.ok(share("Mountains") > 0.02 && share("Mountains") < 0.09, `mountain share, seed ${seed}`);
	}
});

test("elevation has fine-scale detail on top of large-scale structure", () => {
	for (const seed of [1, 12345]) {
		const globe = createGlobeMap({ poleToPoleCells: 80, seed });
		const mean = globe.cells.reduce((sum, cell) => sum + cell.elevation, 0) / globe.cells.length;
		const deviation = Math.sqrt(
			globe.cells.reduce((sum, cell) => sum + (cell.elevation - mean) ** 2, 0) /
				globe.cells.length
		);
		const roughness =
			globe.cells.reduce((sum, cell) => {
				const neighborMean =
					cell.neighbors.reduce((total, id) => total + globe.cells[id].elevation, 0) /
					cell.neighbors.length;
				return sum + Math.abs(cell.elevation - neighborMean);
			}, 0) /
			globe.cells.length /
			deviation;

		// A single low-frequency noise sample measures about 0.15 here; added octaves reach about 0.20.
		assert.ok(roughness > 0.18, `roughness ${roughness.toFixed(3)}, seed ${seed}`);
	}
});

test("every land cell drains to water along its neighbors without cycles", () => {
	for (const seed of [1, 12345]) {
		const globe = createGlobeMap({ poleToPoleCells: 40, seed });
		let downhill = 0;
		let land = 0;

		for (const cell of globe.cells) {
			if (cell.biome === "Water") {
				assert.equal(cell.flowTo, null);
				assert.equal(cell.flowAccumulation, 0);
				assert.equal(cell.drainageBasin, null);
				assert.equal(cell.hasRiver, false);
				continue;
			}

			land++;
			assert.ok(cell.neighbors.includes(cell.flowTo), `cell ${cell.id} flows to a neighbor`);
			if (globe.cells[cell.flowTo].elevation <= cell.elevation) downhill++;

			let current = cell;
			let steps = 0;
			while (current.biome !== "Water") {
				current = globe.cells[current.flowTo];
				assert.ok(++steps <= globe.cells.length, `cell ${cell.id} drains without a cycle`);
			}
		}

		// Most flow runs downhill; the rest crosses filled depressions.
		assert.ok(downhill / land > 0.9, `downhill share ${downhill / land}, seed ${seed}`);
	}
});

test("flow accumulation counts the land cells draining through each cell", () => {
	const globe = createGlobeMap({ poleToPoleCells: 40, seed: 12345 });
	const upstream = new Map(globe.cells.map((cell) => [cell.id, 0]));
	for (const cell of globe.cells) {
		if (cell.biome !== "Water") {
			upstream.set(cell.flowTo, upstream.get(cell.flowTo) + cell.flowAccumulation);
		}
	}

	let mouthTotal = 0;
	for (const cell of globe.cells) {
		if (cell.biome === "Water") continue;
		assert.equal(cell.flowAccumulation, 1 + upstream.get(cell.id));
		if (globe.cells[cell.flowTo].biome === "Water") mouthTotal += cell.flowAccumulation;
	}
	assert.equal(mouthTotal, globe.cells.filter((cell) => cell.biome !== "Water").length);
});

test("rivers follow high flow accumulation from their sources to water", () => {
	for (const seed of [1, 42, 12345]) {
		const globe = createGlobeMap({ poleToPoleCells: 80, seed });
		const land = globe.cells.filter((cell) => cell.biome !== "Water");
		const rivers = land.filter((cell) => cell.hasRiver);

		assert.ok(rivers.length / land.length > 0.01 && rivers.length / land.length < 0.12, `seed ${seed}`);
		for (const cell of globe.cells) {
			assert.equal(cell.hasRiver, cell.biome !== "Water" && cell.flowAccumulation >= globe.riverThreshold);
			if (!cell.hasRiver) continue;
			const downstream = globe.cells[cell.flowTo];
			assert.ok(downstream.hasRiver || downstream.biome === "Water");
			assert.ok(downstream.flowAccumulation > cell.flowAccumulation || downstream.biome === "Water");
			assert.equal(cell.hasTree, false);
		}
		assert.ok(rivers.some((river) => globe.cells[river.flowTo].biome === "Water"));
		assert.ok(rivers.some((river) => !land.some((other) => other.hasRiver && other.flowTo === river.id)));
	}
});

test("drainage basins partition the land and are named by their outlet", () => {
	const globe = createGlobeMap({ poleToPoleCells: 40, seed: 12345 });
	const outlets = new Set();

	for (const cell of globe.cells) {
		if (cell.biome === "Water") continue;
		const downstream = globe.cells[cell.flowTo];
		if (downstream.biome === "Water") {
			assert.equal(cell.drainageBasin, cell.id);
			outlets.add(cell.id);
		} else {
			assert.equal(cell.drainageBasin, downstream.drainageBasin);
		}
	}

	assert.ok(outlets.size > 1);
	for (const cell of globe.cells) {
		if (cell.biome !== "Water") assert.ok(outlets.has(cell.drainageBasin));
	}
});

test("globe resolution, seed, and radius must be valid", () => {
	assert.throws(() => createGlobeMap({ poleToPoleCells: 0 }), RangeError);
	assert.throws(() => createGlobeMap({ poleToPoleCells: 2.5 }), RangeError);
	assert.throws(() => createGlobeMap({ seed: -1 }), RangeError);
	assert.throws(() => createGlobeMap({ seed: 1.5 }), RangeError);
	assert.throws(() => createGlobeMap({ seed: 0x100000000 }), RangeError);
	assert.throws(() => createGlobeMap({ radius: 0 }), RangeError);
	assert.throws(() => createGlobeMap({ radius: -5 }), RangeError);
	assert.throws(() => createGlobeMap({ radius: Infinity }), RangeError);
});

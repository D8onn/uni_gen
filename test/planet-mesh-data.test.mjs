import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";
import {
	buildPlanetMeshData,
	getSurfaceType,
	SURFACE_COLORS,
} from "../src/utility/planet/planetMeshData.js";

function dot(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function bytes(array) {
	return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

// Hashes the vertex data exactly as the renderer uploads it (32-bit floats).
function hashMeshData(meshData) {
	const hash = createHash("sha256");
	for (const { type, positions } of meshData.surfaces) {
		hash.update(type);
		hash.update(bytes(new Float32Array(positions)));
	}
	hash.update("edges");
	hash.update(bytes(new Float32Array(meshData.edgePositions)));
	hash.update(
		bytes(new Float64Array(meshData.trees.flatMap(({ position, normal }) => [...position, ...normal])))
	);
	return hash.digest("hex");
}

test("mesh data matches the geometry rendered before world data was split out", () => {
	// From the pre-split createPlanet scene at the original WG-06 commit 013ac39, via
	// `node scripts/golden-mesh-hashes.mjs 013ac39` with one manual tweak: biomeColors left out of the
	// appended export list, because 013ac39 already exports it.
	const goldenHashes = [
		[80, 12345, "795ed608d3ea606769c015533691e6d3483b8e0827237bbc438e0b6533584528"],
		[20, 42, "3f3ac69f098c64d699cab89a3aa2605d234d1f445582d05b1c101f53288b0819"],
	];
	for (const [poleToPoleCells, seed, expected] of goldenHashes) {
		const world = createGlobeMap({ poleToPoleCells, seed, radius: 10 });
		assert.equal(hashMeshData(buildPlanetMeshData(world)), expected);
	}
});

test("mesh data draws every cell as outward triangles at its surface height", () => {
	const world = createGlobeMap({ poleToPoleCells: 20, seed: 1, radius: 10 });
	const { surfaces, edgePositions, trees } = buildPlanetMeshData(world);
	const triangleCounts = new Map();
	for (const cell of world.cells) {
		const type = getSurfaceType(cell);
		triangleCounts.set(type, (triangleCounts.get(type) ?? 0) + cell.boundaryFaceIds.length);
	}

	assert.deepEqual(
		new Map(surfaces.map(({ type, positions }) => [type, positions.length / 9])),
		triangleCounts
	);
	assert.ok(surfaces.some(({ type }) => type === "River"));
	assert.equal(edgePositions.length, world.edges.length * 6);

	for (const { type, color, positions } of surfaces) {
		assert.equal(color, SURFACE_COLORS.get(type));
		for (let offset = 0; offset < positions.length; offset += 9) {
			const center = positions.slice(offset, offset + 3);
			const a = positions.slice(offset + 3, offset + 6);
			const b = positions.slice(offset + 6, offset + 9);
			const ab = [a[0] - center[0], a[1] - center[1], a[2] - center[2]];
			const ac = [b[0] - center[0], b[1] - center[1], b[2] - center[2]];
			const normal = [
				ab[1] * ac[2] - ab[2] * ac[1],
				ab[2] * ac[0] - ab[0] * ac[2],
				ab[0] * ac[1] - ab[1] * ac[0],
			];
			assert.ok(dot(normal, center) >= 0);
		}
	}

	const positionsByType = new Map(surfaces.map(({ type, positions }) => [type, positions]));
	const offsets = new Map();
	for (const cell of world.cells) {
		const type = getSurfaceType(cell);
		const offset = offsets.get(type) ?? 0;
		const positions = positionsByType.get(type);
		for (let corner = 0; corner < cell.boundaryFaceIds.length; corner++) {
			const center = positions.slice(offset + corner * 9, offset + corner * 9 + 3);
			assert.ok(Math.abs(Math.hypot(...center) - (world.radius + cell.surfaceElevation)) < 1e-6);
		}
		offsets.set(type, offset + cell.boundaryFaceIds.length * 9);
	}

	const treeCells = world.cells.filter((cell) => cell.hasTree);
	assert.ok(treeCells.length > 0);
	assert.equal(trees.length, treeCells.length);
	trees.forEach(({ position, normal }, index) => {
		const cell = treeCells[index];
		assert.deepEqual(normal, cell.center);
		assert.ok(
			Math.abs(Math.hypot(...position) - (world.radius + cell.surfaceElevation + 0.025)) < 1e-9
		);
	});
});

test("every biome and the river tint have a surface colour", () => {
	const world = createGlobeMap({ poleToPoleCells: 8, seed: 1 });
	for (const biome of world.biomes) assert.ok(SURFACE_COLORS.has(biome), biome);
	assert.ok(SURFACE_COLORS.has("River"));
	const cells = world.cells.map((cell, id) =>
		id === 0 ? { ...cell, biome: "Swamp", hasRiver: false } : cell
	);
	assert.throws(() => buildPlanetMeshData({ ...world, cells }), /Swamp/);
});

test("building mesh data reads the world without changing it or needing Three.js", () => {
	const world = createGlobeMap({ poleToPoleCells: 12, seed: 7 });
	for (const cell of world.cells) cell.extraField = { id: cell.id };
	const before = structuredClone(world);

	buildPlanetMeshData(world);
	assert.deepEqual(world, before);

	const source = readFileSync(
		new URL("../src/utility/planet/planetMeshData.js", import.meta.url),
		"utf8"
	);
	assert.doesNotMatch(source, /from\s+["']three/);
});

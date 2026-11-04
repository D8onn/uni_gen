import assert from "node:assert/strict";
import test from "node:test";
import { createClickDetector, getCellOfTriangle } from "../src/utility/planet/cellPicking.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";
import { buildCellMeshData, buildCellOutline } from "../src/utility/planet/planetMeshData.js";

const RADIUS = 10;
const worlds = [
	createGlobeMap({ poleToPoleCells: 20, seed: 1, radius: RADIUS }),
	createGlobeMap({ poleToPoleCells: 40, seed: 7, radius: RADIUS }),
];

test("every triangle of the cell mesh maps back to the cell whose centre it is drawn from", () => {
	for (const world of worlds) {
		const { positions, cellVertexStart } = buildCellMeshData(world);
		const triangles = cellVertexStart[world.cells.length] / 3;
		assert.equal(triangles, world.cells.reduce((total, cell) => total + cell.boundaryFaceIds.length, 0));
		for (let triangle = 0; triangle < triangles; triangle++) {
			const cell = world.cells[getCellOfTriangle(cellVertexStart, triangle)];
			// The first vertex of each triangle is its cell's centre at the surface height, which names the cell independently of the ranges.
			const expected = cell.center.map((value) => value * (RADIUS + cell.surfaceElevation));
			const actual = Array.from(positions.slice(triangle * 9, triangle * 9 + 3));
			actual.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < 1e-4, `triangle ${triangle}, cell ${cell.id}`));
		}
	}
});

test("the first and last triangle of every cell map to that cell, including the pentagons and the cells at the poles", () => {
	for (const world of worlds) {
		const { cellVertexStart } = buildCellMeshData(world);
		for (const cell of world.cells) {
			const first = cellVertexStart[cell.id] / 3;
			const last = cellVertexStart[cell.id + 1] / 3 - 1;
			assert.equal(last - first + 1, cell.boundaryFaceIds.length);
			assert.equal(getCellOfTriangle(cellVertexStart, first), cell.id);
			assert.equal(getCellOfTriangle(cellVertexStart, last), cell.id);
		}
		const pentagons = world.cells.filter((cell) => cell.neighbors.length === 5);
		assert.equal(pentagons.length, 12);
		for (const cell of pentagons) assert.equal(getCellOfTriangle(cellVertexStart, cellVertexStart[cell.id] / 3 + 4), cell.id);
		for (const pole of [1, -1]) {
			const cell = world.cells.reduce((best, other) => (other.center[1] * pole > best.center[1] * pole ? other : best));
			assert.ok(cell.center[1] * pole > 0.99);
			assert.equal(getCellOfTriangle(cellVertexStart, cellVertexStart[cell.id] / 3 + 1), cell.id);
		}
	}
});

test("a triangle outside the mesh is rejected", () => {
	const { cellVertexStart } = buildCellMeshData(worlds[0]);
	const triangles = cellVertexStart[worlds[0].cells.length] / 3;
	for (const triangle of [-1, triangles, triangles + 5, 1.5, Number.NaN, undefined]) {
		assert.throws(() => getCellOfTriangle(cellVertexStart, triangle), RangeError, String(triangle));
	}
});

test("a click is a release near where the press began; a drag, another button, or a stray release is not", () => {
	const detector = createClickDetector();
	detector.down({ x: 100, y: 100, button: 0 });
	assert.equal(detector.up({ x: 102, y: 103, button: 0 }), true);
	assert.equal(detector.up({ x: 102, y: 103, button: 0 }), false, "a release counts only once");
	detector.down({ x: 100, y: 100, button: 0 });
	assert.equal(detector.up({ x: 130, y: 100, button: 0 }), false, "an orbit drag is not a click");
	detector.down({ x: 100, y: 100, button: 0 });
	assert.equal(detector.up({ x: 104, y: 100, button: 0 }), true, "4 pixels still counts");
	detector.down({ x: 100, y: 100, button: 0 });
	assert.equal(detector.up({ x: 105, y: 100, button: 0 }), false, "5 pixels does not");
	for (const button of [1, 2]) {
		detector.down({ x: 5, y: 5, button });
		assert.equal(detector.up({ x: 5, y: 5, button }), false, `button ${button}`);
	}
	detector.down({ x: 5, y: 5, button: 2 });
	assert.equal(detector.up({ x: 5, y: 5, button: 0 }), false, "a different button");
	assert.equal(detector.up({ x: 5, y: 5 }), false, "no press first");
	detector.down({ x: 5, y: 5 });
	detector.cancel();
	assert.equal(detector.up({ x: 5, y: 5 }), false, "cancelled");
	assert.equal(createClickDetector({ maxMove: 20 }).up({ x: 0, y: 0 }), false);
	const loose = createClickDetector({ maxMove: 20 });
	loose.down({ x: 0, y: 0 });
	assert.equal(loose.up({ x: 15, y: 10 }), true);
});

test("a cell's outline is its boundary corners in order, just above the surface", () => {
	const world = worlds[1];
	const pentagon = world.cells.find((cell) => cell.neighbors.length === 5);
	const hexagon = world.cells.find((cell) => cell.neighbors.length === 6);
	assert.equal(buildCellOutline(world, pentagon.id).length, 15);
	assert.equal(buildCellOutline(world, hexagon.id).length, 18);
	const outline = buildCellOutline(world, hexagon.id);
	hexagon.boundaryFaceIds.forEach((faceId, index) => {
		const face = world.faces[faceId];
		const height = RADIUS + face.cellIds.reduce((total, id) => total + world.cells[id].surfaceElevation, 0) / face.cellIds.length;
		const point = Array.from(outline.slice(index * 3, index * 3 + 3));
		assert.ok(Math.abs(Math.hypot(...point) - height * 1.004) < 1e-4, `corner ${index}`);
		const direction = point.map((value) => value / Math.hypot(...point));
		direction.forEach((value, axis) => assert.ok(Math.abs(value - face.center[axis]) < 1e-5));
	});
	assert.throws(() => buildCellOutline(world, -1), RangeError);
	assert.throws(() => buildCellOutline(world, world.cells.length), RangeError);
});

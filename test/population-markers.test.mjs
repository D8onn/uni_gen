import assert from "node:assert/strict";
import test from "node:test";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";
import {
	getMarkerSize,
	getMarkerUnit,
	LARGE_UNIT,
	MAX_MARKERS,
	placeMarkers,
	SMALL_UNIT,
} from "../src/utility/planet/populationMarkers.js";
import { createSeededRandom } from "../src/utility/planet/seededRandom.js";

const world = createGlobeMap({ poleToPoleCells: 20, seed: 3, radius: 10 });
const land = world.cells.filter((cell) => cell.biome !== "Water");

// `total` organisms on seeded random land cells.
function randomCounts(total, seed = 9) {
	const random = createSeededRandom(seed);
	const counts = new Uint32Array(world.cells.length);
	for (let index = 0; index < total; index++) counts[land[Math.floor(random() * land.length)].id] += 1;
	return counts;
}

const sum = (values) => values.reduce((total, value) => total + value, 0);

test("the marker unit is 100 until 10,000 organisms, then 1000, and drops back only below 8,000", () => {
	assert.equal(getMarkerUnit(0), SMALL_UNIT);
	assert.equal(getMarkerUnit(9999), SMALL_UNIT);
	assert.equal(getMarkerUnit(10000), LARGE_UNIT);
	assert.equal(getMarkerUnit(250000), LARGE_UNIT);
	assert.equal(getMarkerUnit(9999, LARGE_UNIT), LARGE_UNIT);
	assert.equal(getMarkerUnit(8000, LARGE_UNIT), LARGE_UNIT);
	assert.equal(getMarkerUnit(7999, LARGE_UNIT), SMALL_UNIT);
	assert.equal(getMarkerUnit(9500, SMALL_UNIT), SMALL_UNIT);
});

test("the large marker is bigger than the small one, and other units are rejected", () => {
	assert.equal(getMarkerSize(LARGE_UNIT), 2 * getMarkerSize(SMALL_UNIT));
	assert.throws(() => getMarkerSize(500), RangeError);
	assert.throws(() => placeMarkers(world, randomCounts(10), 500), RangeError);
});

test("an empty population has no markers and any population has at least one", () => {
	assert.deepEqual(placeMarkers(world, new Uint32Array(world.cells.length), SMALL_UNIT), []);
	for (const total of [1, 49, 100, 149]) {
		assert.equal(placeMarkers(world, randomCounts(total), SMALL_UNIT).length, 1, `${total} organisms`);
	}
});

test("there is one marker per unit of organisms, rounded to the nearest whole group", () => {
	const expected = [
		[150, SMALL_UNIT, 2],
		[1000, SMALL_UNIT, 10],
		[1049, SMALL_UNIT, 10],
		[1050, SMALL_UNIT, 11],
		[10000, LARGE_UNIT, 10],
		[14000, LARGE_UNIT, 14],
	];
	for (const [total, unit, markers] of expected) {
		assert.equal(placeMarkers(world, randomCounts(total), unit).length, markers, `${total} organisms, unit ${unit}`);
	}
});

test("the markers account for every organism in groups whose sizes differ by at most one", () => {
	for (const [total, unit] of [[1234, SMALL_UNIT], [4321, SMALL_UNIT], [12000, LARGE_UNIT]]) {
		const markers = placeMarkers(world, randomCounts(total), unit);
		const sizes = markers.map(({ organisms }) => organisms);
		assert.equal(sum(sizes), total);
		assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${total}: ${sizes}`);
		assert.ok(Math.abs(sizes[0] - unit) <= unit * 0.1, "groups are close to the unit");
	}
});

test("every marker sits on an occupied cell, and the same counts always give the same markers", () => {
	const counts = randomCounts(3000);
	const markers = placeMarkers(world, counts, SMALL_UNIT);
	for (const { cellId } of markers) assert.ok(counts[cellId] > 0, `cell ${cellId} is empty`);
	assert.deepEqual(placeMarkers(world, counts, SMALL_UNIT), markers);
	assert.deepEqual(placeMarkers(world, [...counts], SMALL_UNIT), markers);
});

test("a marker stays with the organisms it stands for", () => {
	const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	const poleward = (axis, sign) => land.filter((cell) => cell.center[axis] * sign > 0.8);
	const east = poleward(0, 1);
	const west = poleward(0, -1);
	assert.ok(east.length > 3 && west.length > 3, "the test world has land on both sides");
	const counts = new Uint32Array(world.cells.length);
	for (let index = 0; index < 100; index++) {
		counts[east[index % east.length].id] += 1;
		counts[west[index % west.length].id] += 1;
	}
	const markers = placeMarkers(world, counts, SMALL_UNIT);
	assert.equal(markers.length, 2);
	const sides = markers.map(({ cellId }) => Math.sign(world.cells[cellId].center[0])).sort();
	assert.deepEqual(sides, [-1, 1], "each marker is in its own cluster, not between them");
	for (const { cellId } of markers) assert.ok(Math.abs(dot(world.cells[cellId].center, [1, 0, 0])) > 0.8);
});

test("groups are compact: eight tight clusters, one per octant, each get their own marker", () => {
	const random = createSeededRandom(5);
	const cells = [];
	const counts = [];
	for (const signs of [[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1], [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]]) {
		for (let member = 0; member < 5; member++) {
			const center = signs.map((sign) => sign * 0.577 + (random() - 0.5) * 0.1);
			const length = Math.hypot(...center);
			cells.push({ center: center.map((value) => value / length) });
			counts.push(20);
		}
	}
	const markers = placeMarkers({ cells }, counts, SMALL_UNIT);
	assert.equal(markers.length, 8);
	const octants = markers.map(({ cellId }) => cells[cellId].center.map((value) => Math.sign(value)).join());
	assert.equal(new Set(octants).size, 8, `markers in octants ${octants.join(" | ")}`);
	for (const { cellId, organisms } of markers) assert.equal(organisms, 100, `cell ${cellId}`);
});

test("a small change in the counts moves few markers", () => {
	const counts = randomCounts(1200);
	const before = placeMarkers(world, counts, SMALL_UNIT);
	assert.equal(before.length, 12);
	let worst = 0;
	for (const cell of land) {
		const changed = Uint32Array.from(counts);
		changed[cell.id] += 1;
		const after = placeMarkers(world, changed, SMALL_UNIT);
		if (after.length !== before.length) continue;
		worst = Math.max(worst, after.filter(({ cellId }, index) => cellId !== before[index].cellId).length);
	}
	assert.ok(worst <= 2, `one extra organism moved ${worst} of ${before.length} markers`);
});

test("the number of markers never exceeds MAX_MARKERS, and the groups still hold everyone", () => {
	const counts = randomCounts(40000);
	const markers = placeMarkers(world, counts, SMALL_UNIT);
	assert.equal(markers.length, MAX_MARKERS);
	assert.equal(sum(markers.map(({ organisms }) => organisms)), 40000);
});

test("a group whose centre cancels out gets the heaviest cell, the lower id on a tie", () => {
	const antipodal = { cells: [{ center: [1, 0, 0] }, { center: [-1, 0, 0] }] };
	assert.deepEqual(placeMarkers(antipodal, [50, 50], LARGE_UNIT), [{ cellId: 0, organisms: 100 }]);
	// Two antipodal pairs cancel exactly even with different weights, so the heavier pair's first cell wins.
	const cross = { cells: [{ center: [1, 0, 0] }, { center: [-1, 0, 0] }, { center: [0, 1, 0] }, { center: [0, -1, 0] }] };
	assert.deepEqual(placeMarkers(cross, [30, 30, 50, 50], LARGE_UNIT), [{ cellId: 2, organisms: 160 }]);
	assert.deepEqual(placeMarkers(cross, [50, 50, 30, 30], LARGE_UNIT), [{ cellId: 0, organisms: 160 }]);
});

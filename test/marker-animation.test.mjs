import assert from "node:assert/strict";
import test from "node:test";
import { createHabitat } from "../src/utility/ecology/habitat.js";
import { createPopulation, EVOLVING_PRODUCER, getCellCounts, stepPopulation } from "../src/utility/ecology/population.js";
import { createMarkerAnimator, pairMarkers } from "../src/utility/planet/markerAnimation.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";
import { getMarkerUnit, placeMarkers } from "../src/utility/planet/populationMarkers.js";

const X = [1, 0, 0];
const Y = [0, 1, 0];
const Z = [0, 0, 1];
const near = (vector, ...rest) => {
	const length = Math.hypot(...vector, ...rest) || 1;
	return [vector[0] / length, vector[1] / length, vector[2] / length];
};
const target = (direction, radius = 0.3, height = 10) => ({ direction, height, radius });
const settle = (animator, seconds = 10) => {
	for (let step = 0; step < seconds * 10; step++) animator.step(0.1);
};

test("pairing matches each new marker to the nearest old one, once each", () => {
	assert.deepEqual(pairMarkers([X, Y, Z], [X, Y, Z]).match, [0, 1, 2]);
	// The same markers listed in another order still continue themselves.
	assert.deepEqual(pairMarkers([X, Y, Z], [Z, X, Y]).match, [2, 0, 1]);
	const nudged = pairMarkers([X, Y], [near([1, 0.1, 0]), near([0.1, 1, 0]), near([-1, 0, 0])]);
	assert.deepEqual(nudged.match, [0, 1, -1]);
	const { match } = pairMarkers([X, Y, Z], [near([1, 1, 0]), near([1, 0.9, 0])]);
	assert.equal(new Set(match.filter((index) => index !== -1)).size, 2, "no old marker is used twice");
});

test("an unmatched new marker grows from the nearest old one, and an unmatched old one merges into the nearest new one", () => {
	const more = pairMarkers([X, Y], [X, Y, near([1, 0.2, 0])]);
	assert.deepEqual(more.match.filter((index) => index === -1).length, 1);
	assert.equal(more.spawn[more.match.indexOf(-1)], 0);
	assert.deepEqual(more.retire, []);
	const fewer = pairMarkers([X, Y, near([0.9, 0.3, 0])], [X, Y]);
	assert.deepEqual(fewer.retire, [{ from: 2, into: 0 }]);
	assert.deepEqual(pairMarkers([], [X]), { match: [-1], spawn: [-1], retire: [] });
	assert.deepEqual(pairMarkers([X], []), { match: [], spawn: [], retire: [{ from: 0, into: -1 }] });
});

test("pairing is deterministic, including ties", () => {
	const tied = [near([1, 1, 0]), near([1, -1, 0])];
	assert.deepEqual(pairMarkers([X], tied), pairMarkers([X], tied));
	assert.equal(pairMarkers([X], tied).match.indexOf(0), 0, "the lower index wins a tie");
});

test("markers grow in place the first time, then settle on their targets", () => {
	const animator = createMarkerAnimator();
	animator.set([target(X, 0.3, 10.2), target(Y, 0.3, 10.5)]);
	assert.deepEqual(animator.markers.map(({ radius }) => radius), [0, 0]);
	assert.deepEqual(animator.markers.map(({ direction }) => direction), [X, Y]);
	assert.equal(animator.step(0.1), true);
	assert.ok(animator.markers.every(({ radius }) => radius > 0 && radius < 0.3));
	settle(animator);
	assert.ok(animator.markers.every(({ radius }) => Math.abs(radius - 0.3) < 1e-3));
	assert.ok(Math.abs(animator.markers[0].height - 10.2) < 1e-3 && Math.abs(animator.markers[1].height - 10.5) < 1e-3);
	assert.equal(animator.step(0.1), false, "nothing changes once everything has settled");
	assert.equal(animator.step(0), false);
});

test("markers reordered or nudged keep their place instead of crossing the globe", () => {
	const animator = createMarkerAnimator();
	animator.set([target(X), target(Y), target(Z)]);
	settle(animator);
	const before = animator.markers.map(({ direction }) => near(direction));
	const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
	// The same three places listed in the opposite order, with the middle one nudged slightly.
	animator.set([target(Z), target(near([0.1, 1, 0])), target(X)]);
	animator.step(0.1);
	for (const { direction } of animator.markers) {
		const closest = Math.min(...before.map((place) => distance(near(direction), place)));
		assert.ok(closest < 0.1, `a marker moved ${closest} (chord) from every place it was`);
	}
	settle(animator);
	const settled = animator.markers.map(({ direction }) => near(direction));
	assert.ok(distance(settled[0], Z) < 1e-3 && distance(settled[2], X) < 1e-3);
	assert.ok(distance(settled[1], near([0.1, 1, 0])) < 1e-3);
});

test("a new marker grows out of its nearest neighbour, and a removed one shrinks into its neighbour and is dropped", () => {
	const animator = createMarkerAnimator();
	animator.set([target(X), target(Y)]);
	settle(animator);
	animator.set([target(X), target(Y), target(near([1, 0.3, 0]))]);
	const grown = animator.markers.find(({ radius }) => radius === 0);
	assert.deepEqual(grown.direction, X, "it starts on the marker it grows from");
	settle(animator);
	assert.equal(animator.markers.length, 3);

	animator.set([target(X), target(Y)]);
	assert.equal(animator.markers.length, 3, "the removed marker is still drawn while it shrinks");
	assert.equal(animator.markers.filter(({ dying }) => dying).length, 1);
	animator.step(0.1);
	const shrinking = animator.markers.find(({ dying }) => dying);
	assert.ok(shrinking.radius < 0.3);
	settle(animator);
	assert.equal(animator.markers.length, 2);
	assert.ok(animator.markers.every(({ dying }) => !dying));
});

test("the animator draws at most maxMarkers, dropping the oldest shrinking markers first", () => {
	const animator = createMarkerAnimator({ maxMarkers: 4 });
	animator.set([target(X), target(Y), target(Z)]);
	settle(animator);
	animator.set([target(X)]);
	assert.deepEqual(animator.markers.map(({ dying }) => dying), [false, true, true]);
	animator.set([target(X), target(near([1, 1, 1])), target(near([-1, 1, 1])), target(near([-1, -1, 1]))]);
	assert.equal(animator.markers.length, 4);
	assert.ok(animator.markers.slice(0, 4).every(({ dying }) => !dying), "live markers are never dropped for shrinking ones");
});

test("a growing population does not send markers across the globe when their number changes", () => {
	const radius = 10;
	const world = createGlobeMap({ poleToPoleCells: 40, seed: 42, radius });
	const habitat = createHabitat(world);
	const population = createPopulation(world, { seed: 42, initialCount: 600, species: { ...EVOLVING_PRODUCER, dispersalChance: 0.1 } });
	const arc = (a, b) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * radius;
	const quantile = (values, share) => [...values].sort((a, b) => a - b)[Math.floor(share * (values.length - 1))];

	let unit = 100;
	let previous = null;
	let countChanges = 0;
	const byIndex = [];
	const byNearest = [];
	for (let tick = 0; tick <= 150; tick++) {
		if (tick > 0) stepPopulation(population, habitat, 1);
		unit = getMarkerUnit(population.organisms.length, unit);
		const directions = placeMarkers(world, getCellCounts(population), unit).map(({ cellId }) => world.cells[cellId].center);
		if (previous !== null && previous.length !== directions.length) {
			countChanges += 1;
			for (let index = 0; index < Math.min(previous.length, directions.length); index++) byIndex.push(arc(previous[index], directions[index]));
			pairMarkers(previous, directions).match.forEach((from, to) => from !== -1 && byNearest.push(arc(previous[from], directions[to])));
		}
		previous = directions;
	}
	assert.ok(countChanges >= 15, `the run changed the marker count only ${countChanges} times`);
	// Pairing by position in the list (the earlier approach) sends markers up to half way round the globe (31 units here).
	assert.ok(quantile(byIndex, 0.9) > 10 && quantile(byIndex, 1) > 25);
	assert.ok(quantile(byNearest, 0.5) <= 1.5, `median ${quantile(byNearest, 0.5)}`);
	assert.ok(quantile(byNearest, 0.9) <= 5, `p90 ${quantile(byNearest, 0.9)}`);
	assert.ok(quantile(byNearest, 1) <= 12, `max ${quantile(byNearest, 1)}`);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createApplyTracker } from "../src/ui/applyTracker.js";

const START = { seed: 12345, founders: 500, species: "evolving", dispersal: 0.1, speed: 10 };
const REJECTED = { ...START, founders: 100000, maxPerCell: 1 };
const VALID = { ...START, maxPerCell: 40 };

// The snapshot the worker posts while running `params` for the configure with `appliedRequest`.
const snapshotOf = (params, appliedRequest) => ({ type: "snapshot", params: { ...params }, appliedRequest });

test("an Apply counts as applied once a snapshot reports its request", () => {
	const tracker = createApplyTracker(START);
	assert.deepEqual(tracker.applied(), START);
	assert.equal(tracker.pending(), null);
	const requestId = tracker.apply(VALID);
	assert.deepEqual(tracker.pending(), { requestId, params: VALID });
	assert.equal(tracker.snapshot(snapshotOf(START, null)), false);
	assert.deepEqual(tracker.pending(), { requestId, params: VALID });
	assert.equal(tracker.snapshot(snapshotOf(VALID, requestId)), true);
	assert.deepEqual(tracker.applied(), VALID);
	assert.equal(tracker.pending(), null);
});

test("request ids increase from 1", () => {
	const tracker = createApplyTracker(START);
	assert.deepEqual([tracker.apply(VALID), tracker.apply(VALID), tracker.apply(VALID)], [1, 2, 3]);
});

test("an error about the pending Apply clears it and keeps the applied settings", () => {
	const tracker = createApplyTracker(START);
	const requestId = tracker.apply(REJECTED);
	assert.equal(tracker.failed(requestId), true);
	assert.equal(tracker.pending(), null);
	assert.deepEqual(tracker.applied(), START);
	assert.equal(tracker.snapshot(snapshotOf(START, null)), false);
	assert.deepEqual(tracker.applied(), START);
});

test("a rejected Apply followed by a valid one before the worker answers keeps the valid one pending", () => {
	const tracker = createApplyTracker(START);
	const rejected = tracker.apply(REJECTED);
	const valid = tracker.apply(VALID);
	// The worker answers in order: the error for the rejected Apply and the unchanged run, then the valid run.
	assert.equal(tracker.failed(rejected), false);
	assert.deepEqual(tracker.pending(), { requestId: valid, params: VALID });
	assert.equal(tracker.snapshot(snapshotOf(START, null)), false);
	assert.deepEqual(tracker.pending(), { requestId: valid, params: VALID });
	assert.equal(tracker.snapshot(snapshotOf(VALID, valid)), true);
	assert.deepEqual(tracker.applied(), VALID);
	assert.equal(tracker.pending(), null);
});

test("Reset while an Apply is in flight targets the Apply, which the worker runs first", () => {
	const tracker = createApplyTracker(START);
	assert.deepEqual(tracker.resetTarget(), START);
	const selection = { ...START, selectionStrength: 1 };
	const requestId = tracker.apply(selection);
	assert.deepEqual(tracker.resetTarget(), selection);
	// The worker posts a snapshot after the configure and another after the reset, both running the Apply.
	assert.equal(tracker.snapshot(snapshotOf(selection, requestId)), true);
	assert.equal(tracker.snapshot(snapshotOf(selection, requestId)), false);
	assert.deepEqual(tracker.applied(), selection);
	assert.deepEqual(tracker.resetTarget(), selection);
});

test("two quick Applies: the first snapshot is applied while the second stays pending", () => {
	const tracker = createApplyTracker(START);
	const first = tracker.apply({ ...START, founders: 600 });
	const second = tracker.apply(VALID);
	assert.equal(tracker.snapshot(snapshotOf({ ...START, founders: 600 }, first)), false);
	assert.deepEqual(tracker.applied(), { ...START, founders: 600 });
	assert.deepEqual(tracker.pending(), { requestId: second, params: VALID });
	assert.equal(tracker.snapshot(snapshotOf(VALID, second)), true);
	assert.deepEqual(tracker.applied(), VALID);
});

test("a speed change while an Apply is pending carries over to the Apply's settings", () => {
	const confirmed = createApplyTracker(START);
	const requestId = confirmed.apply(VALID);
	confirmed.setSpeed(50);
	assert.equal(confirmed.applied().speed, 50);
	assert.deepEqual(confirmed.pending(), { requestId, params: { ...VALID, speed: 50 } });
	assert.deepEqual(confirmed.resetTarget(), { ...VALID, speed: 50 });
	// The worker handles the configure (old speed) before the speed message, then reports the new speed.
	assert.equal(confirmed.snapshot(snapshotOf(VALID, requestId)), true);
	confirmed.snapshot(snapshotOf({ ...VALID, speed: 50 }, requestId));
	assert.deepEqual(confirmed.applied(), { ...VALID, speed: 50 });

	const rejected = createApplyTracker(START);
	const failing = rejected.apply(REJECTED);
	rejected.setSpeed(50);
	assert.equal(rejected.failed(failing), true);
	assert.deepEqual(rejected.applied(), { ...START, speed: 50 });
});

test("unrelated or missing ids and unrelated snapshots leave the pending Apply alone", () => {
	const tracker = createApplyTracker(START);
	assert.equal(tracker.failed(null), false);
	assert.equal(tracker.failed(undefined), false);
	assert.equal(tracker.failed(1), false);
	const requestId = tracker.apply(VALID);
	for (const id of [null, undefined, requestId + 1, 0]) {
		assert.equal(tracker.failed(id), false, String(id));
		assert.equal(tracker.snapshot(snapshotOf(START, id)), false, String(id));
	}
	assert.deepEqual(tracker.pending(), { requestId, params: VALID });
	assert.deepEqual(tracker.applied(), START);
});

test("the tracker does not change the params it is given", () => {
	const initial = structuredClone(START);
	const next = structuredClone(VALID);
	const tracker = createApplyTracker(initial);
	tracker.apply(next);
	tracker.setSpeed(50);
	tracker.failed(1);
	tracker.setSpeed(60);
	assert.deepEqual(initial, START);
	assert.deepEqual(next, VALID);
});

test("stop-condition request ids share the Apply sequence and leave the pending Apply alone", () => {
	const tracker = createApplyTracker(START);
	assert.equal(tracker.nextRequestId(), 1);
	const requestId = tracker.apply(VALID);
	assert.equal(requestId, 2);
	assert.equal(tracker.nextRequestId(), 3);
	assert.deepEqual(tracker.pending(), { requestId, params: VALID });
	assert.equal(tracker.failed(3), false);
	assert.deepEqual(tracker.pending(), { requestId, params: VALID });
	assert.equal(tracker.apply(VALID), 4);
});

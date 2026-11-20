import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSimulation } from "../src/utility/ecology/simulation.js";
import { createSimulationController } from "../src/utility/ecology/simulationController.js";
import { extractSimulationInput } from "../src/utility/ecology/simulationInput.js";
import { parseSimulationParams, toSearchParams, validateSimulationParams } from "../src/utility/ecology/simulationParams.js";
import { assertStopSettable, STOP_KINDS, stopHolds, validateStopCondition } from "../src/utility/ecology/stopCondition.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";

// The helpers below copy those in simulation.test.mjs, which does not export them.
const CELLS = 20;
const PARAMS = { seed: 7, founders: 60, species: "evolving", dispersal: 0.2, speed: 10 };
const EXTINCT = { ...PARAMS, seed: 8, founders: 2 }; // dies out at tick 147 on the 20-cell world

const worlds = new Map();
function worldFor(seed) {
	if (!worlds.has(seed)) worlds.set(seed, createGlobeMap({ poleToPoleCells: CELLS, seed }));
	return worlds.get(seed);
}
function inputFor(seed) {
	return structuredClone(extractSimulationInput(worldFor(seed)));
}
function configured(params) {
	const simulation = createSimulation();
	simulation.setWorld(inputFor(params.seed));
	simulation.configure(params);
	return simulation;
}
// The simulation state alone, without the params and the stop fields that differ between the runs compared.
function stateOf({ params, stopped, extinctTick, ...snapshot }) {
	return snapshot;
}

// The ticks (1-based) and counts of an unconditioned run, one tick at a time.
function referenceCounts(params, ticks) {
	const simulation = configured(params);
	const counts = [];
	for (let tick = 1; tick <= ticks; tick++) {
		simulation.step(1);
		counts.push({ tick, count: simulation.snapshot().summary.count });
	}
	return counts;
}

function createHarness(seed = PARAMS.seed) {
	let time = 0;
	let pending = null;
	const messages = [];
	const controller = createSimulationController({
		post: (message) => messages.push(message),
		now: () => time,
		schedule: (callback) => (pending = callback),
		cancel: () => (pending = null),
	});
	controller.handle({ type: "world", input: inputFor(seed) });
	return {
		controller,
		messages,
		advance(ms) {
			time += ms;
			const callback = pending;
			pending = null;
			callback?.();
		},
		get scheduled() {
			return pending !== null;
		},
		last: (type) => messages.findLast((message) => message.type === type),
	};
}

const isRangeError = (pattern) => (error) => error instanceof RangeError && pattern.test(error.message);

test("stop and stopAt parse, validate, and round-trip canonically", () => {
	const parsed = parseSimulationParams("?seed=12345&stop=tick&stopAt=50");
	assert.equal(parsed.stop, "tick");
	assert.equal(parsed.stopAt, 50);
	assert.deepEqual(parseSimulationParams(toSearchParams(parsed)), parsed);
	assert.equal(toSearchParams(parsed).toString(), "seed=12345&founders=1000&species=evolving&dispersal=0.1&speed=10&stop=tick&stopAt=50");
	assert.equal(toSearchParams(parseSimulationParams("?seed=1&stop=extinct")).toString(), "seed=1&founders=1000&species=evolving&dispersal=0.1&speed=10&stop=extinct");
	const none = parseSimulationParams("?seed=12345&stop=none");
	assert.equal("stop" in none, false);
	assert.equal(toSearchParams(none).toString(), "seed=12345&founders=1000&species=evolving&dispersal=0.1&speed=10");
	const invalid = [
		["stopAt=5", /stopAt must be left out when stop is none/],
		["stop=extinct&stopAt=5", /stopAt must be left out when stop is extinct/],
		["stop=bogus", /stop must be one of: none, tick, extinct, count-above, count-below/],
		["stop=tick&stopAt=0", /stopAt must be an integer of 1 or more/],
		["stop=tick", /stopAt must be an integer/],
		["stop=tick&stopAt=", /stopAt must not be empty/],
		["stop=count-above&stopAt=-1", /stopAt must be an integer of 0 or more/],
		["stop=count-below&stopAt=2.5", /stopAt must be an integer/],
		["stop=count-below&stopAt=0", /stopAt must be an integer of 1 or more when stop is count-below/],
		["stop=extinct&founders=0", /stop=extinct needs at least one founder/],
	];
	for (const [query, pattern] of invalid) {
		assert.throws(() => parseSimulationParams(`?seed=1&${query}`), isRangeError(pattern), query);
	}
});

test("the stop condition helpers follow their rules", () => {
	assert.deepEqual(STOP_KINDS, ["none", "tick", "extinct", "count-above", "count-below"]);
	assert.deepEqual(validateStopCondition(undefined, undefined, { founders: 5 }), {});
	assert.deepEqual(validateStopCondition("count-above", 0, { founders: 5 }), { stop: "count-above", stopAt: 0 });
	assert.throws(() => validateStopCondition("count-below", 0, { founders: 5 }), isRangeError(/stopAt must be an integer of 1 or more when stop is count-below/));
	assert.equal(stopHolds("none", undefined, { tick: 3, count: 0 }), false);
	assert.equal(stopHolds("tick", 3, { tick: 3, count: 9 }), true);
	assert.equal(stopHolds("count-above", 9, { tick: 3, count: 9 }), false);
	assert.equal(stopHolds("count-below", 9, { tick: 3, count: 8 }), true);
	assert.doesNotThrow(() => assertStopSettable("count-above", 9, { tick: 3, count: 9 }));
	assert.doesNotThrow(() => assertStopSettable("count-below", 9, { tick: 3, count: 9 }));
	assert.throws(() => assertStopSettable("tick", 3, { tick: 3, count: 9 }), isRangeError(/stopAt 3 is not after the current tick 3/));
});

test("a batch step stops exactly on the target tick", () => {
	const simulation = configured(PARAMS);
	simulation.setStop("tick", 7);
	assert.deepEqual(simulation.step(20), { reason: "tick", tick: 7 });
	const stoppedAt = simulation.snapshot();
	assert.equal(stoppedAt.summary.tick, 7);
	assert.deepEqual(stoppedAt.stopped, { reason: "tick", tick: 7 });
	const single = configured(PARAMS);
	for (let tick = 0; tick < 7; tick++) assert.equal(single.step(1), null);
	assert.deepEqual(stateOf(stoppedAt), stateOf(single.snapshot()));
	assert.throws(() => simulation.step(-1), isRangeError(/ticks must be a non-negative integer/));
	assert.throws(() => simulation.step(1.5), isRangeError(/ticks must be a non-negative integer/));
});

test("count conditions stop on the reference run's first crossing", () => {
	const reference = referenceCounts(PARAMS, 40);
	const firstBelow = reference.find(({ count }) => count < 57);
	const firstAbove = reference.find(({ count }) => count > 100);
	assert.deepEqual([firstBelow.tick, firstAbove.tick], [5, 18]);
	const below = configured({ ...PARAMS, stop: "count-below", stopAt: 57 });
	assert.deepEqual(below.step(40), { reason: "count", tick: 5 });
	assert.equal(below.snapshot().summary.count, firstBelow.count);
	const above = configured({ ...PARAMS, stop: "count-above", stopAt: 100 });
	assert.deepEqual(above.step(40), { reason: "count", tick: 18 });
	assert.equal(above.snapshot().summary.count, firstAbove.count);
});

test("an extinct run reports its extinction tick, with or without a stop condition", () => {
	const plain = configured(EXTINCT);
	assert.equal(plain.step(200), null);
	assert.equal(plain.snapshot().extinctTick, 147);
	assert.equal(plain.snapshot().summary.count, 0);
	assert.equal(plain.snapshot().summary.tick, 200);
	assert.equal(referenceCounts(EXTINCT, 200).find(({ count }) => count === 0).tick, 147);
	const stopping = configured({ ...EXTINCT, stop: "extinct" });
	assert.deepEqual(stopping.step(200), { reason: "extinct", tick: 147 });
	assert.equal(stopping.snapshot().summary.tick, 147);
	assert.equal(stopping.snapshot().extinctTick, 147);
});

test("zero founders never count as extinct and cannot stop on extinction", () => {
	const empty = { ...PARAMS, founders: 0 };
	assert.throws(() => configured({ ...empty, stop: "extinct" }), isRangeError(/stop=extinct needs at least one founder/));
	const simulation = configured(empty);
	simulation.step(10);
	assert.equal(simulation.snapshot().summary.tick, 10);
	assert.equal(simulation.snapshot().extinctTick, null);
	assert.throws(() => simulation.setStop("extinct"), isRangeError(/stop=extinct needs at least one founder/));
});

test("a fired condition is spent until reset, configure, or a new condition", () => {
	const simulation = configured({ ...PARAMS, stop: "tick", stopAt: 7 });
	assert.deepEqual(simulation.step(10), { reason: "tick", tick: 7 });
	assert.equal(simulation.step(3), null);
	assert.equal(simulation.snapshot().summary.tick, 10);
	assert.equal(simulation.snapshot().stopped, null);
	simulation.reset();
	assert.deepEqual(simulation.step(10), { reason: "tick", tick: 7 });
	simulation.configure({ ...PARAMS, stop: "tick", stopAt: 7 });
	assert.deepEqual(simulation.step(10), { reason: "tick", tick: 7 });
	simulation.setStop("tick", 9);
	assert.deepEqual(simulation.step(10), { reason: "tick", tick: 9 });
	// A count condition already true does not fire until the count crosses again.
	const counts = configured({ ...PARAMS, stop: "count-below", stopAt: 57 });
	assert.deepEqual(counts.step(40), { reason: "count", tick: 5 });
	assert.equal(counts.step(1), null);
	// After a reset the count starts below 70, so the condition waits for a fresh crossing rather than firing on tick 1.
	const waiting = configured(PARAMS);
	waiting.step(18);
	waiting.setStop("count-below", 70);
	waiting.reset();
	assert.equal(waiting.step(10), null);
	assert.equal(waiting.snapshot().summary.tick, 10);
});

test("a spent count condition does not fire again when the count crosses its limit a second time", () => {
	const limit = 296;
	const reference = referenceCounts(PARAMS, 200);
	const crossings = reference.filter(({ tick, count }) => count > limit && (tick === 1 ? PARAMS.founders : reference[tick - 2].count) <= limit);
	assert.ok(crossings.length >= 2, "the reference crosses the limit twice");
	const [first, second] = crossings;
	const simulation = configured({ ...PARAMS, stop: "count-above", stopAt: limit });
	assert.deepEqual(simulation.step(200), { reason: "count", tick: first.tick });
	assert.equal(simulation.step(second.tick - first.tick), null);
	assert.equal(simulation.snapshot().summary.tick, second.tick);
});

test("a condition set mid-run that already holds or names a reached tick is rejected", () => {
	const simulation = configured(PARAMS);
	simulation.step(7);
	assert.throws(() => simulation.setStop("tick", 5), isRangeError(/stopAt 5 is not after the current tick 7/));
	assert.throws(() => simulation.setStop("tick", 7), isRangeError(/current tick 7/));
	simulation.step(11);
	assert.equal(simulation.snapshot().summary.count, 106);
	assert.throws(() => simulation.setStop("count-above", 100), isRangeError(/The count 106 is already above 100/));
	assert.throws(() => simulation.setStop("count-below", 107), isRangeError(/The count 106 is already below 107/));
	assert.throws(() => simulation.setStop("bogus"), isRangeError(/stop must be one of/));
	assert.throws(() => simulation.setStop("count-below", 0), isRangeError(/stopAt must be an integer of 1 or more when stop is count-below/));
	const extinct = configured(EXTINCT);
	extinct.step(150);
	assert.throws(() => extinct.setStop("extinct"), isRangeError(/already extinct/));
	assert.equal(extinct.snapshot().params.stop, undefined);
});

test("playing at speed 200 pauses exactly on the target tick and Play resumes past it", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "configure", params: { ...PARAMS, speed: 200, stop: "tick", stopAt: 40 } });
	harness.controller.handle({ type: "play" });
	harness.advance(1000);
	let snapshot = harness.last("snapshot");
	assert.equal(snapshot.summary.tick, 40);
	assert.equal(snapshot.running, false);
	assert.deepEqual(snapshot.stopped, { reason: "tick", tick: 40 });
	assert.equal(harness.scheduled, false);
	harness.advance(1000);
	assert.equal(harness.last("snapshot").summary.tick, 40);
	harness.controller.handle({ type: "play" });
	harness.advance(100);
	snapshot = harness.last("snapshot");
	assert.equal(snapshot.running, true);
	assert.ok(snapshot.summary.tick > 40);
	assert.equal(snapshot.stopped, null);
	assert.equal(harness.messages.some((message) => message.type === "error"), false);
});

test("Step stops on the target tick through the controller, one tick at a time or in a batch", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "configure", params: { ...PARAMS, stop: "tick", stopAt: 3 } });
	harness.controller.handle({ type: "step", ticks: 1 });
	harness.controller.handle({ type: "step", ticks: 1 });
	assert.equal(harness.last("snapshot").stopped, null);
	harness.controller.handle({ type: "step", ticks: 1 });
	assert.deepEqual(harness.last("snapshot").stopped, { reason: "tick", tick: 3 });
	harness.controller.handle({ type: "stopWhen", stop: "tick", stopAt: 9 });
	harness.controller.handle({ type: "step", ticks: 50 });
	assert.equal(harness.last("snapshot").summary.tick, 9);
	assert.deepEqual(harness.last("snapshot").stopped, { reason: "tick", tick: 9 });
});

test("stopWhen changes the condition mid-run without restarting, and an invalid one names its request", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "configure", params: { ...PARAMS, speed: 20 }, requestId: 1 });
	harness.controller.handle({ type: "play" });
	harness.advance(500);
	harness.controller.handle({ type: "stopWhen", stop: "tick", stopAt: 30, requestId: 2 });
	let snapshot = harness.last("snapshot");
	assert.equal(snapshot.running, true);
	assert.equal(snapshot.summary.tick, 10);
	assert.equal(snapshot.params.stop, "tick");
	assert.equal(snapshot.params.stopAt, 30);
	assert.equal(snapshot.params.speed, 20);
	assert.equal(snapshot.appliedRequest, 1);
	harness.controller.handle({ type: "stopWhen", stop: "tick", stopAt: 5, requestId: 3 });
	assert.equal(harness.last("error").requestId, 3);
	assert.match(harness.last("error").message, /stopAt 5 is not after the current tick 10/);
	snapshot = harness.last("snapshot");
	assert.equal(snapshot.running, true);
	assert.equal(snapshot.params.stopAt, 30);
	harness.advance(500);
	assert.equal(harness.last("snapshot").summary.tick, 20);
	harness.controller.handle({ type: "stopWhen", stop: "none", requestId: 4 });
	assert.equal("stop" in harness.last("snapshot").params, false);
	assert.equal(harness.last("snapshot").running, true);
	const fresh = createHarness();
	fresh.controller.handle({ type: "stopWhen", stop: "tick", stopAt: 5, requestId: 7 });
	assert.match(fresh.last("error").message, /not been configured/);
	assert.equal(fresh.last("error").requestId, 7);
});

test("default params carry no stop fields and nothing has stopped or died out at tick 0", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "configure", params: PARAMS });
	const snapshot = harness.last("snapshot");
	assert.deepEqual(snapshot.params, PARAMS);
	assert.equal(snapshot.stopped, null);
	assert.equal(snapshot.extinctTick, null);
	assert.deepEqual(validateSimulationParams(PARAMS), PARAMS);
});

test("a run started with a condition that already holds waits for its next crossing", () => {
	// Seed 7 starts at 60 organisms, falls to 54 by tick 7, and first rises above 55 again at tick 11.
	const waiting = configured({ ...PARAMS, stop: "count-above", stopAt: 55 });
	assert.deepEqual(waiting.step(40), { reason: "count", tick: 11 });
	const neverCrossed = configured({ ...PARAMS, stop: "count-below", stopAt: 70 });
	assert.equal(neverCrossed.step(30), null);
	assert.deepEqual(neverCrossed.snapshot().params, { ...PARAMS, stop: "count-below", stopAt: 70 });
});

test("a count condition set mid-run serialises, and its URL loads and runs", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "configure", params: PARAMS });
	harness.controller.handle({ type: "step", ticks: 18 });
	assert.equal(harness.last("snapshot").summary.count, 106);
	harness.controller.handle({ type: "stopWhen", stop: "count-below", stopAt: 70, requestId: 1 });
	assert.equal(harness.last("error"), undefined);
	const { params } = harness.last("snapshot");
	const query = toSearchParams(params).toString();
	assert.equal(query, "seed=7&founders=60&species=evolving&dispersal=0.2&speed=10&stop=count-below&stopAt=70");
	const reload = createHarness();
	reload.controller.handle({ type: "configure", params: parseSimulationParams(query) });
	assert.equal(reload.last("error"), undefined);
	assert.deepEqual(reload.last("snapshot").params, params);
	reload.controller.handle({ type: "play" });
	reload.advance(1000);
	assert.equal(reload.last("snapshot").summary.tick, 10);
	assert.equal(reload.last("snapshot").running, true);
	reload.controller.handle({ type: "stopWhen", stop: "none", requestId: 2 });
	assert.deepEqual(reload.last("snapshot").params, PARAMS);
});

// A small seeded generator so the randomised test is reproducible.
function randomFrom(seed) {
	let state = seed >>> 0;
	return (n) => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
		return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
	};
}

test("params from any accepted mid-run stop condition always configure, through the URL too, unchanged", () => {
	const random = randomFrom(2024);
	const kinds = ["none", "tick", "extinct", "count-above", "count-below"];
	let accepted = 0;
	let holdingAtStart = 0;
	for (let trial = 0; trial < 150; trial++) {
		const start = { ...PARAMS, founders: 1 + random(120) };
		const simulation = configured(start);
		simulation.step(random(60));
		const { tick, count } = simulation.snapshot().summary;
		const stop = kinds[random(kinds.length)];
		const stopAt = stop === "tick" ? tick - 5 + random(40) : stop.startsWith("count") ? Math.max(0, count - 60 + random(120)) : undefined;
		try {
			simulation.setStop(stop, stopAt);
		} catch (error) {
			assert.ok(error instanceof RangeError, error.message);
			continue;
		}
		accepted += 1;
		const { params } = simulation.snapshot();
		if ((stop === "count-above" && start.founders > stopAt) || (stop === "count-below" && start.founders < stopAt)) holdingAtStart += 1;
		const label = JSON.stringify(params);
		const loaded = parseSimulationParams(toSearchParams(params).toString());
		assert.deepEqual(loaded, params, label);
		for (const input of [params, loaded]) {
			const restarted = createSimulation();
			restarted.setWorld(inputFor(start.seed));
			assert.doesNotThrow(() => restarted.configure(input), label);
			assert.deepEqual(restarted.snapshot().params, params, label);
		}
	}
	assert.ok(accepted >= 50, `accepted ${accepted}`);
	assert.ok(holdingAtStart >= 5, `holding at tick 0: ${holdingAtStart}`);
});

test("Reset, a fresh load of the URL, and Apply of the same params agree", () => {
	// count-above 55 is valid at tick 7 (54 organisms) but already holds at tick 0 (60), the case a load used to reject.
	const harness = createHarness();
	harness.controller.handle({ type: "configure", params: PARAMS, requestId: 1 });
	harness.controller.handle({ type: "step", ticks: 7 });
	harness.controller.handle({ type: "stopWhen", stop: "count-above", stopAt: 55, requestId: 2 });
	const { params } = harness.last("snapshot");
	assert.deepEqual(params, { ...PARAMS, stop: "count-above", stopAt: 55 });
	const runs = [];
	harness.controller.handle({ type: "reset" });
	harness.controller.handle({ type: "step", ticks: 40 });
	runs.push(harness.last("snapshot"));
	const reload = createHarness();
	reload.controller.handle({ type: "configure", params: parseSimulationParams(toSearchParams(params).toString()) });
	reload.controller.handle({ type: "step", ticks: 40 });
	runs.push(reload.last("snapshot"));
	harness.controller.handle({ type: "configure", params, requestId: 3 });
	harness.controller.handle({ type: "step", ticks: 40 });
	runs.push(harness.last("snapshot"));
	assert.equal(harness.messages.some((message) => message.type === "error") || reload.messages.some((message) => message.type === "error"), false);
	for (const run of runs) {
		assert.deepEqual(run.params, params);
		assert.deepEqual(run.stopped, { reason: "count", tick: 11 });
		assert.deepEqual([run.summary, run.groups, run.cells], [runs[0].summary, runs[0].groups, runs[0].cells]);
	}
});

test("the readme documents stop and stopAt", () => {
	const readme = readFileSync(new URL("../readme.md", import.meta.url), "utf8");
	for (const name of ["stop", "stopAt"]) assert.match(readme, new RegExp(`^\\| \`${name}\` \\|`, "m"), name);
	assert.match(readme, /Extinct at tick N/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createSimulation } from "../src/utility/ecology/simulation.js";
import { createSimulationController } from "../src/utility/ecology/simulationController.js";
import {
	DEFAULT_SIMULATION_PARAMS,
	parseSimulationParams,
	toSearchParams,
	validateSimulationParams,
} from "../src/utility/ecology/simulationParams.js";

const CELLS = 20;
const PARAMS = { seed: 7, founders: 60, species: "evolving", dispersal: 0.2, speed: 10 };

function runTicks(params, chunks) {
	const simulation = createSimulation({ poleToPoleCells: CELLS });
	simulation.configure(params);
	for (const ticks of chunks) simulation.step(ticks);
	return simulation.snapshot();
}

test("parameters default, parse, and round-trip through a query string", () => {
	assert.deepEqual(parseSimulationParams("", { randomSeed: () => 99 }), { seed: 99, ...DEFAULT_SIMULATION_PARAMS });
	const parsed = parseSimulationParams("?seed=12345&founders=250&species=neutral&dispersal=0.5&speed=40");
	assert.deepEqual(parsed, { seed: 12345, founders: 250, species: "neutral", dispersal: 0.5, speed: 40 });
	assert.deepEqual(parseSimulationParams(toSearchParams(parsed)), parsed);
	assert.equal(toSearchParams(parsed).toString(), "seed=12345&founders=250&species=neutral&dispersal=0.5&speed=40");
});

test("invalid parameters throw a RangeError naming the setting", () => {
	const invalid = [
		["seed=", /seed must not be empty/],
		["seed=1.5", /seed must be/],
		["seed=4294967296", /seed must be/],
		["founders=-1", /founders must be/],
		["founders=100001", /founders must be/],
		["founders=abc", /founders must be/],
		["species=trees", /species must be/],
		["dispersal=1.5", /dispersal must be/],
		["dispersal=nope", /dispersal must be/],
		["speed=0", /speed must be/],
		["speed=201", /speed must be/],
	];
	for (const [query, pattern] of invalid) {
		assert.throws(() => parseSimulationParams(query, { randomSeed: () => 1 }), (error) => error instanceof RangeError && pattern.test(error.message), query);
	}
	assert.throws(() => validateSimulationParams({ ...PARAMS, speed: undefined }), RangeError);
});

test("the same parameters give the same simulation however the ticks are chunked", () => {
	const whole = runTicks(PARAMS, [30]);
	assert.equal(whole.summary.tick, 30);
	assert.ok(whole.summary.count > 0);
	assert.deepEqual(runTicks(PARAMS, [10, 20]), whole);
	assert.deepEqual(runTicks(PARAMS, Array(30).fill(1)), whole);
	assert.notDeepEqual(runTicks({ ...PARAMS, seed: 8 }, [30]).summary, whole.summary);
});

test("reset returns to tick 0 and replays the same run", () => {
	const simulation = createSimulation({ poleToPoleCells: CELLS });
	simulation.configure(PARAMS);
	const start = simulation.snapshot();
	simulation.step(25);
	const later = simulation.snapshot();
	simulation.reset();
	assert.deepEqual(simulation.snapshot(), start);
	simulation.step(25);
	assert.deepEqual(simulation.snapshot(), later);
});

test("species and dispersal settings reach the population", () => {
	assert.equal(runTicks({ ...PARAMS, species: "evolving" }, [0]).summary.count, 60);
	const neutral = runTicks({ ...PARAMS, species: "neutral", dispersal: 0 }, [40]).summary;
	assert.equal(neutral.dispersals.total, 0);
	assert.equal(neutral.traits.temperatureOptimum.sd, 0);
	const evolving = runTicks(PARAMS, [40]).summary;
	assert.ok(evolving.dispersals.total > 0);
	assert.ok(evolving.traits.temperatureOptimum.sd > 0);
});

test("invalid parameters leave the running simulation unchanged", () => {
	const simulation = createSimulation({ poleToPoleCells: CELLS });
	simulation.configure(PARAMS);
	simulation.step(5);
	const before = simulation.snapshot();
	assert.throws(() => simulation.configure({ ...PARAMS, founders: 100000 }), RangeError);
	assert.throws(() => simulation.configure({ ...PARAMS, species: "trees" }), RangeError);
	assert.deepEqual(simulation.snapshot(), before);
	assert.throws(() => createSimulation().step(1), /not been configured/);
});

// A controller with a manual clock; `advance` runs the scheduled loop iteration after moving time forward.
function createHarness() {
	let time = 0;
	let pending = null;
	const messages = [];
	const controller = createSimulationController({
		post: (message) => messages.push(message),
		poleToPoleCells: CELLS,
		now: () => time,
		schedule: (callback) => (pending = callback),
		cancel: () => (pending = null),
	});
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

test("the controller configures paused, steps on request, and reports a snapshot each time", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "configure", params: PARAMS });
	let snapshot = harness.last("snapshot");
	assert.equal(snapshot.running, false);
	assert.equal(snapshot.summary.tick, 0);
	assert.deepEqual(snapshot.params, PARAMS);
	harness.controller.handle({ type: "step", ticks: 3 });
	assert.equal(harness.last("snapshot").summary.tick, 3);
	harness.controller.handle({ type: "reset" });
	assert.equal(harness.last("snapshot").summary.tick, 0);
	assert.equal(harness.messages.some((message) => message.type === "error"), false);
});

test("playing advances ticks at the chosen speed and pausing stops them", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "configure", params: { ...PARAMS, speed: 20 } });
	harness.controller.handle({ type: "play" });
	assert.equal(harness.last("snapshot").running, true);
	harness.advance(500);
	harness.advance(500);
	harness.controller.handle({ type: "pause" });
	assert.equal(harness.last("snapshot").running, false);
	assert.equal(harness.last("snapshot").summary.tick, 20);
	assert.equal(harness.scheduled, false);
	harness.advance(1000);
	assert.equal(harness.last("snapshot").summary.tick, 20);
});

test("changing speed while playing applies to later ticks; reset stops playback", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "configure", params: { ...PARAMS, speed: 10 } });
	harness.controller.handle({ type: "play" });
	harness.advance(1000);
	harness.controller.handle({ type: "speed", ticksPerSecond: 40 });
	assert.equal(harness.last("snapshot").params.speed, 40);
	harness.advance(500);
	assert.equal(harness.last("snapshot").summary.tick, 30);
	harness.controller.handle({ type: "reset" });
	assert.equal(harness.last("snapshot").running, false);
	assert.equal(harness.last("snapshot").summary.tick, 0);
	assert.equal(harness.scheduled, false);
});

test("the controller reports errors and keeps its last good state", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "play" });
	assert.match(harness.last("error").message, /not been configured/);
	assert.equal(harness.last("snapshot"), undefined);
	harness.controller.handle({ type: "configure", params: PARAMS });
	harness.controller.handle({ type: "step", ticks: 4 });
	harness.controller.handle({ type: "configure", params: { ...PARAMS, founders: -5 } });
	assert.match(harness.last("error").message, /founders must be/);
	assert.equal(harness.last("snapshot").summary.tick, 4);
	harness.controller.handle({ type: "speed", ticksPerSecond: 0 });
	assert.match(harness.last("error").message, /speed must be/);
	harness.controller.handle({ type: "explode" });
	assert.match(harness.last("error").message, /Unknown message type/);
});

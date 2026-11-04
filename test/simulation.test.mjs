import assert from "node:assert/strict";
import test from "node:test";
import { createHabitat } from "../src/utility/ecology/habitat.js";
import { createPopulation, getPopulationSummary, stepPopulation } from "../src/utility/ecology/population.js";
import { createSimulation, SPECIES_PRESETS } from "../src/utility/ecology/simulation.js";
import { createSimulationController } from "../src/utility/ecology/simulationController.js";
import { extractSimulationInput, worldFromSimulationInput } from "../src/utility/ecology/simulationInput.js";
import {
	DEFAULT_SIMULATION_PARAMS,
	parseSimulationParams,
	toSearchParams,
	validateSimulationParams,
} from "../src/utility/ecology/simulationParams.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";

const CELLS = 20;
const PARAMS = { seed: 7, founders: 60, species: "evolving", dispersal: 0.2, speed: 10 };

const worlds = new Map();
function worldFor(seed) {
	if (!worlds.has(seed)) worlds.set(seed, createGlobeMap({ poleToPoleCells: CELLS, seed }));
	return worlds.get(seed);
}
// The input as the worker receives it: extracted, then copied by `postMessage`'s structured clone.
function inputFor(seed) {
	return structuredClone(extractSimulationInput(worldFor(seed)));
}
function createLoadedSimulation(seed = PARAMS.seed) {
	const simulation = createSimulation();
	simulation.setWorld(inputFor(seed));
	return simulation;
}

function runTicks(params, chunks) {
	const simulation = createLoadedSimulation(params.seed);
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
	assert.notDeepEqual(runTicks({ ...PARAMS, founders: 61 }, [30]).summary, whole.summary);
});

test("reset returns to tick 0 and replays the same run", () => {
	const simulation = createLoadedSimulation();
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
	const simulation = createLoadedSimulation();
	simulation.configure(PARAMS);
	simulation.step(5);
	const before = simulation.snapshot();
	assert.throws(() => simulation.configure({ ...PARAMS, founders: 100000 }), RangeError);
	assert.throws(() => simulation.configure({ ...PARAMS, species: "trees" }), RangeError);
	assert.deepEqual(simulation.snapshot(), before);
	assert.throws(() => createSimulation().step(1), /not been configured/);
});

test("a simulation on the extracted input matches one run directly on the world", () => {
	const world = worldFor(PARAMS.seed);
	const species = { ...SPECIES_PRESETS.evolving, dispersalChance: PARAMS.dispersal };
	const habitat = createHabitat(world);
	const population = createPopulation(world, { seed: PARAMS.seed, initialCount: PARAMS.founders, species });
	stepPopulation(population, habitat, 40);
	assert.deepEqual(runTicks(PARAMS, [40]).summary, getPopulationSummary(population));
});

test("the extract holds only what the simulation reads and rebuilds the same cells", () => {
	const world = worldFor(PARAMS.seed);
	const input = extractSimulationInput(world);
	assert.deepEqual(Object.keys(input).sort(), ["biome", "latitude", "moisture", "neighbors", "seed", "temperature"]);
	const rebuilt = worldFromSimulationInput(structuredClone(input));
	assert.equal(rebuilt.seed, world.seed);
	assert.equal(rebuilt.cells.length, world.cells.length);
	for (const cell of rebuilt.cells) {
		const original = world.cells[cell.id];
		assert.deepEqual(cell, {
			id: original.id,
			biome: original.biome,
			latitude: original.latitude,
			temperature: original.temperature,
			moisture: original.moisture,
			neighbors: original.neighbors,
		});
	}
});

test("a malformed world input is rejected", () => {
	const good = extractSimulationInput(worldFor(PARAMS.seed));
	const bad = [
		[{ ...good, seed: -1 }, /seed/],
		[{ ...good, biome: [] }, /at least one cell/],
		[{ ...good, latitude: good.latitude.slice(1) }, /latitude must have one entry per cell/],
		[{ ...good, neighbors: good.neighbors.slice(1) }, /neighbors must have one entry per cell/],
		[{ ...good, neighbors: good.neighbors.map((list, id) => (id === 3 ? [...list, 99999] : list)) }, /Cell 3 has an invalid neighbor list/],
		[undefined, /seed/],
	];
	for (const [input, pattern] of bad) {
		assert.throws(() => createSimulation().setWorld(input), (error) => error instanceof RangeError && pattern.test(error.message));
	}
	assert.throws(() => extractSimulationInput({ cells: [{ id: 1, neighbors: [] }] }), /ids must match positions/);
});

test("the simulation needs a world whose seed matches the settings", () => {
	const simulation = createSimulation();
	assert.throws(() => simulation.configure(PARAMS), /No world has been loaded/);
	simulation.setWorld(inputFor(PARAMS.seed));
	assert.throws(() => simulation.configure({ ...PARAMS, seed: 8 }), /loaded world has seed 7, not 8/);
	simulation.configure(PARAMS);
	simulation.step(3);
	assert.throws(() => simulation.setWorld({ seed: 7 }), RangeError);
	assert.equal(simulation.snapshot().summary.tick, 3);
	simulation.setWorld(inputFor(8));
	assert.throws(() => simulation.snapshot(), /not been configured/);
});

// A controller with a manual clock; `advance` runs the scheduled loop iteration after moving time forward.
function createHarness() {
	let time = 0;
	let pending = null;
	const messages = [];
	const controller = createSimulationController({
		post: (message) => messages.push(message),
		now: () => time,
		schedule: (callback) => (pending = callback),
		cancel: () => (pending = null),
	});
	controller.handle({ type: "world", input: inputFor(PARAMS.seed) });
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
	harness.controller.handle({ type: "world", input: { seed: 7 } });
	assert.match(harness.last("error").message, /at least one cell/);
	harness.controller.handle({ type: "configure", params: { ...PARAMS, seed: 8 } });
	assert.match(harness.last("error").message, /loaded world has seed 7/);
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

test("loading a new world stops playback and requires configuring again", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "configure", params: PARAMS });
	harness.controller.handle({ type: "play" });
	harness.advance(500);
	harness.controller.handle({ type: "world", input: inputFor(8) });
	assert.equal(harness.scheduled, false);
	harness.controller.handle({ type: "play" });
	assert.match(harness.last("error").message, /not been configured/);
	harness.controller.handle({ type: "configure", params: { ...PARAMS, seed: 8 } });
	assert.equal(harness.last("snapshot").params.seed, 8);
	assert.equal(harness.last("snapshot").summary.tick, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createHabitat, getCellHabitat } from "../src/utility/ecology/habitat.js";
import {
	createPopulation,
	getCellOrganisms,
	getDispersalRegions,
	getPopulationSummary,
	stepPopulation,
	summarizeGroups,
	summarizeTraits,
} from "../src/utility/ecology/population.js";
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
	const transfers = [];
	const controller = createSimulationController({
		post: (message, transfer) => {
			messages.push(message);
			transfers.push(transfer);
		},
		now: () => time,
		schedule: (callback) => (pending = callback),
		cancel: () => (pending = null),
	});
	controller.handle({ type: "world", input: inputFor(PARAMS.seed) });
	return {
		controller,
		messages,
		transfers,
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

test("each snapshot carries fresh per-cell stock fills whose buffers are transferred", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "configure", params: PARAMS });
	const cellCount = worldFor(PARAMS.seed).cells.length;
	const first = harness.last("snapshot");
	assert.deepEqual(Object.keys(first.cells), ["waterFill", "nutrientFill", "count", "temperatureOptimum", "moistureOptimum", "region"]);
	for (const array of Object.values(first.cells)) {
		assert.ok(array instanceof Float32Array || array instanceof Uint32Array || array instanceof Int32Array);
		assert.equal(array.length, cellCount);
	}
	assert.equal(first.maxPerCell, 50);
	assert.ok(first.cells.waterFill.every((fill) => fill >= 0 && fill <= 1));
	const posted = harness.transfers.at(-1);
	assert.deepEqual(posted, Object.values(first.cells).map((array) => array.buffer));

	harness.controller.handle({ type: "step", ticks: 30 });
	const later = harness.last("snapshot");
	assert.notEqual(later.cells.nutrientFill.buffer, first.cells.nutrientFill.buffer);
	assert.ok(first.cells.nutrientFill.every((fill) => fill === 0 || fill === 1), "stocks start full (0 only where there is no capacity)");
	assert.ok(later.cells.nutrientFill.some((fill, id) => fill < first.cells.nutrientFill[id]), "feeding lowers some nutrient stocks");
	assert.ok(later.cells.waterFill.every((fill) => fill >= 0 && fill <= 1));
});

test("a snapshot's cell arrays survive a real transfer to another thread's copy", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "configure", params: PARAMS });
	const { cells } = harness.last("snapshot");
	const expected = Array.from(cells.nutrientFill);
	const received = structuredClone(harness.last("snapshot"), { transfer: harness.transfers.at(-1) });
	assert.deepEqual(Array.from(received.cells.nutrientFill), expected);
	assert.equal(cells.nutrientFill.length, 0, "the sender's buffer is detached after the transfer");
});

test("each snapshot's organism counts per cell match the summary and stay on land", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "configure", params: { ...PARAMS, founders: 200 } });
	const world = worldFor(PARAMS.seed);
	for (const ticks of [0, 30]) {
		harness.controller.handle({ type: "step", ticks });
		const { cells, summary } = harness.last("snapshot");
		assert.equal(cells.count.reduce((total, count) => total + count, 0), summary.count);
		assert.equal(cells.count.filter((count) => count > 0).length, summary.occupiedCells);
		world.cells.forEach((cell) => cell.biome === "Water" && assert.equal(cells.count[cell.id], 0));
		assert.ok(cells.count.every((count) => count <= 50));
	}
});

test("inspecting a cell gives exactly what the habitat and population report for it, while ticks advance and cells empty", () => {
	const world = worldFor(PARAMS.seed);
	const species = { ...SPECIES_PRESETS.evolving, dispersalChance: PARAMS.dispersal };
	const habitat = createHabitat(world);
	const population = createPopulation(world, { seed: PARAMS.seed, initialCount: PARAMS.founders, species });
	const simulation = createLoadedSimulation();
	simulation.configure(PARAMS);
	const watched = [...new Set(population.organisms.map(({ cellId }) => cellId))].slice(0, 12);
	assert.ok(watched.length >= 6);
	let emptied = 0;
	for (let tick = 0; tick <= 40; tick++) {
		if (tick > 0) {
			stepPopulation(population, habitat, 1);
			simulation.step(1);
		}
		for (const cellId of [...watched, 0, world.cells.length - 1]) {
			const expected = { cellId, tick, ...getCellHabitat(habitat, cellId), organisms: getCellOrganisms(population, cellId) };
			assert.deepEqual(simulation.inspectCell(cellId), expected, `cell ${cellId} at tick ${tick}`);
		}
		emptied += watched.filter((cellId) => getCellOrganisms(population, cellId).length === 0).length > 0 ? 1 : 0;
	}
	assert.ok(emptied > 0, "the run never emptied a watched cell, so it does not exercise that case");
	assert.throws(() => simulation.inspectCell(-1), RangeError);
	assert.throws(() => simulation.inspectCell(world.cells.length), RangeError);
	assert.throws(() => simulation.inspectCell(1.5), RangeError);
	assert.throws(() => createSimulation().inspectCell(0), /not been configured/);
});

test("the controller follows a watched cell with a cell message after every snapshot", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "configure", params: { ...PARAMS, speed: 20 } });
	const habitatMessages = () => harness.messages.filter((message) => message.type === "cell");
	assert.equal(habitatMessages().length, 0, "nothing is sent until a cell is inspected");

	const occupied = harness.last("snapshot").cells.count.findIndex((count) => count > 0);
	harness.controller.handle({ type: "inspect", cellId: occupied });
	const first = harness.last("cell");
	assert.equal(first.cellId, occupied);
	assert.equal(first.tick, 0);
	assert.equal(first.organisms.length, harness.last("snapshot").cells.count[occupied]);
	assert.equal(harness.messages.at(-1), first, "the cell message follows its snapshot");

	harness.controller.handle({ type: "play" });
	harness.advance(500);
	harness.advance(500);
	harness.controller.handle({ type: "pause" });
	assert.ok(habitatMessages().length > 3, "every snapshot is followed by the cell");
	const snapshots = harness.messages.filter((message) => message.type === "snapshot" || message.type === "cell");
	snapshots.forEach((message, index) => {
		if (message.type === "cell") {
			const snapshot = snapshots[index - 1];
			assert.equal(snapshot.type, "snapshot");
			assert.equal(message.tick, snapshot.summary.tick, "the cell and the stats are from the same tick");
			assert.equal(message.organisms.length, snapshot.cells.count[occupied]);
		}
	});
	assert.equal(harness.last("cell").tick, 20);

	harness.controller.handle({ type: "inspect", cellId: null });
	const seen = habitatMessages().length;
	harness.controller.handle({ type: "step", ticks: 2 });
	assert.equal(habitatMessages().length, seen, "stopping the inspection stops the messages");
});

test("an invalid inspection is reported, and the previous cell stays watched", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "inspect", cellId: 3 });
	assert.match(harness.last("error").message, /not been configured/);
	harness.controller.handle({ type: "configure", params: PARAMS });
	harness.controller.handle({ type: "inspect", cellId: 3 });
	harness.controller.handle({ type: "inspect", cellId: 999999 });
	assert.match(harness.last("error").message, /Unknown cell id/);
	harness.controller.handle({ type: "step", ticks: 1 });
	assert.equal(harness.last("cell").cellId, 3);
	assert.equal(harness.last("cell").tick, 1);
});

test("loading a new world stops the inspection", () => {
	const harness = createHarness();
	harness.controller.handle({ type: "configure", params: PARAMS });
	harness.controller.handle({ type: "inspect", cellId: 3 });
	harness.controller.handle({ type: "world", input: inputFor(8) });
	harness.controller.handle({ type: "configure", params: { ...PARAMS, seed: 8 } });
	const before = harness.messages.filter((message) => message.type === "cell").length;
	harness.controller.handle({ type: "step", ticks: 1 });
	assert.equal(harness.messages.filter((message) => message.type === "cell").length, before);
});

test("each snapshot carries the cells' mean traits, dispersal regions, and how traits diverge between regions", () => {
	// A larger world than the others, because it needs several land regions that organisms occupy.
	const world = createGlobeMap({ poleToPoleCells: 40, seed: 7 });
	const params = { seed: 7, founders: 200, species: "evolving", dispersal: 0.15, speed: 10 };
	const species = { ...SPECIES_PRESETS.evolving, dispersalChance: params.dispersal };
	const habitat = createHabitat(world);
	const population = createPopulation(world, { seed: params.seed, initialCount: params.founders, species });
	const simulation = createSimulation();
	simulation.setWorld(structuredClone(extractSimulationInput(world)));
	simulation.configure(params);
	const { regionOfCell, regionCount } = getDispersalRegions(population, habitat);
	for (const ticks of [0, 150]) {
		if (ticks > 0) {
			stepPopulation(population, habitat, ticks);
			simulation.step(ticks);
		}
		const { cells, groups } = simulation.snapshot();
		assert.deepEqual(Array.from(cells.region), regionOfCell);
		assert.equal(groups.regions, regionCount);
		const reference = summarizeGroups(population, regionOfCell);
		assert.equal(groups.occupied, reference.groups.length);
		for (const cell of world.cells) {
			const organisms = getCellOrganisms(population, cell.id);
			const traits = summarizeTraits(organisms);
			for (const trait of ["temperatureOptimum", "moistureOptimum"]) {
				if (traits === null) assert.ok(Number.isNaN(cells[trait][cell.id]), `${trait} of empty cell ${cell.id}`);
				else assert.equal(cells[trait][cell.id], Math.fround(traits[trait].mean), `${trait} of cell ${cell.id} at tick ${ticks}`);
			}
		}
		if (ticks === 150) {
			assert.ok(groups.occupied >= 3, `only ${groups.occupied} regions are occupied`);
			for (const trait of ["temperatureOptimum", "moistureOptimum"]) {
				assert.ok(reference.divergence[trait].between > 0, "the run has diverged enough to compare");
				assert.ok(Math.abs(groups.divergence[trait].betweenShare - reference.divergence[trait].betweenShare) < 1e-9);
			}
		}
	}
	const first = simulation.snapshot();
	first.cells.region.fill(-5);
	assert.ok(simulation.snapshot().cells.region.every((region) => region !== -5), "each snapshot gets its own copy of the regions");
});

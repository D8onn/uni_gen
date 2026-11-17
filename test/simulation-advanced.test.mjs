import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHabitat, DEFAULT_RESOURCE_RATES, LIMIT_KINDS } from "../src/utility/ecology/habitat.js";
import { createPopulation, DEFAULT_PRODUCER, getPopulationSummary, SPECIES_KINDS, stepPopulation } from "../src/utility/ecology/population.js";
import { createSimulation } from "../src/utility/ecology/simulation.js";
import { createSimulationController } from "../src/utility/ecology/simulationController.js";
import { extractSimulationInput } from "../src/utility/ecology/simulationInput.js";
import {
	ADVANCED_SETTINGS,
	defaultFor,
	effectiveSettings,
	parseSimulationParams,
	resolveRun,
	SPECIES_PRESETS,
	toSearchParams,
	validateSimulationParams,
} from "../src/utility/ecology/simulationParams.js";
import { createSeededRandom } from "../src/utility/planet/seededRandom.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";

const BASE = { seed: 7, founders: 60, species: "evolving", dispersal: 0.2, speed: 10 };
const ADVANCED = { selectionStrength: 1, mutationRate: 0.3, maxPerCell: 20, waterRegeneration: 0.2, nutrientSpread: 0.1 };
const QUERY = "seed=7&founders=60&species=evolving&dispersal=0.2&speed=10";

const world = createGlobeMap({ poleToPoleCells: 20, seed: BASE.seed });
function createLoadedSimulation() {
	const simulation = createSimulation();
	simulation.setWorld(structuredClone(extractSimulationInput(world)));
	return simulation;
}
function runTicks(params, ticks) {
	const simulation = createLoadedSimulation();
	simulation.configure(params);
	simulation.step(ticks);
	return simulation.snapshot();
}
const nonDefault = (setting) => (setting.kind === "count" ? 7 : setting.kind === "fraction" ? 0.37 : 3.5);

test("advanced settings parse from the URL and round-trip through the canonical query string", () => {
	assert.equal(ADVANCED_SETTINGS.length, 12);
	for (const setting of ADVANCED_SETTINGS) {
		const value = nonDefault(setting);
		const parsed = parseSimulationParams(`?${QUERY}&${setting.name}=${value}`);
		assert.deepEqual(parsed, { ...BASE, [setting.name]: value }, setting.name);
		assert.equal(toSearchParams(parsed).toString(), `${QUERY}&${setting.name}=${value}`);
		assert.deepEqual(parseSimulationParams(toSearchParams(parsed)), parsed);
	}
	const all = Object.fromEntries(ADVANCED_SETTINGS.map((setting) => [setting.name, nonDefault(setting)]));
	const parsed = parseSimulationParams(new URLSearchParams({ ...BASE, ...all }));
	assert.deepEqual(parsed, { ...BASE, ...all });
	assert.deepEqual(parseSimulationParams(toSearchParams(parsed)), parsed);
	assert.equal(toSearchParams(parseSimulationParams(`?speed=10&mutationSize=1e-7&dispersal=0.2&founders=60&seed=7`)).toString(), `${QUERY}&mutationSize=1e-7`);
});

test("an advanced setting equal to its species or habitat default is left out of the canonical params", () => {
	assert.deepEqual(parseSimulationParams(`?${QUERY}&selectionStrength=2&mutationRate=0.1&maxPerCell=50&waterSpread=0.3`), BASE);
	assert.equal(toSearchParams(parseSimulationParams("?seed=12345&species=evolving&selectionStrength=2")).get("selectionStrength"), null);
	const neutral = { ...BASE, species: "neutral" };
	assert.deepEqual(validateSimulationParams({ ...neutral, selectionStrength: 0, mutationRate: 0 }), neutral);
	assert.deepEqual(validateSimulationParams({ ...neutral, selectionStrength: 2 }), { ...neutral, selectionStrength: 2 });
	assert.deepEqual(validateSimulationParams({ ...BASE, selectionStrength: 0 }), { ...BASE, selectionStrength: 0 });
	assert.deepEqual(validateSimulationParams({ ...BASE, ...effectiveSettings(BASE) }), BASE);
});

test("defaults come from the species preset and the habitat rates", () => {
	const byName = Object.fromEntries(ADVANCED_SETTINGS.map((setting) => [setting.name, setting]));
	assert.equal(defaultFor(byName.selectionStrength, "evolving"), 2);
	assert.equal(defaultFor(byName.selectionStrength, "neutral"), 0);
	assert.equal(defaultFor(byName.mutationRate, "evolving"), 0.1);
	assert.equal(defaultFor(byName.maxPerCell, "neutral"), 50);
	assert.deepEqual(effectiveSettings({ ...BASE, species: "neutral", growthRate: 0.4 }), {
		selectionStrength: 0,
		mutationRate: 0,
		mutationSize: 0.05,
		mortalityChance: 0.01,
		reproductionChance: 0.5,
		growthRate: 0.4,
		maintenance: 0.05,
		maxPerCell: 50,
		waterRegeneration: 0.1,
		waterSpread: 0.3,
		nutrientRegeneration: 0.02,
		nutrientSpread: 0.05,
	});
});

test("invalid advanced settings throw a RangeError naming the setting", () => {
	const invalid = [
		["mutationRate=1.5", /^mutationRate must be a number from 0 to 1\.$/],
		["selectionStrength=-1", /^selectionStrength must be a non-negative number\.$/],
		["selectionStrength=Infinity", /^selectionStrength must be a non-negative number\.$/],
		["maxPerCell=2.5", /^maxPerCell must be a positive integer\.$/],
		["maxPerCell=0", /^maxPerCell must be a positive integer\.$/],
		["mutationRate=", /^mutationRate must not be empty\.$/],
		["waterSpread=nope", /^waterSpread must be a number from 0 to 1\.$/],
		["nutrientRegeneration=-0.1", /^nutrientRegeneration must be a number from 0 to 1\.$/],
	];
	for (const [query, pattern] of invalid) {
		assert.throws(() => parseSimulationParams(`?${QUERY}&${query}`), (error) => error instanceof RangeError && pattern.test(error.message), query);
	}
	assert.throws(() => validateSimulationParams({ ...BASE, growthRate: "0.5" }), /growthRate must be/);
	assert.throws(() => validateSimulationParams({ ...BASE, mutationSize: Number.NaN }), /mutationSize must be/);
	assert.deepEqual(validateSimulationParams({ ...BASE, mutationRate: undefined }), BASE);
});

test("the settings table agrees with the library's own names, defaults, and limits", () => {
	for (const setting of ADVANCED_SETTINGS) {
		const { min, max } = LIMIT_KINDS[setting.kind];
		const candidates = [min - 1, min, min + 0.5, max, max === Infinity ? 1e6 : max + 0.1, Number.NaN, Infinity];
		if (setting.group === "species") {
			assert.equal(setting.kind, SPECIES_KINDS[setting.name], setting.name);
			assert.deepEqual(setting.path, [setting.name]);
			assert.equal(defaultFor(setting, "neutral"), DEFAULT_PRODUCER[setting.name]);
			for (const species of Object.keys(SPECIES_PRESETS)) {
				assert.equal(defaultFor(setting, species), { ...DEFAULT_PRODUCER, ...SPECIES_PRESETS[species] }[setting.name]);
			}
		} else {
			const [resource, rate] = setting.path;
			assert.equal(setting.kind, "fraction");
			assert.equal(defaultFor(setting, "evolving"), DEFAULT_RESOURCE_RATES[resource][rate]);
		}
		for (const value of candidates) {
			const accepted = (() => {
				try {
					validateSimulationParams({ ...BASE, [setting.name]: value });
					return true;
				} catch {
					return false;
				}
			})();
			const { species, rates } = resolveRun({ ...BASE, [setting.name]: value });
			const libraryAccepts = (() => {
				try {
					createHabitat(world, rates);
					createPopulation(world, { seed: 1, initialCount: 0, species });
					return true;
				} catch (error) {
					assert.ok(error instanceof RangeError);
					return false;
				}
			})();
			assert.equal(accepted, libraryAccepts, `${setting.name}=${value}`);
		}
	}
});

test("advanced settings reach the species and the habitat", () => {
	const params = validateSimulationParams({ ...BASE, ...ADVANCED });
	assert.deepEqual(resolveRun(params), {
		species: { ...SPECIES_PRESETS.evolving, dispersalChance: 0.2, selectionStrength: 1, mutationRate: 0.3, maxPerCell: 20 },
		rates: { water: { regeneration: 0.2 }, nutrients: { spread: 0.1 } },
	});
	assert.deepEqual(resolveRun(BASE), { species: { ...SPECIES_PRESETS.evolving, dispersalChance: 0.2 }, rates: {} });

	const run = resolveRun(params);
	const habitat = createHabitat(world, run.rates);
	const population = createPopulation(world, { seed: BASE.seed, initialCount: BASE.founders, species: run.species });
	stepPopulation(population, habitat, 40);
	const snapshot = runTicks(params, 40);
	assert.deepEqual(snapshot.summary, getPopulationSummary(population));
	assert.deepEqual(snapshot.params, params);
	assert.equal(snapshot.maxPerCell, 20);
});

test("overrides that restore the neutral model match it, and others change the run", () => {
	const neutral = { ...BASE, species: "neutral" };
	const evolvingAsNeutral = runTicks({ ...BASE, selectionStrength: 0, mutationRate: 0 }, 100);
	const expected = runTicks(neutral, 100);
	assert.deepEqual(evolvingAsNeutral.summary, expected.summary);
	assert.deepEqual(evolvingAsNeutral.cells, expected.cells);
	assert.equal(runTicks(neutral, 40).summary.traits.temperatureOptimum.sd, 0);
	assert.ok(runTicks({ ...neutral, mutationRate: 0.5 }, 40).summary.traits.temperatureOptimum.sd > 0);
	const dry = runTicks({ ...BASE, waterRegeneration: 0 }, 1).cells.waterFill;
	const usual = runTicks(BASE, 1).cells.waterFill;
	assert.ok(dry.some((fill, id) => fill !== usual[id]), "waterRegeneration=0 changes no water stock");
});

test("the same advanced settings reproduce the run tick for tick", () => {
	const params = { ...BASE, ...ADVANCED };
	const first = createLoadedSimulation();
	const second = createLoadedSimulation();
	first.configure(params);
	second.configure(parseSimulationParams(toSearchParams(params)));
	for (const ticks of [0, 50, 250]) {
		first.step(ticks);
		second.step(ticks);
		assert.deepEqual(first.snapshot(), second.snapshot());
	}
	assert.equal(first.snapshot().summary.tick, 300);
	assert.ok(first.snapshot().summary.count > 0);
});

test("applying the same settings mid-run, or resetting, starts the same run again", () => {
	const params = { ...BASE, ...ADVANCED };
	const straight = runTicks(params, 120);
	const random = createSeededRandom(3);
	const simulation = createLoadedSimulation();
	simulation.configure(params);
	let tick = 0;
	while (tick < 37) {
		const ticks = 1 + Math.floor(random() * 7);
		simulation.step(ticks);
		tick += ticks;
	}
	simulation.configure(params);
	assert.equal(simulation.snapshot().summary.tick, 0);
	for (tick = 0; tick < 120; ) {
		const ticks = Math.min(1 + Math.floor(random() * 7), 120 - tick);
		simulation.step(ticks);
		tick += ticks;
	}
	assert.deepEqual(simulation.snapshot(), straight);

	simulation.step(13);
	simulation.reset();
	const fresh = createLoadedSimulation();
	fresh.configure(params);
	assert.deepEqual(simulation.snapshot(), fresh.snapshot());
	simulation.step(120);
	assert.deepEqual(simulation.snapshot(), straight);
});

test("the controller runs advanced settings and keeps its run when the founders do not fit", () => {
	const messages = [];
	const controller = createSimulationController({ post: (message) => messages.push(message), schedule: () => null, cancel: () => {} });
	const last = (type) => messages.findLast((message) => message.type === type);
	controller.handle({ type: "world", input: structuredClone(extractSimulationInput(world)) });
	controller.handle({ type: "configure", params: { ...BASE, ...ADVANCED } });
	assert.deepEqual(last("snapshot").params, { ...BASE, ...ADVANCED });
	controller.handle({ type: "step", ticks: 6 });
	const before = last("snapshot");
	controller.handle({ type: "configure", params: { ...BASE, founders: 100000, maxPerCell: 1 } });
	assert.match(last("error").message, /initialCount must be an integer from 0 to/);
	assert.equal(last("snapshot").summary.tick, 6);
	assert.deepEqual(last("snapshot").summary, before.summary);
	assert.deepEqual(last("snapshot").params, before.params);
});

test("the readme lists every advanced URL setting", () => {
	const readme = readFileSync(new URL("../readme.md", import.meta.url), "utf8");
	for (const { name } of ADVANCED_SETTINGS) {
		assert.match(readme, new RegExp(`^\\| \`${name}\` \\|`, "m"), name);
	}
});

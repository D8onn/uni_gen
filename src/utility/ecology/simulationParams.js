// Settings for the browser simulation, shared by the URL, the control panel, and the worker.
import { createRandomSeed } from "../planet/seededRandom.js";
import { DEFAULT_RESOURCE_RATES, describeLimit, isWithinLimit } from "./habitat.js";
import { DEFAULT_PRODUCER, EVOLVING_PRODUCER, SPECIES_KINDS } from "./population.js";

export const SPECIES_NAMES = ["evolving", "neutral"];
export const SPECIES_PRESETS = { evolving: EVOLVING_PRODUCER, neutral: {} };
export const MAX_FOUNDERS = 100000;
export const MAX_SPEED = 200;
export const DEFAULT_SIMULATION_PARAMS = { founders: 1000, species: "evolving", dispersal: 0.1, speed: 10 };

// Optional settings, one URL parameter each; `path` locates the value in the species or in the habitat rates, and `kind` is a `LIMIT_KINDS` name.
export const ADVANCED_SETTINGS = [
	...[
		["selectionStrength", "Selection"],
		["mutationRate", "Mutation rate"],
		["mutationSize", "Mutation size"],
		["mortalityChance", "Mortality"],
		["reproductionChance", "Reproduction"],
		["growthRate", "Growth rate"],
		["maintenance", "Maintenance"],
		["maxPerCell", "Max per cell"],
	].map(([name, label]) => ({ name, label, group: "species", kind: SPECIES_KINDS[name], path: [name] })),
	...[
		["waterRegeneration", "Water regen", "water", "regeneration"],
		["waterSpread", "Water spread", "water", "spread"],
		["nutrientRegeneration", "Nutrient regen", "nutrients", "regeneration"],
		["nutrientSpread", "Nutrient spread", "nutrients", "spread"],
	].map(([name, label, resource, rate]) => ({ name, label, group: "habitat", kind: "fraction", path: [resource, rate] })),
];

const NUMBER_FIELDS = ["seed", "founders", "dispersal", "speed", ...ADVANCED_SETTINGS.map(({ name }) => name)];

// The value an advanced setting takes when the params leave it out: the species preset's, or the habitat's default rate.
export function defaultFor(setting, species) {
	if (setting.group === "species") return { ...DEFAULT_PRODUCER, ...SPECIES_PRESETS[species] }[setting.name];
	const [resource, rate] = setting.path;
	return DEFAULT_RESOURCE_RATES[resource][rate];
}

// Returns a clean copy of `params`, or throws a RangeError naming the first invalid setting; advanced settings equal to their default are left out.
export function validateSimulationParams(params) {
	const { seed, founders, species, dispersal, speed } = params;
	if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new RangeError("seed must be an unsigned 32-bit integer.");
	}
	if (!Number.isInteger(founders) || founders < 0 || founders > MAX_FOUNDERS) {
		throw new RangeError(`founders must be an integer from 0 to ${MAX_FOUNDERS}.`);
	}
	if (!SPECIES_NAMES.includes(species)) {
		throw new RangeError(`species must be one of: ${SPECIES_NAMES.join(", ")}.`);
	}
	if (!(dispersal >= 0 && dispersal <= 1)) throw new RangeError("dispersal must be a number from 0 to 1.");
	if (!Number.isInteger(speed) || speed < 1 || speed > MAX_SPEED) {
		throw new RangeError(`speed must be an integer from 1 to ${MAX_SPEED} ticks per second.`);
	}
	const clean = { seed, founders, species, dispersal, speed };
	for (const setting of ADVANCED_SETTINGS) {
		const value = params[setting.name];
		if (value === undefined) continue;
		if (!isWithinLimit(setting.kind, value)) throw new RangeError(`${setting.name} must ${describeLimit(setting.kind)}.`);
		if (value !== defaultFor(setting, species)) clean[setting.name] = value;
	}
	return clean;
}

// Reads settings from a query string; missing ones take their defaults, and a missing seed is random.
export function parseSimulationParams(search, { randomSeed = createRandomSeed } = {}) {
	const query = new URLSearchParams(search);
	const params = { ...DEFAULT_SIMULATION_PARAMS };
	for (const name of NUMBER_FIELDS) {
		const raw = query.get(name);
		if (raw === null) continue;
		if (raw.trim() === "") throw new RangeError(`${name} must not be empty.`);
		params[name] = Number(raw);
	}
	if (query.has("species")) params.species = query.get("species");
	params.seed ??= randomSeed();
	return validateSimulationParams(params);
}

// The query string that reproduces `params`: the five basic settings, then each advanced setting that differs from its default.
export function toSearchParams(params) {
	return new URLSearchParams(validateSimulationParams(params));
}

// The species overrides and habitat rates that `createPopulation` and `createHabitat` take for validated `params`.
export function resolveRun(params) {
	const species = { ...SPECIES_PRESETS[params.species], dispersalChance: params.dispersal };
	const rates = {};
	for (const setting of ADVANCED_SETTINGS) {
		const value = params[setting.name];
		if (value === undefined) continue;
		if (setting.group === "species") {
			species[setting.name] = value;
		} else {
			const [resource, rate] = setting.path;
			rates[resource] = { ...rates[resource], [rate]: value };
		}
	}
	return { species, rates };
}

// Every advanced setting's value for `params`, whether given or defaulted.
export function effectiveSettings(params) {
	return Object.fromEntries(ADVANCED_SETTINGS.map((setting) => [setting.name, params[setting.name] ?? defaultFor(setting, params.species)]));
}

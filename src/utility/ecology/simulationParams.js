// Settings for the browser simulation, shared by the URL, the control panel, and the worker.
import { createRandomSeed } from "../planet/seededRandom.js";

export const SPECIES_NAMES = ["evolving", "neutral"];
export const MAX_FOUNDERS = 100000;
export const MAX_SPEED = 200;
export const DEFAULT_SIMULATION_PARAMS = { founders: 1000, species: "evolving", dispersal: 0.1, speed: 10 };

const NUMBER_FIELDS = ["seed", "founders", "dispersal", "speed"];

// Returns a clean copy of `params`, or throws a RangeError naming the first invalid setting.
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
	return { seed, founders, species, dispersal, speed };
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

// The query string that reproduces `params`.
export function toSearchParams(params) {
	const { seed, founders, species, dispersal, speed } = validateSimulationParams(params);
	return new URLSearchParams({ seed, founders, species, dispersal, speed });
}

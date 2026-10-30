// Headless driver that owns one world, habitat, and population; the worker runs it and the tests call it directly.
import { createGlobeMap } from "../planet/createGlobeMap.js";
import { createHabitat } from "./habitat.js";
import { createPopulation, EVOLVING_PRODUCER, getPopulationSummary, stepPopulation } from "./population.js";
import { validateSimulationParams } from "./simulationParams.js";

export const SPECIES_PRESETS = { evolving: EVOLVING_PRODUCER, neutral: {} };

// `speed` in the params only paces the worker; it never affects the simulation itself.
export function createSimulation({ poleToPoleCells = 80, radius = 10 } = {}) {
	let world = null;
	let state = null;

	// Builds the new state before replacing the old one, so invalid params leave the simulation unchanged.
	function build(params) {
		const nextWorld = world?.seed === params.seed ? world : createGlobeMap({ poleToPoleCells, seed: params.seed, radius });
		const species = { ...SPECIES_PRESETS[params.species], dispersalChance: params.dispersal };
		const habitat = createHabitat(nextWorld);
		const population = createPopulation(nextWorld, { seed: params.seed, initialCount: params.founders, species });
		world = nextWorld;
		state = { params, habitat, population };
	}

	function requireState() {
		if (state === null) throw new Error("The simulation has not been configured.");
		return state;
	}

	return {
		// Starts a new simulation at tick 0; the world is reused when the seed is unchanged.
		configure(params) {
			build(validateSimulationParams(params));
		},
		reset() {
			build(requireState().params);
		},
		step(ticks = 1) {
			const { habitat, population } = requireState();
			stepPopulation(population, habitat, ticks);
		},
		// Plain data safe to post to the main thread.
		snapshot() {
			const { params, population } = requireState();
			return { params: { ...params }, summary: getPopulationSummary(population) };
		},
	};
}

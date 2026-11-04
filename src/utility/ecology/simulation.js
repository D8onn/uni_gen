// Headless driver that owns one habitat and population on a world it is given; the worker runs it and the tests call it directly.
import { createHabitat, getCellHabitat, getResourceFill } from "./habitat.js";
import {
	createPopulation,
	EVOLVING_PRODUCER,
	getCellCounts,
	getCellOrganisms,
	getCellTraitMeans,
	getDispersalRegions,
	getGroupDivergence,
	getPopulationSummary,
	stepPopulation,
} from "./population.js";
import { worldFromSimulationInput } from "./simulationInput.js";
import { validateSimulationParams } from "./simulationParams.js";

export const SPECIES_PRESETS = { evolving: EVOLVING_PRODUCER, neutral: {} };

// `speed` in the params only paces the worker; it never affects the simulation itself.
export function createSimulation() {
	let world = null;
	let state = null;

	// Builds the new state before replacing the old one, so invalid params leave the simulation unchanged.
	function build(params) {
		if (world === null) throw new Error("No world has been loaded.");
		if (params.seed !== world.seed) throw new RangeError(`The loaded world has seed ${world.seed}, not ${params.seed}.`);
		const species = { ...SPECIES_PRESETS[params.species], dispersalChance: params.dispersal };
		const habitat = createHabitat(world);
		const population = createPopulation(world, { seed: params.seed, initialCount: params.founders, species });
		state = { params, habitat, population, regions: getDispersalRegions(population, habitat) }; // regions never change once the world is fixed
	}

	function requireState() {
		if (state === null) throw new Error("The simulation has not been configured.");
		return state;
	}

	return {
		// Loads the world (see `extractSimulationInput`) and discards any running simulation.
		setWorld(input) {
			world = worldFromSimulationInput(input);
			state = null;
		},
		// Starts a new simulation at tick 0 on the loaded world; the params' seed must be the world's seed.
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
		// One cell's habitat and organisms right now as `{ cellId, tick, conditions, capacity, resources, organisms }`; an unknown cell id throws a RangeError.
		inspectCell(cellId) {
			const { habitat, population } = requireState();
			return { cellId, tick: population.tick, ...getCellHabitat(habitat, cellId), organisms: getCellOrganisms(population, cellId) };
		},
		// Plain data safe to post to the main thread; `cells` holds one entry per cell id and is a fresh copy each call.
		snapshot() {
			const { params, habitat, population, regions } = requireState();
			return {
				params: { ...params },
				summary: getPopulationSummary(population),
				maxPerCell: population.species.maxPerCell,
				groups: { regions: regions.regionCount, ...getGroupDivergence(population, regions.regionOfCell) },
				cells: {
					waterFill: getResourceFill(habitat, "water"),
					nutrientFill: getResourceFill(habitat, "nutrients"),
					count: getCellCounts(population),
					...getCellTraitMeans(population),
					region: Int32Array.from(regions.regionOfCell),
				},
			};
		},
	};
}

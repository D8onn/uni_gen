// Headless driver that owns one habitat and population on a world it is given; the worker runs it and the tests call it directly.
import { createHabitat, getCellHabitat, getResourceFill } from "./habitat.js";
import {
	createPopulation,
	getCellCounts,
	getCellOrganisms,
	getCellTraitMeans,
	getDispersalRegions,
	getGroupDivergence,
	getPopulationSummary,
	stepPopulation,
} from "./population.js";
import { worldFromSimulationInput } from "./simulationInput.js";
import { resolveRun, validateSimulationParams } from "./simulationParams.js";
import { assertStopSettable, STOP_REASON, stopHolds, validateStopCondition } from "./stopCondition.js";

export { SPECIES_PRESETS } from "./simulationParams.js";

// `speed` in the params only paces the worker; it never affects the simulation itself.
export function createSimulation() {
	let world = null;
	let state = null;

	// Returns a new state for the caller to install, so invalid params leave the simulation unchanged.
	function build(params) {
		if (world === null) throw new Error("No world has been loaded.");
		if (params.seed !== world.seed) throw new RangeError(`The loaded world has seed ${world.seed}, not ${params.seed}.`);
		const run = resolveRun(params);
		const habitat = createHabitat(world, run.rates);
		const population = createPopulation(world, { seed: params.seed, initialCount: params.founders, species: run.species });
		// `spent` marks a stop condition that has fired; `stopped` is why the last step stopped, or null.
		return { params, habitat, population, regions: getDispersalRegions(population, habitat), extinctTick: null, spent: false, stopped: null }; // regions never change once the world is fixed
	}

	function progress({ population }) {
		return { tick: population.tick, count: population.organisms.length };
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
			state = build(validateSimulationParams(params)); // a stop condition that already holds at tick 0 waits for its next crossing, so accepted params always load
		},
		// Restarts at tick 0 with the same params and re-arms the stop condition.
		reset() {
			state = build(requireState().params);
		},
		// Steps one tick at a time and returns `{ reason, tick }` as soon as the stop condition fires, else null; a fired condition stays spent until reset, configure, or setStop.
		step(ticks = 1) {
			const current = requireState();
			if (!Number.isInteger(ticks) || ticks < 0) throw new RangeError("ticks must be a non-negative integer.");
			const { params, habitat, population } = current;
			const stop = params.stop ?? "none";
			current.stopped = null;
			for (let tick = 0; tick < ticks; tick++) {
				const armed = !current.spent && stop !== "none";
				const before = armed && stopHolds(stop, params.stopAt, progress(current));
				stepPopulation(population, habitat, 1);
				if (current.extinctTick === null && params.founders > 0 && population.organisms.length === 0) current.extinctTick = population.tick;
				if (armed && !before && stopHolds(stop, params.stopAt, progress(current))) {
					current.spent = true;
					current.stopped = { reason: STOP_REASON[stop], tick: population.tick };
					return { ...current.stopped };
				}
			}
			return null;
		},
		// Replaces the stop condition without restarting; throws a RangeError if it is invalid, already holds, or names a tick already reached.
		setStop(stop, stopAt) {
			const current = requireState();
			const condition = validateStopCondition(stop, stopAt, current.params);
			assertStopSettable(condition.stop, condition.stopAt, progress(current));
			const { stop: _stop, stopAt: _stopAt, ...rest } = current.params;
			current.params = { ...rest, ...condition };
			current.spent = false;
			current.stopped = null;
		},
		// One cell's habitat and organisms right now as `{ cellId, tick, conditions, capacity, resources, organisms }`; an unknown cell id throws a RangeError.
		inspectCell(cellId) {
			const { habitat, population } = requireState();
			return { cellId, tick: population.tick, ...getCellHabitat(habitat, cellId), organisms: getCellOrganisms(population, cellId) };
		},
		// Plain data safe to post to the main thread; `cells` holds one entry per cell id and is a fresh copy each call.
		snapshot() {
			const { params, habitat, population, regions, stopped, extinctTick } = requireState();
			return {
				params: { ...params },
				stopped: stopped && { ...stopped },
				extinctTick,
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

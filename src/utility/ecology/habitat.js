// Per-cell habitat conditions and resource stocks, kept apart from the generated world; see the README.

export const RESOURCES = ["water", "nutrients"];
export const DEFAULT_RESOURCE_RATES = {
	water: { regeneration: 0.1, spread: 0.3 },
	nutrients: { regeneration: 0.02, spread: 0.05 },
};

// The kinds of numeric limit the ecology parameters use, shared with the settings table in simulationParams.js.
export const LIMIT_KINDS = {
	fraction: { min: 0, max: 1 },
	nonNegative: { min: 0, max: Infinity },
	count: { min: 1, max: Infinity, integer: true },
};
const LIMIT_DESCRIPTIONS = { fraction: "be a number from 0 to 1", nonNegative: "be a non-negative number", count: "be a positive integer" };

export function isWithinLimit(kind, value) {
	const { min, max, integer } = LIMIT_KINDS[kind];
	return (integer ? Number.isInteger(value) : Number.isFinite(value)) && value >= min && value <= max;
}

// The end of a "<name> must ..." message for `kind`.
export function describeLimit(kind) {
	return LIMIT_DESCRIPTIONS[kind];
}

function resolveRates(rates) {
	for (const resource of Object.keys(rates)) {
		if (!RESOURCES.includes(resource)) throw new RangeError(`Unknown resource: ${resource}.`);
	}
	return Object.fromEntries(
		RESOURCES.map((resource) => {
			const resolved = { ...DEFAULT_RESOURCE_RATES[resource], ...rates[resource] };
			for (const [name, value] of Object.entries(resolved)) {
				if (!isWithinLimit("fraction", value)) {
					throw new RangeError(`${resource} ${name} must ${describeLimit("fraction")}.`);
				}
			}
			return [resource, resolved];
		})
	);
}

function checkCellId(habitat, cellId) {
	if (!Number.isInteger(cellId) || cellId < 0 || cellId >= habitat.neighbors.length) {
		throw new RangeError(`Unknown cell id: ${cellId}.`);
	}
}

function checkResource(resource) {
	if (!RESOURCES.includes(resource)) throw new RangeError(`Unknown resource: ${resource}.`);
}

// Cells need latitude, temperature, moisture, and neighbors; the world itself is not modified.
export function createHabitat(world, rates = {}) {
	const { cells } = world;
	const temperature = cells.map((cell) => cell.temperature);
	const moisture = cells.map((cell) => cell.moisture);
	const capacity = {
		water: [...moisture],
		nutrients: cells.map((cell) => cell.temperature * cell.moisture),
	};
	return {
		conditions: { temperature, moisture, light: cells.map((cell) => Math.cos(cell.latitude)) },
		capacity,
		resources: { water: [...capacity.water], nutrients: [...capacity.nutrients] },
		rates: resolveRates(rates),
		neighbors: cells.map((cell) => [...cell.neighbors]),
	};
}

export function getCellHabitat(habitat, cellId) {
	checkCellId(habitat, cellId);
	const pick = (fields) =>
		Object.fromEntries(Object.entries(fields).map(([name, values]) => [name, values[cellId]]));
	return {
		conditions: pick(habitat.conditions),
		capacity: pick(habitat.capacity),
		resources: pick(habitat.resources),
	};
}

// Removes up to `amount` of a resource from a cell and returns how much was actually taken.
export function consumeResource(habitat, cellId, resource, amount) {
	checkCellId(habitat, cellId);
	checkResource(resource);
	if (!Number.isFinite(amount) || amount < 0) {
		throw new RangeError("amount must be a non-negative number.");
	}
	const stocks = habitat.resources[resource];
	const taken = Math.min(amount, stocks[cellId]);
	stocks[cellId] -= taken;
	return taken;
}

// Each tick moves stock between neighbors toward equal fill (stock / capacity), then regenerates it.
function stepResource(habitat, resource) {
	const { neighbors } = habitat;
	const capacity = habitat.capacity[resource];
	const stocks = habitat.resources[resource];
	const { regeneration, spread } = habitat.rates[resource];
	let maxNeighbors = 1;
	for (const cellNeighbors of neighbors) maxNeighbors = Math.max(maxNeighbors, cellNeighbors.length);
	const edgeRate = spread / maxNeighbors;
	const fill = stocks.map((stock, id) => (capacity[id] > 0 ? stock / capacity[id] : 0));
	habitat.resources[resource] = stocks.map((stock, id) => {
		let inflow = 0;
		for (const neighborId of neighbors[id]) {
			inflow += Math.min(capacity[id], capacity[neighborId]) * (fill[neighborId] - fill[id]);
		}
		const transferred = stock + edgeRate * inflow;
		const regenerated = transferred + regeneration * (capacity[id] - transferred);
		// Guards against rounding just outside the bounds the rules already guarantee.
		return Math.min(capacity[id], Math.max(0, regenerated));
	});
}

// Each cell's stock as a fraction of its capacity (0 where the capacity is 0), indexed by cell id.
export function getResourceFill(habitat, resource) {
	checkResource(resource);
	const { capacity, resources } = habitat;
	return Float32Array.from(resources[resource], (stock, id) => (capacity[resource][id] > 0 ? stock / capacity[resource][id] : 0));
}

export function stepHabitat(habitat, ticks = 1) {
	if (!Number.isInteger(ticks) || ticks < 0) {
		throw new RangeError("ticks must be a non-negative integer.");
	}
	for (let tick = 0; tick < ticks; tick++) {
		for (const resource of RESOURCES) stepResource(habitat, resource);
	}
	return habitat;
}

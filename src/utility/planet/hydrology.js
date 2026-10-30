import { createMinHeap } from "./minHeap.js";

// Keeps the filled surface strictly rising away from an outlet, so flat areas and filled
// depressions drain straight toward their outlet instead of wandering by cell id.
const FILL_EPSILON = 1e-9;
// Share of land cells that must drain through a cell for it to carry a river. At 0.2% an 80-cell
// world has about 13 upstream cells at a river's source and 4-5% of its land cells in rivers.
const RIVER_LAND_SHARE = 0.002;
const MIN_RIVER_ACCUMULATION = 3;

// Routes surface water over the cell graph and derives drainage and river fields.
//
// Water cells (the ocean and any inland water) are the outlets. A priority flood grows from
// them, always taking the lowest unvisited cell next; each cell drains into the neighbor that
// discovered it. This fills depressions up to their spill point, so every land cell has a path
// to water and no cell drains into a cycle. Ties break by cell id, so the result depends only on
// the cells. If a world has no water, its single lowest cell is the outlet.
export function calculateHydrology(cells) {
	const isWater = (id) => cells[id].biome === "Water";
	const flowTo = new Array(cells.length).fill(null);
	const filled = new Float64Array(cells.length);
	const visited = new Uint8Array(cells.length);
	const order = [];
	const heap = createMinHeap();

	let outlets = cells.filter((cell) => cell.biome === "Water");
	if (outlets.length === 0) {
		outlets = [
			cells.reduce((lowest, cell) => (cell.elevation < lowest.elevation ? cell : lowest)),
		];
	}
	for (const cell of outlets) {
		visited[cell.id] = 1;
		filled[cell.id] = cell.elevation;
		heap.push(cell.id, cell.elevation);
	}

	while (heap.size > 0) {
		const { id } = heap.pop();
		order.push(id);
		for (const neighborId of cells[id].neighbors) {
			if (visited[neighborId]) continue;
			visited[neighborId] = 1;
			flowTo[neighborId] = id;
			filled[neighborId] = Math.max(cells[neighborId].elevation, filled[id] + FILL_EPSILON);
			heap.push(neighborId, filled[neighborId]);
		}
	}

	// Cells pop after the cell they drain into, so walking the order backward visits every
	// cell after all of its upstream cells.
	const flowAccumulation = new Array(cells.length).fill(0);
	let landCellCount = 0;
	for (const cell of cells) {
		if (cell.biome === "Water") continue;
		flowAccumulation[cell.id] = 1;
		landCellCount++;
	}
	for (let index = order.length - 1; index >= 0; index--) {
		const id = order[index];
		if (flowTo[id] !== null && !isWater(id)) flowAccumulation[flowTo[id]] += flowAccumulation[id];
	}
	for (const cell of cells) {
		if (cell.biome === "Water") flowAccumulation[cell.id] = 0;
	}

	// A basin is named by its outlet: the land cell that drains into water (or the lowest cell
	// of a world without water).
	const drainageBasin = new Array(cells.length).fill(null);
	for (const id of order) {
		if (isWater(id)) continue;
		drainageBasin[id] =
			flowTo[id] === null || isWater(flowTo[id]) ? id : drainageBasin[flowTo[id]];
	}

	const riverThreshold = Math.max(
		MIN_RIVER_ACCUMULATION,
		Math.ceil(landCellCount * RIVER_LAND_SHARE)
	);
	const hasRiver = flowAccumulation.map((accumulation) => accumulation >= riverThreshold);

	return { flowTo, flowAccumulation, drainageBasin, hasRiver, riverThreshold };
}

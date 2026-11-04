// Turns per-cell organism counts into a few markers for the globe, without Three.js: one per about 100 organisms,
// or one larger marker per about 1000 once the population reaches 10,000. Each marker stands for a compact patch of cells.

export const SMALL_UNIT = 100;
export const LARGE_UNIT = 1000;
export const LARGE_UNIT_FROM = 10000;
export const SMALL_UNIT_BELOW = 8000;
// A safety net: with the default limit of 100,000 organisms there are at most 100 markers. A larger population gets larger groups instead of more markers.
export const MAX_MARKERS = 128;

// A marker's radius as a fraction of the planet's radius; the large marker is twice the size.
const MARKER_SIZES = new Map([
	[SMALL_UNIT, 0.03],
	[LARGE_UNIT, 0.06],
]);

export function getMarkerSize(unit) {
	if (!MARKER_SIZES.has(unit)) throw new RangeError(`Unknown marker unit: ${unit}.`);
	return MARKER_SIZES.get(unit);
}

// Switches to large markers at 10,000 organisms and back below 8,000, so a population near the line does not flip every update.
export function getMarkerUnit(total, previousUnit = SMALL_UNIT) {
	if (total >= LARGE_UNIT_FROM) return LARGE_UNIT;
	return previousUnit === LARGE_UNIT && total >= SMALL_UNIT_BELOW ? LARGE_UNIT : SMALL_UNIT;
}

// The member cell nearest the group's organism-weighted centre, or the heaviest member if the centre cancels out.
function chooseCell(centers, ids, weights) {
	const centre = [0, 0, 0];
	ids.forEach((id, index) => {
		for (let axis = 0; axis < 3; axis++) centre[axis] += centers[id][axis] * weights[index];
	});
	const canceled = Math.hypot(...centre) < 1e-9;
	let best = null;
	let bestScore = -Infinity;
	ids.forEach((id, index) => {
		const cell = centers[id];
		const score = canceled ? weights[index] : cell[0] * centre[0] + cell[1] * centre[1] + cell[2] * centre[2];
		if (score > bestScore) [best, bestScore] = [id, score];
	});
	return best;
}

const geometryByWorld = new WeakMap();

// Each cell's centre, and the centres' x, y, and z coordinates as arrays, kept per world.
function getGeometry(world) {
	if (!geometryByWorld.has(world)) {
		const centers = world.cells.map((cell) => cell.center);
		const coordinates = [0, 1, 2].map((axis) => Float64Array.from(centers, (center) => center[axis]));
		geometryByWorld.set(world, { centers, coordinates });
	}
	return geometryByWorld.get(world);
}

/**
 * Splits the organisms into max(1, round(total / unit)) groups (at most MAX_MARKERS) whose sizes differ by at most one,
 * and returns one `{ cellId, organisms }` per group: the occupied cell nearest the group's centre, and the group's size.
 * `count` holds the number of organisms in each cell, indexed by cell id. The groups come from recursive median
 * splits: the occupied cells are cut in two, in proportion to the groups on each side, along the x, y, then z axis in turn
 * until each group is left, so every group is a compact patch and a cell on a cut may be shared. The axes are fixed rather
 * than chosen by shape, so a cut slides gradually as counts change instead of flipping. The result depends only on the counts.
 */
export function placeMarkers(world, count, unit) {
	getMarkerSize(unit);
	let total = 0;
	for (const organisms of count) total += organisms;
	if (total === 0) return [];
	const groups = Math.min(MAX_MARKERS, Math.max(1, Math.round(total / unit)));
	const groupEnd = (group) => Math.round((total * (group + 1)) / groups);
	const { centers, coordinates } = getGeometry(world);
	const markers = [];

	// `ids` and `weights` list the cells and organisms of groups `first` up to (not including) `last`.
	function split(ids, weights, first, last, depth) {
		const before = first === 0 ? 0 : groupEnd(first - 1);
		if (last - first === 1) {
			markers.push({ cellId: chooseCell(centers, ids, weights), organisms: weights.reduce((total, weight) => total + weight, 0) });
			return;
		}
		const middle = first + Math.floor((last - first) / 2);
		const coordinate = coordinates[depth % 3];
		const order = ids.map((_, index) => index).sort((a, b) => coordinate[ids[a]] - coordinate[ids[b]] || ids[a] - ids[b]);
		let toLeft = groupEnd(middle - 1) - before;
		const left = { ids: [], weights: [] };
		const right = { ids: [], weights: [] };
		for (const index of order) {
			const taken = Math.min(weights[index], toLeft);
			if (taken > 0) {
				left.ids.push(ids[index]);
				left.weights.push(taken);
			}
			if (taken < weights[index]) {
				right.ids.push(ids[index]);
				right.weights.push(weights[index] - taken);
			}
			toLeft -= taken;
		}
		split(left.ids, left.weights, first, middle, depth + 1);
		split(right.ids, right.weights, middle, last, depth + 1);
	}

	const ids = [];
	const weights = [];
	count.forEach((organisms, id) => {
		if (organisms > 0) {
			ids.push(id);
			weights.push(organisms);
		}
	});
	split(ids, weights, 0, groups, 0);
	return markers;
}

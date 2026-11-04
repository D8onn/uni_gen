// Colours every cell of the globe by one habitat field, as plain data with no Three.js.
import { getSurfaceType, SURFACE_COLORS } from "./planetMeshData.js";

// Ramps run from a field value of 0 to 1; every field is a unitless 0-1 index or fill fraction.
const COLD_TO_HOT = [0x313695, 0x74add1, 0xffffbf, 0xf46d43, 0xa50026];
const DRY_TO_WET = [0x8c510a, 0xd8b365, 0xf6e8c3, 0x5ab4ac, 0x01665e];
const DARK_TO_BRIGHT = [0x1b1b3a, 0x8a4b1f, 0xffd24d, 0xfffbe6];
const EMPTY_TO_FULL_WATER = [0xfff5e0, 0x9ecae1, 0x08519c];
const EMPTY_TO_FULL_NUTRIENTS = [0xf7fcb9, 0xaddd8e, 0x31a354, 0x004529];
const NONE_TO_CROWDED = [0x1c2733, 0x7a4fc4, 0xe0508a, 0xffd166];

// `source` names where the values come from: `conditions` never change; `cells` come from the simulation's snapshots.
// `key` is the field to read when it differs from the id, and `scale(raw, maxPerCell)` turns it into a 0-1 value.
export const CELL_VIEWS = [
	{ id: "biome", label: "Biome" },
	{ id: "temperature", label: "Temperature", source: "conditions", ramp: COLD_TO_HOT, low: "0 cold", high: "1 hot" },
	{ id: "moisture", label: "Moisture", source: "conditions", ramp: DRY_TO_WET, low: "0 dry", high: "1 wet" },
	{ id: "light", label: "Light", source: "conditions", ramp: DARK_TO_BRIGHT, low: "0 dark", high: "1 bright" },
	{ id: "waterFill", label: "Water stock", source: "cells", ramp: EMPTY_TO_FULL_WATER, low: "0 empty", high: "1 full" },
	{ id: "nutrientFill", label: "Nutrient stock", source: "cells", ramp: EMPTY_TO_FULL_NUTRIENTS, low: "0 empty", high: "1 full" },
	{
		id: "density",
		label: "Organism density",
		source: "cells",
		key: "count",
		// Square root, so a cell with a few organisms stands out from an empty one.
		scale: (count, maxPerCell) => Math.sqrt(count / maxPerCell),
		ramp: NONE_TO_CROWDED,
		low: "0 none",
		high: "1 cap (sqrt)",
	},
];

const hexToRgb = (hex) => [(hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

// The sRGB colour at `value` (clamped to 0-1) along a ramp of evenly spaced stops.
function sampleRamp(ramp, value) {
	const position = (Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, value))) * (ramp.length - 1);
	const lower = Math.min(Math.floor(position), ramp.length - 2);
	const share = position - lower;
	const [r0, g0, b0] = hexToRgb(ramp[lower]);
	const [r1, g1, b1] = hexToRgb(ramp[lower + 1]);
	return [r0 + (r1 - r0) * share, g0 + (g1 - g0) * share, b0 + (b1 - b0) * share];
}

export function getCellView(viewId) {
	const view = CELL_VIEWS.find(({ id }) => id === viewId);
	if (!view) throw new RangeError(`Unknown view: ${viewId}.`);
	return view;
}

// True for views whose values change as the simulation runs.
export function isLiveView(viewId) {
	return getCellView(viewId).source === "cells";
}

// The legend for a view as `{ title, stops, low, high }` (stops are CSS hex colours), or null for the biome view.
export function getViewLegend(viewId) {
	const view = getCellView(viewId);
	if (!view.ramp) return null;
	return {
		title: view.label,
		stops: view.ramp.map((hex) => `#${hex.toString(16).padStart(6, "0")}`),
		low: view.low,
		high: view.high,
	};
}

/**
 * Returns three sRGB floats (0-1) per cell id for a view. `conditions` is a habitat's `conditions`,
 * `cells` is a snapshot's per-cell arrays, and `maxPerCell` its organism limit per cell; each is only
 * needed by the views that read it.
 */
export function computeCellColors(viewId, { world, conditions, cells, maxPerCell }) {
	const view = getCellView(viewId);
	const colors = new Float32Array(world.cells.length * 3);
	if (viewId === "biome") {
		world.cells.forEach((cell, id) => colors.set(hexToRgb(SURFACE_COLORS.get(getSurfaceType(cell))), id * 3));
		return colors;
	}
	const values = (view.source === "cells" ? cells : conditions)?.[view.key ?? viewId];
	if (!values || values.length !== world.cells.length) {
		throw new RangeError(`The ${view.label.toLowerCase()} view needs one value per cell.`);
	}
	if (view.scale && !(maxPerCell > 0)) throw new RangeError(`The ${view.label.toLowerCase()} view needs a positive maxPerCell.`);
	values.forEach((value, id) => colors.set(sampleRamp(view.ramp, view.scale ? view.scale(value, maxPerCell) : value), id * 3));
	return colors;
}

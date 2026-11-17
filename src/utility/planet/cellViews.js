// Colours every cell of the globe by one habitat field, as plain data with no Three.js.
import { getSurfaceType, SURFACE_COLORS } from "./planetMeshData.js";

// Ramps run from a field value of 0 to 1; every field is a unitless 0-1 index or fill fraction.
const COLD_TO_HOT = [0x313695, 0x74add1, 0xffffbf, 0xf46d43, 0xa50026];
const DRY_TO_WET = [0x8c510a, 0xd8b365, 0xf6e8c3, 0x5ab4ac, 0x01665e];
const DARK_TO_BRIGHT = [0x1b1b3a, 0x8a4b1f, 0xffd24d, 0xfffbe6];
const EMPTY_TO_FULL_WATER = [0xfff5e0, 0x9ecae1, 0x08519c];
const EMPTY_TO_FULL_NUTRIENTS = [0xf7fcb9, 0xaddd8e, 0x31a354, 0x004529];
const NONE_TO_CROWDED = [0x1c2733, 0x7a4fc4, 0xe0508a, 0xffd166];
const EMPTY_CELL = 0x1c2733; // empty cells, and cells in no region, are drawn as a dark neutral
const EMPTY_LAND_SHADE = 0.5; // with Show empty land, an empty land cell is its region's colour at this brightness

// `source` names where the values come from: `conditions` never change; `cells` come from the simulation's snapshots.
// `key` is the field to read when it differs from the id, and `scale(raw, maxPerCell)` turns it into a 0-1 value.
// `occupiedOnly` draws cells without organisms as the neutral colour, and `categorical` colours by an integer id instead of a ramp.
// `emptyLandOption` lets the `showEmptyLand` option dim empty land in its region's colour, and `help` explains the view in the panel.
export const CELL_VIEWS = [
	{ id: "biome", label: "Biome", help: "Each cell is coloured by its biome; river cells have their own colour. Trees show only in this view." },
	{
		id: "temperature",
		label: "Temperature",
		source: "conditions",
		ramp: COLD_TO_HOT,
		low: "0 cold",
		high: "1 hot",
		help: "Each cell's temperature from its latitude and elevation, a unitless 0 (cold) to 1 (hot). It does not change during a run.",
	},
	{
		id: "moisture",
		label: "Moisture",
		source: "conditions",
		ramp: DRY_TO_WET,
		low: "0 dry",
		high: "1 wet",
		help: "Each cell's moisture, a unitless 0 (dry) to 1 (wet). It does not change during a run.",
	},
	{
		id: "light",
		label: "Light",
		source: "conditions",
		ramp: DARK_TO_BRIGHT,
		low: "0 dark",
		high: "1 bright",
		help: "Each cell's light from its latitude, a unitless 0 (dark) to 1 (bright). It does not change during a run.",
	},
	{
		id: "waterFill",
		label: "Water stock",
		source: "cells",
		ramp: EMPTY_TO_FULL_WATER,
		low: "0 empty",
		high: "1 full",
		help: "Water in each cell as a fraction of its capacity: 0 empty, 1 full. It changes during a run.",
	},
	{
		id: "nutrientFill",
		label: "Nutrient stock",
		source: "cells",
		ramp: EMPTY_TO_FULL_NUTRIENTS,
		low: "0 empty",
		high: "1 full",
		help: "Nutrients in each cell as a fraction of its capacity: 0 empty, 1 full. It changes during a run.",
	},
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
		help: "Organisms in each cell divided by the per-cell limit, on a square-root scale, so one organism shows against an empty cell. 0 none, 1 a full cell.",
	},
	{
		id: "temperatureOptimum",
		label: "Temperature optimum",
		source: "cells",
		occupiedOnly: true,
		ramp: COLD_TO_HOT,
		low: "0 cold-adapted",
		high: "1 hot-adapted",
		help: "The mean temperature optimum of the organisms in each cell, 0 (cold-adapted) to 1 (hot-adapted). Empty cells are dark.",
	},
	{
		id: "moistureOptimum",
		label: "Moisture optimum",
		source: "cells",
		occupiedOnly: true,
		ramp: DRY_TO_WET,
		low: "0 dry-adapted",
		high: "1 wet-adapted",
		help: "The mean moisture optimum of the organisms in each cell, 0 (dry-adapted) to 1 (wet-adapted). Empty cells are dark.",
	},
	{
		id: "region",
		label: "Dispersal region",
		source: "cells",
		occupiedOnly: true,
		categorical: true,
		emptyLandOption: true,
		note: "Each colour is a separate land region that organisms cannot leave; water is dark, and empty land is dark or, with Show empty land, dimmed.",
		help: "Each colour is a separate land region that organisms cannot leave. Dark cells hold no organisms; with Show empty land on, empty land is dimmed in its region's colour.",
	},
];

const hexToRgb = (hex) => [(hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

// A colour for a region id: hues a golden angle apart, so neighbouring ids differ and an id always has the same colour.
function regionColor(region) {
	if (!(region >= 0)) return hexToRgb(EMPTY_CELL);
	const hue = ((region * 137.508) % 360) / 60;
	const [saturation, lightness] = [0.65, 0.55];
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const x = chroma * (1 - Math.abs((hue % 2) - 1));
	const [r, g, b] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][Math.floor(hue) % 6];
	const offset = lightness - chroma / 2;
	return [r + offset, g + offset, b + offset];
}

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

const toCssHex = (hex) => `#${hex.toString(16).padStart(6, "0")}`;

// The legend for a view: `{ title, stops, low, high }` (stops are CSS hex colours), `{ title, note }` for a view coloured by category,
// or `{ title, swatches: [{ label, color }] }` for the biome view, one swatch per surface colour the renderer uses.
export function getViewLegend(viewId) {
	const view = getCellView(viewId);
	if (viewId === "biome") return { title: view.label, swatches: [...SURFACE_COLORS].map(([label, hex]) => ({ label, color: toCssHex(hex) })) };
	if (view.note) return { title: view.label, note: view.note };
	return {
		title: view.label,
		stops: view.ramp.map(toCssHex),
		low: view.low,
		high: view.high,
	};
}

/**
 * Returns three sRGB floats (0-1) per cell id for a view. `conditions` is a habitat's `conditions`,
 * `cells` is a snapshot's per-cell arrays, and `maxPerCell` its organism limit per cell; each is only
 * needed by the views that read it. Views that colour only occupied cells also need `cells.count`. `showEmptyLand`
 * colours empty land cells by their region, dimmed, in a view with `emptyLandOption`; water stays neutral.
 */
export function computeCellColors(viewId, { world, conditions, cells, maxPerCell, showEmptyLand = false }) {
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
	const counts = cells?.count;
	if (view.occupiedOnly && counts?.length !== world.cells.length) throw new RangeError(`The ${view.label.toLowerCase()} view needs the organism count of every cell.`);
	const empty = hexToRgb(EMPTY_CELL);
	const shadeEmpty = view.emptyLandOption && showEmptyLand;
	values.forEach((value, id) => {
		let color;
		if (view.occupiedOnly && counts[id] === 0) color = shadeEmpty && value >= 0 ? regionColor(value).map((channel) => channel * EMPTY_LAND_SHADE) : empty;
		else if (view.categorical) color = regionColor(value);
		else color = sampleRamp(view.ramp, view.scale ? view.scale(value, maxPerCell) : value);
		colors.set(color, id * 3);
	});
	return colors;
}

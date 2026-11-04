import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createHabitat, getResourceFill } from "../src/utility/ecology/habitat.js";
import {
	createPopulation,
	EVOLVING_PRODUCER,
	getCellCounts,
	getCellTraitMeans,
	getDispersalRegions,
	stepPopulation,
} from "../src/utility/ecology/population.js";
import { CELL_VIEWS, computeCellColors, getViewLegend, isLiveView } from "../src/utility/planet/cellViews.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";
import { getSurfaceType, SURFACE_COLORS } from "../src/utility/planet/planetMeshData.js";

const world = createGlobeMap({ poleToPoleCells: 20, seed: 1, radius: 10 });
const cellCount = world.cells.length;
const colorOf = (colors, id) => Array.from(colors.slice(id * 3, id * 3 + 3));
const near = (actual, expected, message) => {
	assert.equal(actual.length, expected.length);
	actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-6, `${message}: ${actual} vs ${expected}`));
};
const rgb = (hex) => [(hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

test("the views are the biome view plus each habitat field, with a legend for every field", () => {
	assert.deepEqual(CELL_VIEWS.map(({ id }) => id), ["biome", "temperature", "moisture", "light", "waterFill", "nutrientFill", "density", "temperatureOptimum", "moistureOptimum", "region"]);
	assert.equal(getViewLegend("biome"), null);
	for (const { id } of CELL_VIEWS.slice(1)) {
		const legend = getViewLegend(id);
		if (id === "region") {
			assert.deepEqual(Object.keys(legend), ["title", "note"], "a view coloured by category has a note instead of a ramp");
			continue;
		}
		assert.ok(legend.stops.length >= 3 && legend.stops.every((stop) => /^#[0-9a-f]{6}$/.test(stop)), id);
		assert.match(legend.low, /^0 /);
		assert.match(legend.high, /^1 /);
	}
	assert.deepEqual(CELL_VIEWS.filter(({ id }) => isLiveView(id)).map(({ id }) => id), ["waterFill", "nutrientFill", "density", "temperatureOptimum", "moistureOptimum", "region"]);
	assert.throws(() => getViewLegend("humidity"), RangeError);
	assert.throws(() => computeCellColors("humidity", { world }), RangeError);
});

test("the biome view colours each cell as the renderer coloured its surface, rivers included", () => {
	const colors = computeCellColors("biome", { world });
	assert.equal(colors.length, cellCount * 3);
	assert.ok(world.cells.some((cell) => cell.hasRiver));
	for (const cell of world.cells) {
		const expected = new THREE.Color(SURFACE_COLORS.get(getSurfaceType(cell)));
		const actual = new THREE.Color().setRGB(...colorOf(colors, cell.id), THREE.SRGBColorSpace);
		near([actual.r, actual.g, actual.b], [expected.r, expected.g, expected.b], `cell ${cell.id}`);
	}
});

test("a field view maps 0 and 1 to the ends of its ramp and blends between the stops", () => {
	const fake = { cells: Array.from({ length: 6 }, () => ({})) };
	const values = Float32Array.of(0, 0.25, 0.5, 0.75, 1, 0.125);
	const colors = computeCellColors("temperature", { world: fake, conditions: { temperature: values } });
	const stops = getViewLegend("temperature").stops.map((stop) => rgb(Number.parseInt(stop.slice(1), 16)));
	[0, 1, 2, 3, 4].forEach((id) => near(colorOf(colors, id), stops[id], `stop ${id}`));
	near(colorOf(colors, 5), stops[0].map((value, channel) => (value + stops[1][channel]) / 2), "halfway to the second stop");
});

test("values outside 0-1 clamp to the ramp ends and a missing value reads as 0", () => {
	const fake = { cells: [{}, {}, {}] };
	const stops = getViewLegend("moisture").stops.map((stop) => rgb(Number.parseInt(stop.slice(1), 16)));
	const colors = computeCellColors("moisture", { world: fake, conditions: { moisture: [-3, 7, Number.NaN] } });
	near(colorOf(colors, 0), stops[0], "below 0");
	near(colorOf(colors, 1), stops.at(-1), "above 1");
	near(colorOf(colors, 2), stops[0], "NaN");
});

test("every habitat view on a real world colours cells by their value, deterministically", () => {
	const habitat = createHabitat(world);
	const population = createPopulation(world, { seed: 1, initialCount: 150, species: EVOLVING_PRODUCER });
	stepPopulation(population, createHabitat(world), 30);
	const cells = {
		waterFill: getResourceFill(habitat, "water"),
		nutrientFill: getResourceFill(habitat, "nutrients"),
		count: getCellCounts(population),
		...getCellTraitMeans(population),
		region: Int32Array.from(getDispersalRegions(population, habitat).regionOfCell),
	};
	const maxPerCell = population.species.maxPerCell;
	for (const view of CELL_VIEWS.slice(1)) {
		const inputs = { world, conditions: habitat.conditions, cells, maxPerCell };
		const colors = computeCellColors(view.id, inputs);
		assert.equal(colors.length, cellCount * 3);
		assert.deepEqual(computeCellColors(view.id, inputs), colors);
		if (view.occupiedOnly) continue; // empty cells hide their value, so these views are checked on their own
		const values = habitat.conditions[view.id] ?? cells[view.key ?? view.id];
		// Cells with equal values share a colour and cells with different values differ.
		const byValue = new Map();
		values.forEach((value, cellId) => {
			const key = colorOf(colors, cellId).join(",");
			if (byValue.has(value)) assert.equal(byValue.get(value), key);
			byValue.set(value, key);
		});
		// Fixed conditions and the organism count vary across a world; stocks all start full, so only they may share one colour.
		if (view.id in habitat.conditions || view.id === "density") assert.ok(new Set(byValue.values()).size > 1, view.id);
	}
	const lowest = habitat.conditions.temperature.indexOf(Math.min(...habitat.conditions.temperature));
	const highest = habitat.conditions.temperature.indexOf(Math.max(...habitat.conditions.temperature));
	const colors = computeCellColors("temperature", { world, conditions: habitat.conditions });
	assert.ok(colorOf(colors, lowest)[2] > colorOf(colors, lowest)[0], "the coldest cell reads blue");
	assert.ok(colorOf(colors, highest)[0] > colorOf(colors, highest)[2], "the hottest cell reads red");
});

test("a view that needs data it was not given reports a RangeError", () => {
	const habitat = createHabitat(world);
	assert.throws(() => computeCellColors("waterFill", { world, conditions: habitat.conditions }), /water stock view needs one value per cell/);
	assert.throws(() => computeCellColors("nutrientFill", { world, cells: { nutrientFill: [0.5] } }), RangeError);
	assert.throws(() => computeCellColors("temperature", { world }), RangeError);
	assert.throws(() => computeCellColors("density", { world, cells: { count: new Uint32Array(cellCount) } }), /needs a positive maxPerCell/);
	assert.throws(() => computeCellColors("density", { world, maxPerCell: 50 }), /needs one value per cell/);
});

test("the density view runs from an empty cell to a full one on a square-root scale", () => {
	const fake = { cells: Array.from({ length: 4 }, () => ({})) };
	const stops = getViewLegend("density").stops.map((stop) => rgb(Number.parseInt(stop.slice(1), 16)));
	const colors = computeCellColors("density", { world: fake, cells: { count: Uint32Array.of(0, 1, 50, 200) }, maxPerCell: 50 });
	near(colorOf(colors, 0), stops[0], "empty");
	near(colorOf(colors, 2), stops.at(-1), "at the cap");
	near(colorOf(colors, 3), stops.at(-1), "above the cap clamps");
	// 12 of 48 is a quarter of the cap, so the square root is a half: half way between the second and third of four stops.
	const quarter = computeCellColors("density", { world: fake, cells: { count: Uint32Array.of(0, 12, 0, 0) }, maxPerCell: 48 });
	near(colorOf(quarter, 1), stops[1].map((value, channel) => (value + stops[2][channel]) / 2), "a quarter of the cap");
	assert.notDeepEqual(colorOf(colors, 1), colorOf(colors, 0), "one organism is visible against an empty cell");
});

test("resource views change as stocks are consumed", () => {
	const habitat = createHabitat(world);
	const landCell = world.cells.find((cell) => cell.biome !== "Water").id;
	const before = computeCellColors("nutrientFill", { world, cells: { nutrientFill: getResourceFill(habitat, "nutrients") } });
	habitat.resources.nutrients[landCell] *= 0.2;
	const after = computeCellColors("nutrientFill", { world, cells: { nutrientFill: getResourceFill(habitat, "nutrients") } });
	assert.notDeepEqual(colorOf(after, landCell), colorOf(before, landCell));
	const others = [...before.keys()].filter((index) => Math.floor(index / 3) !== landCell);
	assert.ok(others.every((index) => before[index] === after[index]));
});

// Cells 0 to 3 with chosen counts and values, for the views that colour only occupied cells.
const fourCells = { cells: Array.from({ length: 4 }, () => ({})) };
const NEUTRAL = rgb(0x1c2733);

test("the trait views colour occupied cells by their mean optimum and leave empty cells neutral", () => {
	for (const [id, ramp] of [["temperatureOptimum", "temperature"], ["moistureOptimum", "moisture"]]) {
		const stops = getViewLegend(ramp).stops.map((stop) => rgb(Number.parseInt(stop.slice(1), 16)));
		const cells = { count: Uint32Array.of(3, 0, 1, 5), [id]: Float32Array.of(0, Number.NaN, 1, 0.5) };
		const colors = computeCellColors(id, { world: fourCells, cells });
		near(colorOf(colors, 0), stops[0], `${id} at 0`);
		near(colorOf(colors, 1), NEUTRAL, `${id} in an empty cell`);
		near(colorOf(colors, 2), stops.at(-1), `${id} at 1`);
		assert.equal(stops.length, 5);
		near(colorOf(colors, 3), stops[2], `${id} at 0.5, the middle stop`);
		assert.deepEqual(getViewLegend(id).low.slice(0, 2), "0 ");
		// An empty cell is neutral even if its stored value is a real number.
		const stale = computeCellColors(id, { world: fourCells, cells: { count: Uint32Array.of(0, 0, 0, 0), [id]: Float32Array.of(0.1, 0.9, 0.5, 1) } });
		for (let cell = 0; cell < 4; cell++) near(colorOf(stale, cell), NEUTRAL, `${id} cell ${cell}`);
	}
	assert.throws(() => computeCellColors("temperatureOptimum", { world: fourCells, cells: { temperatureOptimum: Float32Array.of(0, 0, 0, 0) } }), /needs the organism count of every cell/);
});

test("the region view gives each region its own stable colour, and empty cells and cells in no region are neutral", () => {
	const regions = Int32Array.of(0, 1, 0, -1);
	const colors = computeCellColors("region", { world: fourCells, cells: { region: regions, count: Uint32Array.of(2, 4, 1, 0) } });
	near(colorOf(colors, 0), colorOf(colors, 2), "two cells in region 0");
	assert.notDeepEqual(colorOf(colors, 0), colorOf(colors, 1), "regions 0 and 1 differ");
	near(colorOf(colors, 3), NEUTRAL, "a cell in no region");
	const emptyInRegion = computeCellColors("region", { world: fourCells, cells: { region: regions, count: Uint32Array.of(0, 4, 1, 0) } });
	near(colorOf(emptyInRegion, 0), NEUTRAL, "an empty cell in region 0");
	// The colour of a region depends only on its id, not on the other cells or on the tick.
	const later = computeCellColors("region", { world: fourCells, cells: { region: regions, count: Uint32Array.of(9, 1, 7, 0) } });
	for (const cell of [0, 1, 2]) near(colorOf(later, cell), colorOf(colors, cell), `cell ${cell} later`);
	// Twenty regions (a typical globe has about that many) all look different.
	const twenty = { cells: Array.from({ length: 20 }, () => ({})) };
	const all = computeCellColors("region", { world: twenty, cells: { region: Int32Array.from({ length: 20 }, (_, id) => id), count: new Uint32Array(20).fill(1) } });
	assert.equal(new Set(Array.from({ length: 20 }, (_, id) => colorOf(all, id).map((value) => Math.round(value * 255)).join())).size, 20);
	assert.ok(all.every((value) => value >= 0 && value <= 1));
	assert.throws(() => computeCellColors("region", { world: fourCells, cells: { region: regions } }), /needs the organism count/);
});

test("on a real run the region view keeps the colour of every cell that stays occupied", () => {
	const habitat = createHabitat(world);
	const population = createPopulation(world, { seed: 3, initialCount: 120, species: EVOLVING_PRODUCER });
	const region = Int32Array.from(getDispersalRegions(population, habitat).regionOfCell);
	const colorsAt = (counts) => computeCellColors("region", { world, cells: { region, count: counts } });
	const countsBefore = getCellCounts(population);
	const before = colorsAt(countsBefore);
	stepPopulation(population, createHabitat(world), 25);
	const countsAfter = getCellCounts(population);
	const after = colorsAt(countsAfter);
	const kept = world.cells.filter((cell) => countsBefore[cell.id] > 0 && countsAfter[cell.id] > 0);
	const changed = world.cells.filter((cell) => (countsBefore[cell.id] > 0) !== (countsAfter[cell.id] > 0));
	assert.ok(kept.length > 10 && changed.length > 0, "the run keeps some cells and changes others");
	for (const cell of kept) assert.deepEqual(colorOf(after, cell.id), colorOf(before, cell.id), `cell ${cell.id}`);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createViewController } from "../src/ui/viewController.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";

const world = createGlobeMap({ poleToPoleCells: 20, seed: 3, radius: 10 });
const land = world.cells.filter((cell) => cell.biome !== "Water");

// A planet and client that record what the controller does.
function createHarness() {
	const calls = { markers: [], colors: 0, trees: [] };
	let listener = null;
	const planet = {
		world,
		setCellColors: () => (calls.colors += 1),
		setTreesVisible: (visible) => calls.trees.push(visible),
		setMarkers: (markers, unit) => calls.markers.push({ markers, unit }),
		setMarkersVisible: () => {},
	};
	const controller = createViewController({ planet, client: { subscribe: (callback) => (listener = callback) } });
	const infos = [];
	controller.onMarkers((info) => infos.push(info));
	return {
		calls,
		infos,
		controller,
		snapshot(tick, organisms) {
			const count = new Uint32Array(world.cells.length);
			for (let index = 0; index < organisms; index++) count[land[index % land.length].id] += 1;
			listener({
				type: "snapshot",
				summary: { tick, count: organisms },
				maxPerCell: 50,
				cells: { count, waterFill: new Float32Array(world.cells.length).fill(1), nutrientFill: new Float32Array(world.cells.length).fill(1) },
			});
			return infos.at(-1);
		},
	};
}

test("the controller marks each snapshot with one marker per 100 organisms, or per 1000 from 10,000", () => {
	const { snapshot, calls } = createHarness();
	assert.deepEqual(snapshot(0, 300), { unit: 100, shown: 3, organisms: 300 });
	assert.deepEqual(snapshot(1, 12000), { unit: 1000, shown: 12, organisms: 12000 });
	assert.equal(calls.markers.at(-1).unit, 1000);
	assert.equal(calls.markers.at(-1).markers.length, 12);
});

test("the large marker stays until the population drops below 8,000 (the hysteresis)", () => {
	const { snapshot } = createHarness();
	snapshot(1, 12000);
	assert.equal(snapshot(2, 9000).unit, 1000);
	assert.equal(snapshot(3, 8000).unit, 1000);
	assert.equal(snapshot(4, 7999).unit, 100);
	assert.equal(snapshot(5, 9000).unit, 100, "and it does not come back until 10,000");
});

test("a run that restarts at tick 0 does not inherit the previous run's marker size", () => {
	const { snapshot } = createHarness();
	assert.equal(snapshot(40, 12000).unit, 1000);
	assert.equal(snapshot(41, 9500).unit, 1000);
	// Reset or Apply: back to tick 0 with 9,500 organisms, which a fresh page would show as small markers.
	assert.deepEqual(snapshot(0, 9500), { unit: 100, shown: 95, organisms: 9500 });
	assert.equal(snapshot(0, 9500).unit, 100, "repeated snapshots at tick 0 agree");
	assert.equal(snapshot(1, 9500).unit, 100);
});

test("an empty population has no markers", () => {
	const { snapshot, calls } = createHarness();
	assert.deepEqual(snapshot(0, 0), { unit: 100, shown: 0, organisms: 0 });
	assert.deepEqual(calls.markers.at(-1).markers, []);
});

test("live views recolour on snapshots and trees show only in the biome view", () => {
	const { snapshot, calls, controller } = createHarness();
	snapshot(0, 100);
	const colorsAfterBiome = calls.colors;
	controller.select("density");
	assert.equal(calls.colors, colorsAfterBiome + 1);
	assert.equal(calls.trees.at(-1), false);
	snapshot(1, 100);
	assert.equal(calls.colors, colorsAfterBiome + 2, "a live view is recoloured by each snapshot");
	controller.select("temperature");
	const colorsAfterTemperature = calls.colors;
	snapshot(2, 100);
	assert.equal(calls.colors, colorsAfterTemperature, "a fixed view is not recoloured by snapshots");
	controller.select("biome");
	assert.equal(calls.trees.at(-1), true);
});

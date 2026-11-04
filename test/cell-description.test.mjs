import assert from "node:assert/strict";
import test from "node:test";
import { describeCell } from "../src/ui/cellDescription.js";
import { createSimulation } from "../src/utility/ecology/simulation.js";
import { extractSimulationInput } from "../src/utility/ecology/simulationInput.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";

const world = createGlobeMap({ poleToPoleCells: 20, seed: 7, radius: 10 });
const params = { seed: 7, founders: 120, species: "evolving", dispersal: 0.2, speed: 10 };
const simulation = createSimulation();
simulation.setWorld(extractSimulationInput(world));
simulation.configure(params);
simulation.step(10);
const counts = simulation.snapshot().cells.count;
const rowsOf = (description) => Object.fromEntries(description.rows);

test("a cell with organisms is described from the world and the worker's data", () => {
	const cellId = counts.findIndex((count) => count > 1);
	const data = simulation.inspectCell(cellId);
	const cell = world.cells[cellId];
	const description = describeCell(cell, data);
	assert.equal(description.title, `Cell ${cellId}: ${cell.biome}`);
	const rows = rowsOf(description);
	assert.equal(rows.Elevation, cell.elevation.toFixed(2));
	assert.equal(rows.River, cell.hasRiver ? "yes" : "no");
	assert.equal(rows.Temperature, data.conditions.temperature.toFixed(2));
	assert.equal(rows.Moisture, data.conditions.moisture.toFixed(2));
	assert.equal(rows.Light, data.conditions.light.toFixed(2));
	assert.equal(rows.Water, `${data.resources.water.toFixed(2)} of ${data.capacity.water.toFixed(2)}`);
	assert.equal(rows.Nutrients, `${data.resources.nutrients.toFixed(2)} of ${data.capacity.nutrients.toFixed(2)}`);
	assert.equal(rows.Tick, "10");
	const { organisms } = description;
	assert.equal(organisms.count, counts[cellId]);
	assert.equal(organisms.list.length, counts[cellId]);
	organisms.list.forEach((listed, index) => {
		const source = data.organisms[index];
		assert.deepEqual(listed, { id: source.id, age: source.age, biomass: source.biomass, ...source.traits });
	});
	const mean = data.organisms.reduce((total, organism) => total + organism.traits.temperatureOptimum, 0) / data.organisms.length;
	assert.ok(Math.abs(organisms.traits.temperatureOptimum.mean - mean) < 1e-12);
});

test("an empty cell and an ocean cell show no organisms and no trait summary", () => {
	const ocean = world.cells.find((cell) => cell.biome === "Water");
	const description = describeCell(ocean, simulation.inspectCell(ocean.id));
	assert.deepEqual(description.organisms, { count: 0, traits: null, list: [] });
	assert.equal(description.title, `Cell ${ocean.id}: Water`);
	assert.ok(rowsOf(description).Water.endsWith("of 1.00"), "ocean cells have a full water capacity");
});

test("before the worker answers only the world's facts are shown", () => {
	const cell = world.cells[5];
	const description = describeCell(cell, null);
	assert.equal(description.organisms, null);
	assert.deepEqual(description.rows.map(([label]) => label), ["Elevation", "River", "Neighbors"]);
});

test("a pentagon says so, and a hexagon does not", () => {
	const pentagon = world.cells.find((cell) => cell.neighbors.length === 5);
	const hexagon = world.cells.find((cell) => cell.neighbors.length === 6);
	assert.equal(rowsOf(describeCell(pentagon, null)).Neighbors, "5 (pentagon)");
	assert.equal(rowsOf(describeCell(hexagon, null)).Neighbors, "6");
});

test("the description follows cells as ticks advance, including ones that empty", () => {
	const watched = Array.from(counts, (count, id) => (count > 0 ? id : -1)).filter((id) => id !== -1).slice(0, 30);
	assert.ok(watched.length >= 10);
	let emptied = 0;
	for (let tick = 0; tick < 60; tick++) {
		simulation.step(1);
		const live = simulation.snapshot().cells.count;
		for (const cellId of watched) {
			const description = describeCell(world.cells[cellId], simulation.inspectCell(cellId));
			assert.equal(description.organisms.count, live[cellId], `cell ${cellId} at tick ${description.rows.find(([label]) => label === "Tick")[1]}`);
			assert.equal(description.organisms.list.length, live[cellId]);
			assert.equal(description.organisms.traits === null, live[cellId] === 0);
			if (live[cellId] === 0) emptied += 1;
		}
	}
	assert.ok(emptied > 0, "no watched cell emptied, so the test does not cover that case");
	assert.equal(rowsOf(describeCell(world.cells[watched[0]], simulation.inspectCell(watched[0]))).Tick, "70");
});

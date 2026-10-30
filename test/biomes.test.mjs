import assert from "node:assert/strict";
import test from "node:test";
import {
	BIOMES,
	classifyBiome,
	classifyClimateBiome,
	ECOTONE_BIOME,
	isPlausibleTransition,
	refineBiomes,
} from "../src/utility/planet/biomes.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";
import { SURFACE_COLORS } from "../src/utility/planet/planetMeshData.js";

const MAX_ELEVATION = 0.45;
const CLIMATE_BIOMES = ["Taiga", "Grasslands", "Forest", "Desert", "Chaparral"];

function land(temperature, moisture, { elevation = 0.05, coastal = false } = {}) {
	return classifyBiome({ elevation, temperature, moisture, coastal }, MAX_ELEVATION);
}

test("biomes follow the documented elevation, temperature, and moisture ranges", () => {
	assert.equal(land(0.8, 0.5, { elevation: -0.08 }), "Water");
	assert.equal(land(0.8, 0.5, { elevation: -0.07 }), "Grasslands");
	assert.equal(land(0.8, 0.5, { elevation: 0.33 }), "Mountains");
	assert.equal(land(0.1, 0.1, { elevation: 0.32 }), "Taiga");
	assert.equal(land(0.8, 0.1, { elevation: 0.06, coastal: true }), "Beaches");
	assert.equal(land(0.8, 0.1, { elevation: 0.07, coastal: true }), "Desert");
	assert.equal(land(0.29, 0.5, { elevation: 0.01, coastal: true }), "Taiga");

	assert.equal(land(0.29, 0.1), "Taiga");
	assert.equal(land(0.29, 0.9), "Taiga");
	assert.equal(land(0.3, 0.1), "Grasslands");
	assert.equal(land(0.54, 0.1), "Grasslands");
	assert.equal(land(0.55, 0.1), "Desert");
	assert.equal(land(0.55, 0.26), "Desert");
	assert.equal(land(0.55, 0.27), "Chaparral");
	assert.equal(land(0.9, 0.44), "Chaparral");
	assert.equal(land(0.9, 0.45), "Grasslands");
	assert.equal(land(0.9, 0.61), "Grasslands");
	assert.equal(land(0.9, 0.62), "Forest");
	assert.equal(land(0.4, 0.62), "Forest");
	assert.equal(land(0.4, 0.3), "Grasslands");
});

test("climate biomes that border in climate space are plausible transitions, and the rest are not", () => {
	const step = 0.005;
	const touching = new Set();
	for (let temperature = 0; temperature <= 1; temperature += step) {
		for (let moisture = 0; moisture <= 1; moisture += step) {
			const biome = classifyClimateBiome(temperature, moisture);
			for (const other of [
				classifyClimateBiome(temperature + step, moisture),
				classifyClimateBiome(temperature, moisture + step),
			]) {
				if (other !== biome) touching.add([biome, other].sort().join("-"));
			}
		}
	}

	for (const biomeA of CLIMATE_BIOMES) {
		for (const biomeB of CLIMATE_BIOMES) {
			if (biomeA === biomeB) continue;
			assert.equal(
				isPlausibleTransition(biomeA, biomeB),
				touching.has([biomeA, biomeB].sort().join("-")),
				`${biomeA}-${biomeB}`
			);
		}
	}
	for (const biome of BIOMES) {
		assert.ok(isPlausibleTransition(ECOTONE_BIOME, biome), biome);
		for (const terrain of ["Water", "Mountains", "Beaches"]) assert.ok(isPlausibleTransition(terrain, biome));
	}
	assert.equal(isPlausibleTransition("Desert", "Forest"), false);
	assert.equal(isPlausibleTransition("Chaparral", "Forest"), false);
});

test("refinement turns implausible neighbors into the ecotone regardless of cell order", () => {
	// A path of cells: Water, Desert, Desert, Forest, Forest, Taiga, Chaparral, Mountains.
	const biomes = ["Water", "Desert", "Desert", "Forest", "Forest", "Taiga", "Chaparral", "Mountains"];
	const last = biomes.length - 1;
	const path = biomes.map((biome, id) => ({
		id,
		biome,
		neighbors: [id - 1, id + 1].filter((neighborId) => neighborId >= 0 && neighborId <= last),
	}));
	const reversed = path
		.slice()
		.reverse()
		.map((cell, id) => ({ ...cell, id, neighbors: cell.neighbors.map((neighborId) => last - neighborId) }));

	const refined = refineBiomes(path);
	assert.deepEqual(refined, [
		"Water",
		"Desert",
		"Grasslands",
		"Grasslands",
		"Forest",
		"Grasslands",
		"Grasslands",
		"Mountains",
	]);
	assert.deepEqual(refineBiomes(reversed).reverse(), refined);
	assert.deepEqual(refineBiomes(path.map((cell) => ({ ...cell, biome: refined[cell.id] }))), refined);
});

test("generated worlds classify every cell from its environment with only plausible transitions", () => {
	for (const seed of [1, 12345]) {
		const globe = createGlobeMap({ poleToPoleCells: 80, seed });
		const isCoastal = (cell) => cell.neighbors.some((id) => globe.cells[id].biome === "Water");
		let refined = 0;

		assert.deepEqual(globe.biomes, BIOMES);
		for (const cell of globe.cells) {
			const primary = classifyBiome({ ...cell, coastal: isCoastal(cell) }, MAX_ELEVATION);
			if (cell.biome !== primary) {
				refined++;
				assert.equal(cell.biome, ECOTONE_BIOME, `cell ${cell.id}`);
				assert.ok(CLIMATE_BIOMES.includes(primary), `cell ${cell.id}`);
			}
			for (const id of cell.neighbors) {
				assert.ok(isPlausibleTransition(cell.biome, globe.cells[id].biome), `${cell.id}-${id}`);
			}
		}
		assert.ok(refined / globe.cells.length < 0.05, `refined share, seed ${seed}`);
		for (const biome of BIOMES) assert.ok(globe.cells.some((cell) => cell.biome === biome), `${biome}, seed ${seed}`);
	}
});

test("every biome has a renderer surface color", () => {
	for (const biome of BIOMES) assert.ok(Number.isInteger(SURFACE_COLORS.get(biome)), biome);
	assert.ok(SURFACE_COLORS.has("River"));
});

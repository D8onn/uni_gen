import assert from "node:assert/strict";
import test from "node:test";
import {
	ARID_MOISTURE,
	BIOMES,
	classifyClimateBiome,
	COLD_TEMPERATURE,
	ECOTONE_BIOME,
	HUMID_MOISTURE,
	SEA_LEVEL,
	WARM_TEMPERATURE,
} from "../src/utility/planet/biomes.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";
import { summarizeWorld } from "../src/utility/planet/worldDiagnostics.js";

const MAX_ELEVATION = 0.45;
const FIXED_SEEDS = [1, 42, 12345, 99999];
const CLIMATE_BIOMES = ["Taiga", "Grasslands", "Forest", "Desert", "Chaparral"];

const fixedWorlds = new Map();
function getFixedWorld(seed) {
	if (!fixedWorlds.has(seed)) {
		const globe = createGlobeMap({ poleToPoleCells: 80, seed });
		fixedWorlds.set(seed, { globe, summary: summarizeWorld(globe) });
	}
	return fixedWorlds.get(seed);
}

test("the world summary counts biomes, edges, and rivers of a hand-built world exactly", () => {
	// A path of cells: ocean, beach and forest carrying a river to it, then a desert beside the forest.
	const cell = (id, biome, fields) => ({
		id,
		biome,
		neighbors: [id - 1, id + 1].filter((neighborId) => neighborId >= 0 && neighborId <= 3),
		elevation: 0,
		slope: 0,
		temperature: 0.8,
		moisture: 0.5,
		distanceToWater: 0,
		flowTo: null,
		drainageBasin: null,
		hasRiver: false,
		hasTree: false,
		...fields,
	});
	const globe = {
		seed: 7,
		poleToPoleTarget: 2,
		riverThreshold: 2,
		humidityPasses: 3,
		humidityConverged: true,
		cells: [
			cell(0, "Water", { elevation: -0.2, moisture: 1 }),
			cell(1, "Beaches", { elevation: 0.02, moisture: 0.9, distanceToWater: 0.1, flowTo: 0, drainageBasin: 1, hasRiver: true }),
			cell(2, "Forest", { elevation: 0.1, moisture: 0.7, distanceToWater: 0.2, flowTo: 1, drainageBasin: 1, hasRiver: true, hasTree: true }),
			cell(3, "Desert", { elevation: 0.3, moisture: 0.2, distanceToWater: 0.3, flowTo: 2, drainageBasin: 1 }),
		],
		edges: [
			{ cellA: 0, cellB: 1 },
			{ cellA: 1, cellB: 2 },
			{ cellA: 2, cellB: 3 },
		],
	};
	const summary = summarizeWorld(globe);

	assert.equal(summary.cells, 4);
	assert.equal(summary.landShare, 0.75);
	assert.deepEqual(Object.keys(summary.biomes), BIOMES);
	assert.deepEqual(summary.biomes.Forest, { cells: 1, share: 0.25, meanElevation: 0.1, meanTemperature: 0.8, meanMoisture: 0.7 });
	assert.deepEqual(summary.biomes.Taiga, { cells: 0, share: 0, meanElevation: null, meanTemperature: null, meanMoisture: null });
	assert.deepEqual(summary.fields.elevation, { min: 0.02, mean: (0.02 + 0.1 + 0.3) / 3, max: 0.3 });
	assert.deepEqual(summary.fields.distanceToWater, { min: 0.1, mean: (0.1 + 0.2 + 0.3) / 3, max: 0.3 });
	assert.deepEqual(summary.transitions, { edges: 3, biomeBoundaryShare: 1, implausibleEdges: 1 });
	assert.deepEqual(summary.drainage, { riverThreshold: 2, riverLandShare: 2 / 3, longestRiver: 2, basins: 1 });
	assert.equal(summary.trees, 1);
	assert.deepEqual(summary.humidity, { passes: 3, converged: true });
});

test("the world summary is plain data that a seed reproduces exactly", () => {
	const summary = summarizeWorld(createGlobeMap({ poleToPoleCells: 40, seed: 12345 }));

	assert.deepEqual(summarizeWorld(createGlobeMap({ poleToPoleCells: 40, seed: 12345 })), summary);
	assert.deepEqual(JSON.parse(JSON.stringify(summary)), summary);
	assert.notDeepEqual(summarizeWorld(createGlobeMap({ poleToPoleCells: 40, seed: 12346 })), summary);
	assert.equal(Object.values(summary.biomes).reduce((sum, { cells }) => sum + cells, 0), summary.cells);
	assert.ok(Math.abs(summary.landShare + summary.biomes.Water.share - 1) < 1e-12);
});

test("fixed seeds keep every generated field in its documented range", () => {
	for (const seed of FIXED_SEEDS) {
		const { globe, summary } = getFixedWorld(seed);
		const { fields } = summary;
		const landCount = globe.cells.filter((cell) => cell.biome !== "Water").length;

		assert.ok(fields.elevation.min >= SEA_LEVEL * MAX_ELEVATION && fields.elevation.max <= MAX_ELEVATION, `seed ${seed}`);
		assert.ok(fields.slope.min >= 0 && fields.slope.max < Math.PI / 2, `seed ${seed}`);
		for (const field of ["temperature", "moisture"]) {
			assert.ok(fields[field].min >= 0 && fields[field].max <= 1, `${field}, seed ${seed}`);
		}
		assert.ok(fields.distanceToWater.min > 0 && fields.distanceToWater.max < Math.PI, `seed ${seed}`);
		assert.equal(summary.humidity.converged, true, `seed ${seed}`);
		assert.ok(summary.humidity.passes < globe.cells.length / 10, `seed ${seed}`);

		for (const cell of globe.cells) {
			assert.equal(cell.latitude, Math.asin(Math.max(-1, Math.min(1, cell.center[1]))));
			const expectedSurface =
				cell.biome === "Water" ? 0 : cell.biome === "Beaches" ? 0.025 : Math.max(cell.elevation, 0.025);
			assert.equal(cell.surfaceElevation, expectedSurface, `cell ${cell.id}`);
			if (cell.hasTree) assert.ok(cell.biome === "Forest" && !cell.hasRiver, `cell ${cell.id}`);
			if (cell.biome === "Water") continue;
			assert.ok(Number.isInteger(cell.flowAccumulation), `cell ${cell.id}`);
			assert.ok(cell.flowAccumulation >= 1 && cell.flowAccumulation <= landCount, `cell ${cell.id}`);
		}
	}
});

test("fixed seeds place every biome in its environmental range on average and per cell", () => {
	for (const seed of FIXED_SEEDS) {
		const { globe, summary } = getFixedWorld(seed);
		const { biomes } = summary;
		const landBiomes = BIOMES.filter((biome) => biome !== "Water");
		const extreme = (names, field, pick) => pick(...names.map((biome) => biomes[biome][field]));

		for (const biome of BIOMES) assert.ok(biomes[biome].share > 0.02 && biomes[biome].share < 0.45, `${biome}, seed ${seed}`);
		assert.equal(biomes.Water.meanElevation, extreme(BIOMES, "meanElevation", Math.min));
		assert.equal(biomes.Mountains.meanElevation, extreme(BIOMES, "meanElevation", Math.max));
		assert.equal(biomes.Taiga.meanTemperature, extreme(landBiomes, "meanTemperature", Math.min));
		assert.ok(biomes.Taiga.meanTemperature < COLD_TEMPERATURE, `seed ${seed}`);
		assert.equal(biomes.Desert.meanMoisture, extreme(landBiomes, "meanMoisture", Math.min));
		assert.ok(biomes.Desert.meanMoisture < ARID_MOISTURE, `seed ${seed}`);
		assert.equal(biomes.Forest.meanMoisture, extreme(CLIMATE_BIOMES, "meanMoisture", Math.max));
		assert.ok(biomes.Forest.meanMoisture >= HUMID_MOISTURE, `seed ${seed}`);
		for (const biome of ["Desert", "Chaparral"]) assert.ok(biomes[biome].meanTemperature >= WARM_TEMPERATURE, `${biome}, seed ${seed}`);

		// Mountains and Beaches come from terrain, and ecotone cells may come from any climate biome.
		for (const cell of globe.cells) {
			if (!CLIMATE_BIOMES.includes(cell.biome) || cell.biome === ECOTONE_BIOME) continue;
			assert.equal(classifyClimateBiome(cell.temperature, cell.moisture), cell.biome, `cell ${cell.id}, seed ${seed}`);
		}
	}
});

test("fixed seeds grow coherent biome regions joined only by plausible transitions", () => {
	for (const seed of FIXED_SEEDS) {
		const { globe, summary } = getFixedWorld(seed);
		// Share of edges that would join different biomes if the same biome counts were scattered at random.
		const scatteredBoundaryShare = 1 - Object.values(summary.biomes).reduce((sum, { share }) => sum + share ** 2, 0);

		assert.equal(summary.transitions.implausibleEdges, 0, `seed ${seed}`);
		assert.ok(summary.transitions.biomeBoundaryShare < 0.6 * scatteredBoundaryShare, `seed ${seed}`);
		for (const cell of globe.cells) {
			if (cell.biome !== "Beaches") continue;
			assert.ok(cell.neighbors.some((id) => globe.cells[id].biome === "Water"), `beach ${cell.id}, seed ${seed}`);
		}
	}
});

test("generation terminates with converged climate for the smallest worlds and extreme seeds", () => {
	for (const poleToPoleCells of [1, 2, 5]) {
		for (const seed of [0, 0xffffffff]) {
			const globe = createGlobeMap({ poleToPoleCells, seed });
			const summary = summarizeWorld(globe);
			const label = `${poleToPoleCells} cells, seed ${seed}`;

			assert.equal(globe.humidityConverged, true, label);
			assert.ok(globe.humidityPasses <= globe.cells.length, label);
			assert.equal(Object.values(summary.biomes).reduce((sum, { cells }) => sum + cells, 0), globe.cells.length, label);
			for (const cell of globe.cells) {
				let current = cell;
				for (let steps = 0; current.biome !== "Water" && current.flowTo !== null; steps++) {
					assert.ok(steps < globe.cells.length, `cell ${cell.id} drains, ${label}`);
					current = globe.cells[current.flowTo];
				}
			}
		}
	}
});

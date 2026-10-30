import { BIOMES, isPlausibleTransition } from "./biomes.js";

// Fields summarized over land cells; water cells hold fixed values (moisture 1, distance 0).
const LAND_FIELDS = ["elevation", "slope", "temperature", "moisture", "distanceToWater"];

function mean(values) {
	return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function describe(values) {
	if (values.length === 0) return { min: null, mean: null, max: null };
	return {
		min: values.reduce((min, value) => Math.min(min, value)),
		mean: mean(values),
		max: values.reduce((max, value) => Math.max(max, value)),
	};
}

// Length in cells of the longest river, following each river cell downstream to water (a cycle cannot loop forever).
function getLongestRiver(cells) {
	const lengths = new Map();
	const lengthFrom = (cell) => {
		const path = [];
		let current = cell;
		while (current?.hasRiver && !lengths.has(current.id) && path.length < cells.length) {
			path.push(current);
			current = current.flowTo === null ? null : cells[current.flowTo];
		}
		let length = current?.hasRiver ? lengths.get(current.id) : 0;
		for (const riverCell of path.reverse()) lengths.set(riverCell.id, ++length);
		return length;
	};
	return cells.reduce((longest, cell) => (cell.hasRiver ? Math.max(longest, lengthFrom(cell)) : longest), 0);
}

// Plain-data quality summary of a createGlobeMap world: biome distribution and terrain, climate, and drainage statistics.
export function summarizeWorld(globe) {
	const { cells } = globe;
	const land = cells.filter((cell) => cell.biome !== "Water");
	const rivers = land.filter((cell) => cell.hasRiver);

	const biomes = {};
	for (const biome of BIOMES) {
		const members = cells.filter((cell) => cell.biome === biome);
		biomes[biome] = {
			cells: members.length,
			share: members.length / cells.length,
			meanElevation: mean(members.map((cell) => cell.elevation)),
			meanTemperature: mean(members.map((cell) => cell.temperature)),
			meanMoisture: mean(members.map((cell) => cell.moisture)),
		};
	}

	const fields = {};
	for (const field of LAND_FIELDS) fields[field] = describe(land.map((cell) => cell[field]));

	let biomeBoundaryEdges = 0;
	let implausibleEdges = 0;
	for (const { cellA, cellB } of globe.edges) {
		const biomeA = cells[cellA].biome;
		const biomeB = cells[cellB].biome;
		if (biomeA !== biomeB) biomeBoundaryEdges++;
		if (!isPlausibleTransition(biomeA, biomeB)) implausibleEdges++;
	}

	return {
		seed: globe.seed,
		poleToPoleCells: globe.poleToPoleTarget,
		cells: cells.length,
		landShare: land.length / cells.length,
		biomes,
		fields,
		transitions: {
			edges: globe.edges.length,
			biomeBoundaryShare: biomeBoundaryEdges / globe.edges.length,
			implausibleEdges,
		},
		drainage: {
			riverThreshold: globe.riverThreshold,
			riverLandShare: land.length === 0 ? 0 : rivers.length / land.length,
			longestRiver: getLongestRiver(cells),
			basins: new Set(land.map((cell) => cell.drainageBasin)).size,
		},
		trees: cells.filter((cell) => cell.hasTree).length,
		humidity: { passes: globe.humidityPasses, converged: globe.humidityConverged },
	};
}

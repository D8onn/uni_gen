import { SimplexNoise } from "three/examples/jsm/Addons.js";

let biomes = {
	0: "Water",
	1: "Mountains",
	2: "Grasslands",
	3: "Forest",
	4: "Beaches",
	5: "Desert",
	6: "Taiga",
	7: "Chaparral",
};

class Hex {
	constructor(x, y, height = 1) {
		this.x = x;
		this.y = y;
		this.biome = biomes[-1];
		this.height = height;
		this.neighbors = [];
	}
	setHeight(height) {
		this.height = height;
	}
}

let validAdjacentBiomes = {
	Water: ["Beaches"],
	Beaches: ["Grasslands", "Forest"],
	Grasslands: ["Forest", "Grasslands"],
	Forest: ["Forest", "Grasslands", "Chaparral"],
	Taiga: ["Taiga", "Forest", "Chaparral"],
	Chaparral: ["Chaparral", "Forest", "Desert"],
	Mountains: ["Taiga", "Mountains"],
	Desert: ["Desert"],
};

export class MapGenerationError extends Error {
	constructor(message, diagnostics) {
		super(message);
		this.name = "MapGenerationError";
		this.diagnostics = diagnostics;
	}
}

export function createMap(
	width = 10,
	height = 10,
	landHeight = 5,
	noiseScale = 45,
	waterThreshold = 0.1,
	mountainsThreshold = 0.9,
	{ maxAttempts = 20, maxSteps = width * height * 4 } = {}
) {
	for (const [name, value] of Object.entries({ maxAttempts, maxSteps })) {
		if (!Number.isInteger(value) || value < 1) {
			throw new RangeError(`${name} must be a positive integer`);
		}
	}

	let lastFailure;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const hexagons = buildMap(
			width,
			height,
			landHeight,
			noiseScale,
			waterThreshold,
			mountainsThreshold
		);
		const result = setBiomes(hexagons, maxSteps);
		if (!result.error) {
			let changed = true;
			let smoothingPasses = 0;
			const maxSmoothingPasses = hexagons.size;
			while (changed && smoothingPasses < maxSmoothingPasses) {
				changed = modifyBiomes(hexagons);
				smoothingPasses++;
			}
			return hexagons;
		}
		lastFailure = { ...result, attempt };
	}

	const reason = lastFailure.error;
	throw new MapGenerationError(
		`Unable to generate a valid biome map after ${maxAttempts} attempts: ${reason}`,
		{ attempts: maxAttempts, maxSteps, reason }
	);
}

function modifyBiomes(hexagons) {
	var changed = false;
	hexagons.forEach((hex) => {
		var hexBiome = hex.biome;
		var neighbors = hex.neighbors;
		var neighborsBiomes = {};
		var biomes = [];
		neighbors.forEach((neighbor) => {
			if (Object.keys(neighborsBiomes).includes(neighbor.biome)) {
				neighborsBiomes[neighbor.biome]++;
			} else {
				neighborsBiomes[neighbor.biome] = 1;
				biomes.push(neighbor.biome);
			}
		});

		biomes.forEach((biome) => {
			if (neighborsBiomes[biome] > 3 && biome != hexBiome && hexBiome != "Water") {
				hex.biome = biome;
				changed = true;
			}
		});
	});

	return changed;
}

// noiseScale: how harsh the transition from each hex is in height

function buildMap(
	width = 10,
	height = 10,
	landHeight = 5,
	noiseScale = 45,
	waterThreshold = 0.1,
	mountainsThreshold = 0.9
) {
	const simplex = new SimplexNoise();
	var hexagons = new Map();

	for (var y = 0; y < height; y++) {
		for (var x = 0; x < width; x++) {
			const code = `${x},${y}`;
			const hex = new Hex(x, y);
			const nval = (simplex.noise(x / noiseScale, y / noiseScale) + 1) / 2;
			const h = Math.pow(nval * landHeight, 1.6) / 2;

			hex.setHeight(h);

			if (hex.height < landHeight * waterThreshold) {
				hex.biome = biomes[0];
			} else if (hex.height > landHeight * mountainsThreshold) {
				hex.biome = biomes[1];
			}
			hexagons.set(code, hex);
		}
	}
	return setAdjs(hexagons);
}

function setBiomes(hexagons, maxSteps) {
	let steps = 0;
	while (true) {
		const possibleBiomes = buildPossibleBiomes(hexagons);
		if (possibleBiomes.error) return { error: possibleBiomes.error, steps };
		if (possibleBiomes.size === 0) return { steps };

		if (steps >= maxSteps) {
			return { error: `step limit (${maxSteps}) reached`, steps };
		}
		const lowestEntropy = Math.min(
			...Array.from(possibleBiomes.values(), (candidates) => candidates.length)
		);
		const lowestEntropyHexes = Array.from(possibleBiomes.entries()).filter(
			([, candidates]) => candidates.length === lowestEntropy
		);
		const [hexCode, candidates] =
			lowestEntropyHexes[Math.floor(Math.random() * lowestEntropyHexes.length)];
		hexagons.get(hexCode).biome =
			candidates[Math.floor(Math.random() * candidates.length)];
		steps++;
	}
}

function buildPossibleBiomes(hexagons) {
	const possibleBiomes = new Map();
	hexagons.forEach((hex, key) => {
		if (hex.biome !== undefined) return;

		const adjacentBiomeOptions = [];
		const seenBiomes = new Set();
		hex.neighbors.forEach((neighbor) => {
			if (neighbor.biome !== undefined && !seenBiomes.has(neighbor.biome)) {
				seenBiomes.add(neighbor.biome);
				adjacentBiomeOptions.push(validAdjacentBiomes[neighbor.biome] ?? []);
			}
		});
		const candidates = adjacentBiomeOptions.length
			? biomeIntersection(adjacentBiomeOptions)
			: Object.keys(validAdjacentBiomes);
		if (candidates.length === 0) {
			possibleBiomes.error = `contradiction at cell ${key}`;
			return;
		}
		possibleBiomes.set(key, candidates);
	});
	return possibleBiomes;
}

function biomeIntersection(arrays) {
	return arrays.reduce((prev, current) =>
		prev.filter((element) => current.includes(element))
	);
}

function setAdjs(hexagons) {
	hexagons.forEach((val) => {
		val.neighbors = [
			checkPosition(val.x - 1, val.y, hexagons),
			checkPosition(val.x + 1, val.y, hexagons),
			checkPosition(val.x, val.y - 1, hexagons),
			checkPosition(val.x, val.y + 1, hexagons),
			val.y % 2 == 0
				? checkPosition(val.x - 1, val.y - 1, hexagons)
				: checkPosition(val.x + 1, val.y - 1, hexagons),
			val.y % 2 == 0
				? checkPosition(val.x - 1, val.y + 1, hexagons)
				: checkPosition(val.x + 1, val.y + 1, hexagons),
		].filter(Boolean);
	});
	return hexagons;
}

function checkPosition(x, y, hexagons) {
	return hexagons.get(`${x},${y}`);
}

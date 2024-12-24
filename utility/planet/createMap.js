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

let landHeight = 5;

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
	Forest: ["Forest", "Grasslands", "Taiga", "Chaparral"],
	Taiga: ["Taiga", "Forest", "Chaparral"],
	Chaparral: ["Chaparral", "Forest", "Desert"],
	Mountains: ["Taiga", "Mountains"],
	Desert: ["Desert"],
};

export function createMap(width = 10, height = 10) {
	var hexagons;
	var result = null;
	while (result == null) {
		hexagons = buildMap(width, height);

		result = setBiomes(hexagons);
	}
	var changed = true;
	while (changed == true) {
		changed = modifyBiomes(hexagons);
	}
	return hexagons;
}

function modifyBiomes(hexagons) {
	// TODO: implement biome modification based on height, water level, and surrounding hexes
	var changed = false;
	hexagons.forEach((hex, key) => {
		var hexBiome = hex.biome;
		var neighbors = hex.neighbors;
		var neighborsBiomes = {};
		var biomes = [];
		neighbors.forEach((neighbor) => {
			if (Object.keys(neighborsBiomes).includes(neighbor.biome)) {
				console.log("found");
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

function buildMap(width = 10, height = 10) {
	const simplex = new SimplexNoise(); // the object that gives us the perlin noise map
	const noiseScale = 45; // how harsh the transition from each hex is in height
	var hexagons = new Map();

	for (var y = 0; y < height; y++) {
		for (var x = 0; x < width; x++) {
			const code = `${x},${y}`; // the code for hex's position
			const hex = new Hex(x, y); // create a new hex object from above class
			const nval = (simplex.noise(x / noiseScale, y / noiseScale) + 1) / 2; // standardized perline noise
			const h = Math.pow(nval * landHeight, 1.6) / 2; // the perlin noise translated into height

			hex.setHeight(h);

			if (hex.height < landHeight * 0.11) {
				// water level
				hex.biome = biomes[0];
			} else if (hex.height > landHeight * 0.9) {
				// mountains level
				hex.biome = biomes[1];
			} else {
			}
			hexagons.set(code, hex);
		}
	}
	hexagons = setAdjs(hexagons);

	return hexagons;
}

function setBiomes(hexagons) {
	var possibleBiomes = buildPossibleBiomes(hexagons);

	var allowableNoChangeInterval = 10;
	// wave function collapse for hexCodes that don't have a set biome yet
	while (possibleBiomes.size > 0) {
		var prevLength = possibleBiomes.size;
		var hexCodes = [];
		for (var i = 2; i < Object.keys(biomes).length; i++) {
			hexCodes = [];
			possibleBiomes.forEach((potentialBiomes, key) => {
				if (potentialBiomes.length == i) {
					hexCodes.push(key);
				}
			});
			// we found lowest entropy
			if (hexCodes.length > 0) {
				break;
			}
		}
		if (hexCodes.length == 0) {
			return null;
		}
		// now select random hex from lowest entropy hexCodes to collapse to random biome
		var randomHexCode = hexCodes[Math.floor(Math.random() * hexCodes.length)];
		var randomHex = hexagons.get(randomHexCode);
		var randomBiome =
			possibleBiomes.get(randomHexCode)[
				Math.floor(Math.random() * possibleBiomes.get(randomHexCode).length)
			];
		// change the biome of the random hex to the random biome and
		// recalculate possible biomes for other hexes
		randomHex.biome = randomBiome;
		possibleBiomes = buildPossibleBiomes(hexagons);
		// if no biome changes, break the loop and end the process
		if (possibleBiomes.length == 0) break;

		if (prevLength == possibleBiomes.size) {
			console.log("no biome changes");
			allowableNoChangeInterval--;
		} else {
			allowableNoChangeInterval = 10;
		}
		if (allowableNoChangeInterval == 0) {
			console.log(
				"No more biomes to change with there still being undefined biomes"
			);
			break;
		}
	}
	return possibleBiomes;
}

function buildPossibleBiomes(hexagons) {
	const possibleBiomes = new Map();
	// set the possible biomes mapping
	hexagons.forEach((hex, key) => {
		if (hex.biome == undefined) {
			const adjBiomes = [];
			const seenBiomes = [];
			hex.neighbors.forEach((neighbor, ind) => {
				if (!seenBiomes.includes(neighbor.biome) && neighbor.biome != undefined) {
					seenBiomes.push(neighbor.biome);
					adjBiomes.push(validAdjacentBiomes[neighbor.biome]);
				}
			});
			// if there are neighbors with biomes such that we can get
			// possible biomes adjacent hexCodes
			if (adjBiomes.length > 0) {
				possibleBiomes.set(key, biomeIntersection(adjBiomes));
			}
			// else we set all the possible biomes to all possible biomes
			// except mountains or water
			else {
				possibleBiomes.set(key, Object.keys(validAdjacentBiomes));
			}
		}
	});

	// iterate through the possible biomes and set the hexCodes that only have 1 possible biome
	possibleBiomes.forEach((potentialBiomes, key) => {
		if (potentialBiomes.length == 1) {
			hexagons.get(key).biome = potentialBiomes[0];
		}
	});
	return possibleBiomes;
}

function biomeIntersection(arrays) {
	let commonBiomes = arrays.reduce((prev, current) =>
		prev.filter((element) => current.includes(element))
	);
	return commonBiomes;
}

function setAdjs(hexagons) {
	hexagons.forEach((val, key) => {
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
		].filter(Boolean); // filter out null values (which means no hexagon exists in that direction)
	});
	return hexagons;
}

function checkPosition(x, y, hexagons) {
	return hexagons.get(`${x},${y}`);
}

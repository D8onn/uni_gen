import * as THREE from "three";
import { SimplexNoise } from "three/examples/jsm/Addons.js";

const positions = {
	topLeft: 0,
	topRight: 1,
	middleRight: 2,
	bottomRight: 3,
	bottomLeft: 4,
	middleLeft: 5,
};

let biomes = {
	0: "Tropical",
	1: "Temperate",
	2: "Taiga",
	3: "Chaparral",
	4: "Savannas",
	5: "Temperate Grassland",
	6: "Hot Desert",
	7: "Cold Desert",
	8: "Arctic Tundra",
	9: "Alpine Tundra",
	10: "Ice Caps",
	11: "Freshwater",
	12: "Ocean",
};

let landHeight = 3;

class Hex {
	constructor(x, y, height = 1) {
		this.x = x;
		this.y = y;
		this.biome = THREE.MathUtils.randInt(0, 11);
		this.height = THREE.MathUtils.randFloat(0.5, 2);
		this.neighbors = [];
	}
	setHeight(height) {
		this.height = height;
	}
}

export function createMap(width = 10, height = 10) {
	const simplex = new SimplexNoise();
	const noiseScale = 15;
	var hexagons = new Map();

	for (var y = 0; y < height; y++) {
		for (var x = 0; x < width; x++) {
			const hex = new Hex(x, y);
			const nval = (simplex.noise(x / noiseScale, y / noiseScale) + 1) / 2;
			const h = Math.pow(nval * landHeight, 1.5) / 2;
			hex.setHeight(h);
			if (hex.height < landHeight / 8) hex.biome = 12;

			hexagons.set(`${x},${y}`, hex);
		}
	}
	hexagons = setAdjs(hexagons);

	return hexagons;
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

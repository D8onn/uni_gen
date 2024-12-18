const positions = {
	topLeft: 0,
	topRight: 1,
	middleRight: 2,
	bottomRight: 3,
	bottomLeft: 4,
	middleLeft: 5,
};

class Hex {
	constructor(x, y, height = 1) {
		this.x = x;
		this.y = y;
		this.biome = null;
		this.height = height;
		this.neighbors = [];
	}
}

export function createMap(width = 10, height = 10) {
	var hexagons = new Map();
	for (var y = 0; y < height; y++) {
		for (var x = 0; x < width; x++) {
			hexagons.set(`${x},${y}`, new Hex(x, y));
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
			checkPosition(val.x - 1, val.y - 1, hexagons),
			checkPosition(val.x + 1, val.y + 1, hexagons),
		].filter(Boolean); // filter out null values (which means no hexagon exists in that direction)
	});
	return hexagons;
}

function checkPosition(x, y, hexagons) {
	return hexagons.get(`${x},${y}`);
}

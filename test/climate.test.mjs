import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import {
	calculateClimate,
	calculateTemperature,
	getPrevailingWind,
} from "../src/utility/planet/climate.js";

const MAX_ELEVATION = 0.45;

const RING_CELLS = 64;

// A ring of cells around one line of latitude with ids increasing eastward: cells 1 to
// landElevations.length are a continent and the rest are ocean.
function createRing(landElevations, latitude = 0) {
	const polarAngle = Math.PI / 2 - latitude;
	const arc = (2 * Math.PI * Math.cos(latitude)) / RING_CELLS;
	return Array.from({ length: RING_CELLS }, (_, id) => {
		const isLand = id >= 1 && id <= landElevations.length;
		return {
			id,
			center: new Vector3().setFromSphericalCoords(1, polarAngle, (2 * Math.PI * id) / RING_CELLS),
			latitude,
			elevation: isLand ? landElevations[id - 1] : -0.1,
			biome: isLand ? "Grasslands" : "Water",
			neighbors: [(id + RING_CELLS - 1) % RING_CELLS, (id + 1) % RING_CELLS],
			distanceToWater: isLand ? Math.min(id, landElevations.length + 1 - id) * arc : 0,
		};
	});
}

function isDecreasing(values) {
	return values.every((value, index) => index === 0 || value < values[index - 1]);
}

test("temperature falls with latitude and with height above sea level", () => {
	assert.equal(calculateTemperature(0, 0, MAX_ELEVATION), 1);
	assert.ok(calculateTemperature(0, 0.2, MAX_ELEVATION) < calculateTemperature(0, 0.1, MAX_ELEVATION));
	assert.ok(calculateTemperature(0.8, 0, MAX_ELEVATION) < calculateTemperature(0.4, 0, MAX_ELEVATION));
	assert.equal(calculateTemperature(-0.6, 0.1, MAX_ELEVATION), calculateTemperature(0.6, 0.1, MAX_ELEVATION));
	assert.equal(calculateTemperature(Math.PI / 2, MAX_ELEVATION, MAX_ELEVATION), 0);

	const ring = createRing([0.05, 0.3, 0.05], 0.3);
	const { temperature } = calculateClimate(ring, { maxElevation: MAX_ELEVATION });
	assert.ok(temperature[2] < temperature[1]);
	assert.equal(temperature[1], temperature[3]);
});

test("prevailing winds follow trade, westerly, and polar bands and vanish at the poles", () => {
	// At longitude 0 (the +z axis), east is +x.
	const eastward = (latitude) =>
		getPrevailingWind(new Vector3().setFromSphericalCoords(1, Math.PI / 2 - latitude, 0)).x;

	assert.ok(eastward(0.2) < -0.99);
	assert.ok(eastward(-0.2) < -0.99);
	assert.ok(eastward(0.8) > 0.99);
	assert.ok(eastward(-0.8) > 0.99);
	assert.ok(eastward(1.2) < -0.99);
	assert.equal(getPrevailingWind(new Vector3(0, 1, 0)), null);
});

test("air dries out downwind across a flat continent, so the leeward coast is drier", () => {
	// Trade winds blow toward decreasing ids here: cell 1 is the leeward coast, the last cell the windward one.
	const ring = createRing(new Array(15).fill(0.05));
	const { humidity, moisture, humidityPasses, humidityConverged } = calculateClimate(ring, {
		maxElevation: MAX_ELEVATION,
	});
	const downwind = ring.slice(1, 16).map(({ id }) => id).reverse();

	// Air advances one cell per pass, so 15 cells settle after 15 passes and the 16th confirms it.
	assert.equal(humidityConverged, true);
	assert.equal(humidityPasses, 16);

	assert.equal(humidity[0], 1);
	assert.equal(moisture[0], 1);
	assert.ok(isDecreasing(downwind.map((id) => humidity[id])));
	assert.ok(moisture[15] > moisture[1] + 0.2);
	assert.ok(moisture[8] < moisture[15] - 0.2);
	for (const value of [...humidity, ...moisture]) assert.ok(value >= 0 && value <= 1);
});

test("westerlies carry moisture the other way", () => {
	const ring = createRing(new Array(15).fill(0.05), Math.PI / 4);
	const { humidity } = calculateClimate(ring, { maxElevation: MAX_ELEVATION });

	assert.ok(isDecreasing(ring.slice(1, 16).map(({ id }) => humidity[id])));
});

test("high ground casts a rain shadow on its lee side", () => {
	const flat = new Array(15).fill(0.05);
	// Cell 10 holds the ridge.
	const ridge = flat.map((elevation, index) => (index === 9 ? 0.35 : elevation));
	const flatClimate = calculateClimate(createRing(flat), { maxElevation: MAX_ELEVATION });
	const ridgeClimate = calculateClimate(createRing(ridge), { maxElevation: MAX_ELEVATION });

	// Air reaches cells 11 to 15 before the ridge at cell 10, so they are unchanged.
	for (const id of [11, 12, 13, 14, 15]) assert.equal(ridgeClimate.humidity[id], flatClimate.humidity[id]);
	for (const id of [9, 8, 5, 1]) assert.ok(ridgeClimate.humidity[id] < flatClimate.humidity[id] * 0.8);
});

test("climate does not depend on cell order and noise only nudges moisture", () => {
	const ring = createRing([0.05, 0.2, 0.1, 0.3, 0.05, 0.02, 0.15, 0.25, 0.05]);
	const last = ring.length - 1;
	const reversed = ring
		.slice()
		.reverse()
		.map((cell, id) => ({ ...cell, id, neighbors: cell.neighbors.map((neighborId) => last - neighborId) }));
	const climate = calculateClimate(ring, { maxElevation: MAX_ELEVATION });
	const reversedClimate = calculateClimate(reversed, { maxElevation: MAX_ELEVATION });
	for (const { id } of ring) {
		assert.ok(Math.abs(climate.humidity[id] - reversedClimate.humidity[last - id]) < 1e-9);
		assert.ok(Math.abs(climate.moisture[id] - reversedClimate.moisture[last - id]) < 1e-9);
	}

	const noisy = calculateClimate(ring, { maxElevation: MAX_ELEVATION, moistureNoise: () => -1 });
	assert.deepEqual(noisy.temperature, climate.temperature);
	assert.deepEqual(noisy.humidity, climate.humidity);
	for (const { id } of ring.slice(1, 10)) {
		assert.ok(noisy.moisture[id] < climate.moisture[id]);
		assert.ok(noisy.moisture[id] >= climate.moisture[id] - 0.25 - 1e-12);
	}
});

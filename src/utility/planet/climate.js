import { Vector3 } from "three";

// Temperature and moisture are unitless indices in [0, 1]; the model is documented in the README.
const POLAR_COOLING = 0.85;
// Cooling at maxElevation above sea level (a lapse rate).
const ELEVATION_COOLING = 0.35;
const TRADE_WIND_LATITUDE = Math.PI / 6;
const POLAR_FRONT_LATITUDE = Math.PI / 3;
// Unit-sphere radians of travel over land that rain out about 63% of the air's humidity.
const RAINFALL_DISTANCE = 0.6;
// Air keeps exp(-OROGRAPHIC_RAINFALL * climb) of its humidity when forced up `climb` render units.
const OROGRAPHIC_RAINFALL = 1;
// Unit-sphere radians from water over which the coastal moisture boost falls by about 63%.
const COASTAL_DISTANCE = 0.08;
const COASTAL_MOISTURE = 0.15;
const NOISE_MOISTURE = 0.25;
const CONVERGENCE_TOLERANCE = 1e-9;

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

// Height above sea level; water surfaces and land below sea level count as sea level.
function heightAboveSea(cell) {
	return cell.biome === "Water" ? 0 : Math.max(cell.elevation, 0);
}

export function calculateTemperature(latitude, heightAboveSeaLevel, maxElevation) {
	return clamp(
		1 -
			(Math.abs(latitude) / (Math.PI / 2)) * POLAR_COOLING -
			(heightAboveSeaLevel / maxElevation) * ELEVATION_COOLING,
		0,
		1
	);
}

// Direction the zonal prevailing wind blows toward (y is the polar axis), or null at a pole.
export function getPrevailingWind(center) {
	const east = new Vector3(0, 1, 0).cross(center);
	if (east.lengthSq() < 1e-12) return null;
	east.normalize();
	const absoluteLatitude = Math.abs(Math.asin(clamp(center.y, -1, 1)));
	const westerly =
		absoluteLatitude >= TRADE_WIND_LATITUDE && absoluteLatitude < POLAR_FRONT_LATITUDE;
	return westerly ? east : east.negate();
}

// Each land cell draws air from its upwind neighbors (all neighbors if none lie upwind).
function getHumiditySources(cells) {
	return cells.map((cell) => {
		if (cell.biome === "Water") return [];
		const wind = getPrevailingWind(cell.center);
		const links = cell.neighbors.map((neighborId) => {
			const neighbor = cells[neighborId];
			const arc = Math.acos(clamp(cell.center.dot(neighbor.center), -1, 1));
			const travel = cell.center.clone().sub(neighbor.center);
			travel.addScaledVector(cell.center, -travel.dot(cell.center)).normalize();
			const climb = Math.max(0, heightAboveSea(cell) - heightAboveSea(neighbor));
			return {
				neighborId,
				weight: wind ? Math.max(0, travel.dot(wind)) : 0,
				retention: Math.exp(-arc / RAINFALL_DISTANCE - OROGRAPHIC_RAINFALL * climb),
			};
		});
		const upwindWeight = links.reduce((sum, link) => sum + link.weight, 0);
		const useAllNeighbors = upwindWeight <= 1e-9;
		const totalWeight = useAllNeighbors ? links.length : upwindWeight;
		return links.map(({ neighborId, weight, retention }) => ({
			neighborId,
			factor: ((useAllNeighbors ? 1 : weight) / totalWeight) * retention,
		}));
	});
}

// Air over water is saturated (1); whole-grid passes repeat until stable, so cell order is irrelevant.
function calculateHumidity(cells) {
	const sources = getHumiditySources(cells);
	let humidity = cells.map((cell) => (cell.biome === "Water" ? 1 : 0));
	for (let pass = 0; pass < cells.length; pass++) {
		let largestChange = 0;
		humidity = cells.map((cell) => {
			if (cell.biome === "Water") return 1;
			const value = sources[cell.id].reduce(
				(sum, { neighborId, factor }) => sum + factor * humidity[neighborId],
				0
			);
			largestChange = Math.max(largestChange, Math.abs(value - humidity[cell.id]));
			return value;
		});
		if (largestChange < CONVERGENCE_TOLERANCE) break;
	}
	return humidity;
}

// Cells need id, center, latitude, elevation, neighbors, distanceToWater, and biome ("Water" or not).
export function calculateClimate(cells, { maxElevation, moistureNoise = () => 0 }) {
	const humidity = calculateHumidity(cells);
	const temperature = cells.map((cell) =>
		calculateTemperature(cell.latitude, heightAboveSea(cell), maxElevation)
	);
	const moisture = cells.map((cell) => {
		if (cell.biome === "Water") return 1;
		const coastal = Math.exp(-cell.distanceToWater / COASTAL_DISTANCE);
		return clamp(
			humidity[cell.id] + COASTAL_MOISTURE * coastal + NOISE_MOISTURE * moistureNoise(cell),
			0,
			1
		);
	});
	return { temperature, moisture, humidity };
}

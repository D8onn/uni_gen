import { IcosahedronGeometry, Vector3 } from "three";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js";
import { calculateClimate } from "./climate.js";
import { calculateHydrology } from "./hydrology.js";
import { createMinHeap } from "./minHeap.js";
import { createSeededRandom } from "./seededRandom.js";

const DEFAULT_RADIUS = 10;
const MAX_ELEVATION = 0.45;
const ELEVATION_OCTAVES = [
	{ frequency: 1.7, amplitude: 0.55 },
	{ frequency: 4.3, amplitude: 0.3 },
	{ frequency: 10.7, amplitude: 0.15 },
];
// Independent octaves sum to a standard deviation of sqrt(sum of amplitude^2) times that of
// one octave. Dividing by it keeps the elevation spread of a single noise sample, so the sea
// and mountain thresholds keep their meaning.
const ELEVATION_SCALE =
	1 / Math.sqrt(ELEVATION_OCTAVES.reduce((sum, { amplitude }) => sum + amplitude ** 2, 0));
const SEA_LEVEL = -MAX_ELEVATION * 0.175;
const MOUNTAIN_LEVEL = MAX_ELEVATION * 0.72;
const BEACH_LEVEL = MAX_ELEVATION * 0.15;
const BIOMES = [
	"Water",
	"Mountains",
	"Grasslands",
	"Forest",
	"Beaches",
	"Desert",
	"Taiga",
	"Chaparral",
];

function getDetailForPoleToPoleCells(cellCount) {
	const approximateCellCount = (8 * cellCount ** 2) / (Math.sqrt(3) * Math.PI);
	const frequency = Math.sqrt(Math.max(1, (approximateCellCount - 2) / 10));
	return Math.max(0, Math.round(frequency) - 1);
}

function coordinateKey(x, y, z) {
	return `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function sampleElevation(simplex, center) {
	let weightedNoise = 0;
	for (const { frequency, amplitude } of ELEVATION_OCTAVES) {
		weightedNoise +=
			simplex.noise3d(center.x * frequency, center.y * frequency, center.z * frequency) *
			amplitude;
	}
	return clamp(weightedNoise * ELEVATION_SCALE * MAX_ELEVATION, -MAX_ELEVATION, MAX_ELEVATION);
}

// Slope is the angle of the least-squares elevation plane over a cell's neighbors. Elevation
// is in the same units as the planet radius (the renderer places terrain at radius + elevation),
// so lateral distances are scaled by the radius.
function calculateSlope(cell, cells, radius) {
	const referenceAxis =
		Math.abs(cell.center.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
	const tangentX = new Vector3().crossVectors(referenceAxis, cell.center).normalize();
	const tangentY = new Vector3().crossVectors(cell.center, tangentX).normalize();
	let xx = 0;
	let xy = 0;
	let yy = 0;
	let xz = 0;
	let yz = 0;

	for (const neighborId of cell.neighbors) {
		const neighbor = cells[neighborId];
		const dot = clamp(cell.center.dot(neighbor.center), -1, 1);
		const distance = Math.acos(dot);
		const direction = neighbor.center
			.clone()
			.addScaledVector(cell.center, -dot)
			.normalize();
		const dx = radius * distance * direction.dot(tangentX);
		const dy = radius * distance * direction.dot(tangentY);
		const dz = neighbor.elevation - cell.elevation;
		xx += dx * dx;
		xy += dx * dy;
		yy += dy * dy;
		xz += dx * dz;
		yz += dy * dz;
	}

	const determinant = xx * yy - xy * xy;
	if (determinant <= Number.EPSILON) return 0;
	const gradientX = (xz * yy - yz * xy) / determinant;
	const gradientY = (yz * xx - xz * xy) / determinant;
	return Math.atan(Math.hypot(gradientX, gradientY));
}

// Shortest path along cell-center arcs to the nearest water cell, in radians on the unit
// sphere (multiply by the radius for surface distance).
function calculateDistanceToWater(cells) {
	const distances = new Float64Array(cells.length).fill(Infinity);
	const heap = createMinHeap();
	for (const cell of cells) {
		if (cell.biome !== "Water") continue;
		distances[cell.id] = 0;
		heap.push(cell.id, 0);
	}
	if (heap.size === 0) return new Array(cells.length).fill(Math.PI);

	while (heap.size > 0) {
		const { id: cellId, priority: distance } = heap.pop();
		if (distance !== distances[cellId]) continue;
		const cell = cells[cellId];
		for (const neighborId of cell.neighbors) {
			const neighbor = cells[neighborId];
			const edgeDistance = Math.acos(clamp(cell.center.dot(neighbor.center), -1, 1));
			const candidateDistance = distance + edgeDistance;
			if (candidateDistance >= distances[neighborId]) continue;
			distances[neighborId] = candidateDistance;
			heap.push(neighborId, candidateDistance);
		}
	}
	return Array.from(distances);
}

function classifyBiome(elevation, temperature, moisture) {
	if (elevation < SEA_LEVEL) return "Water";
	if (elevation > MOUNTAIN_LEVEL) return "Mountains";
	if (temperature < 0.2) return "Taiga";
	if (temperature > 0.55 && moisture < 0.27) return "Desert";
	if (moisture < 0.45) return "Chaparral";
	if (moisture > 0.62) return "Forest";
	return "Grasslands";
}

export function createGlobeMap({
	poleToPoleCells = 80,
	seed = 1,
	radius = DEFAULT_RADIUS,
} = {}) {
	if (!Number.isInteger(poleToPoleCells) || poleToPoleCells < 1) {
		throw new RangeError("poleToPoleCells must be a positive integer.");
	}
	if (!Number.isFinite(radius) || radius <= 0) {
		throw new RangeError("radius must be a positive number.");
	}
	if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new RangeError("seed must be an unsigned 32-bit integer.");
	}

	const normalizedSeed = seed >>> 0;
	const random = createSeededRandom(normalizedSeed);
	const detail = getDetailForPoleToPoleCells(poleToPoleCells);
	const icosphere = new IcosahedronGeometry(1, detail);
	const positions = icosphere.getAttribute("position");
	const centerIds = new Map();
	const centers = [];
	const neighbors = [];
	const boundaryFaceIds = [];
	const faces = [];
	const edgeFaces = new Map();

	function getCenterId(x, y, z) {
		const key = coordinateKey(x, y, z);
		let id = centerIds.get(key);
		if (id === undefined) {
			id = centers.length;
			centerIds.set(key, id);
			centers.push(new Vector3(x, y, z).normalize());
			neighbors.push(new Set());
			boundaryFaceIds.push([]);
		}
		return id;
	}

	for (let offset = 0; offset < positions.count; offset += 3) {
		const cellIds = [0, 1, 2].map((vertex) =>
			getCenterId(
				positions.getX(offset + vertex),
				positions.getY(offset + vertex),
				positions.getZ(offset + vertex)
			)
		);
		const faceId = faces.length;
		const center = centers[cellIds[0]]
			.clone()
			.add(centers[cellIds[1]])
			.add(centers[cellIds[2]])
			.normalize();
		faces.push({ center, cellIds });

		for (const id of cellIds) boundaryFaceIds[id].push(faceId);
		for (let edge = 0; edge < 3; edge++) {
			const cellA = cellIds[edge];
			const cellB = cellIds[(edge + 1) % 3];
			neighbors[cellA].add(cellB);
			neighbors[cellB].add(cellA);
			const key = cellA < cellB ? `${cellA}:${cellB}` : `${cellB}:${cellA}`;
			const entry = edgeFaces.get(key);
			if (entry) entry.faceIds.push(faceId);
			else {
				edgeFaces.set(key, {
					cellA: Math.min(cellA, cellB),
					cellB: Math.max(cellA, cellB),
					faceIds: [faceId],
				});
			}
		}
	}
	icosphere.dispose();

	const simplex = new SimplexNoise({ random });
	const cells = centers.map((center, id) => {
		const latitude = Math.asin(clamp(center.y, -1, 1));
		const elevation = sampleElevation(simplex, center);

		return {
			id,
			center,
			latitude,
			elevation,
			// Water depends only on elevation; land biomes are classified once the climate is known.
			biome: elevation < SEA_LEVEL ? "Water" : null,
			neighbors: [...neighbors[id]].sort((a, b) => a - b),
			boundaryFaceIds: [],
			surfaceElevation: 0,
		};
	});

	for (const cell of cells) cell.slope = calculateSlope(cell, cells, radius);

	const distancesToWater = calculateDistanceToWater(cells);
	for (const cell of cells) cell.distanceToWater = distancesToWater[cell.id];

	const climate = calculateClimate(cells, {
		maxElevation: MAX_ELEVATION,
		moistureNoise: ({ center }) =>
			simplex.noise3d(center.x * 6.4 + 11.3, center.y * 6.4 - 7.1, center.z * 6.4 + 3.8),
	});
	for (const cell of cells) {
		cell.temperature = climate.temperature[cell.id];
		cell.moisture = climate.moisture[cell.id];
		cell.biome = classifyBiome(cell.elevation, cell.temperature, cell.moisture);
	}

	for (const cell of cells) {
		const referenceAxis =
			Math.abs(cell.center.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
		const tangentX = new Vector3().crossVectors(referenceAxis, cell.center).normalize();
		const tangentY = new Vector3().crossVectors(cell.center, tangentX).normalize();
		cell.boundaryFaceIds = boundaryFaceIds[cell.id].sort((faceA, faceB) => {
			const pointA = faces[faceA].center;
			const pointB = faces[faceB].center;
			return (
				Math.atan2(pointA.dot(tangentY), pointA.dot(tangentX)) -
				Math.atan2(pointB.dot(tangentY), pointB.dot(tangentX))
			);
		});
	}

	const hydrology = calculateHydrology(cells);
	for (const cell of cells) {
		cell.flowTo = hydrology.flowTo[cell.id];
		cell.flowAccumulation = hydrology.flowAccumulation[cell.id];
		cell.drainageBasin = hydrology.drainageBasin[cell.id];
		cell.hasRiver = hydrology.hasRiver[cell.id];
	}

	for (const cell of cells) {
		if (
			cell.biome !== "Water" &&
			cell.temperature > 0.2 &&
			cell.elevation < BEACH_LEVEL &&
			cell.neighbors.some((neighborId) => cells[neighborId].biome === "Water")
		) {
			cell.biome = "Beaches";
		}
		cell.surfaceElevation =
			cell.biome === "Water"
				? 0
				: cell.biome === "Beaches"
					? 0.025
					: Math.max(cell.elevation, 0.025);
		const treeRoll = random();
		cell.hasTree = cell.biome === "Forest" && !cell.hasRiver && treeRoll < 0.025;
	}

	const edges = [...edgeFaces.values()].map(({ cellA, cellB, faceIds }) => ({
		cellA,
		cellB,
		faceA: faceIds[0],
		faceB: faceIds[1],
	}));
	const meanNeighborAngle =
		edges.reduce((sum, edge) => {
			const dot = cells[edge.cellA].center.dot(cells[edge.cellB].center);
			return sum + Math.acos(clamp(dot, -1, 1));
		}, 0) / edges.length;

	// The world is plain data: Three.js math stays internal and centers leave as [x, y, z].
	for (const cell of cells) cell.center = cell.center.toArray();
	for (const face of faces) face.center = face.center.toArray();

	return {
		seed: normalizedSeed,
		radius,
		riverThreshold: hydrology.riverThreshold,
		poleToPoleTarget: poleToPoleCells,
		estimatedPoleToPoleCells: Math.PI / meanNeighborAngle,
		detail,
		cells,
		faces,
		edges,
		biomes: BIOMES,
	};
}

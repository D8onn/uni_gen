import { IcosahedronGeometry, Vector3 } from "three";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js";

const MAX_ELEVATION = 0.45;
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

function classifyBiome(elevation, temperature, moisture) {
	if (elevation < SEA_LEVEL) return "Water";
	if (elevation > MOUNTAIN_LEVEL) return "Mountains";
	if (temperature < 0.2) return "Taiga";
	if (temperature > 0.55 && moisture < 0.27) return "Desert";
	if (moisture < 0.45) return "Chaparral";
	if (moisture > 0.62) return "Forest";
	return "Grasslands";
}

export function createGlobeMap({ poleToPoleCells = 80 } = {}) {
	if (!Number.isInteger(poleToPoleCells) || poleToPoleCells < 1) {
		throw new RangeError("poleToPoleCells must be a positive integer.");
	}

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

	const simplex = new SimplexNoise();
	const cells = centers.map((center, id) => {
		const latitude = Math.asin(clamp(center.y, -1, 1));
		const elevation =
			simplex.noise3d(center.x * 3.6, center.y * 3.6, center.z * 3.6) * MAX_ELEVATION;
		const moisture =
			(simplex.noise3d(
				center.x * 6.4 + 11.3,
				center.y * 6.4 - 7.1,
				center.z * 6.4 + 3.8
			) +
				1) /
			2;
		const temperature = clamp(
			1 -
				(Math.abs(latitude) / (Math.PI / 2)) * 0.85 -
				(Math.max(elevation, 0) / MAX_ELEVATION) * 0.1,
			0,
			1
		);

		return {
			id,
			center,
			latitude,
			elevation,
			temperature,
			moisture,
			biome: classifyBiome(elevation, temperature, moisture),
			neighbors: [...neighbors[id]].sort((a, b) => a - b),
			boundaryFaceIds: [],
			surfaceElevation: 0,
		};
	});

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

	return {
		poleToPoleTarget: poleToPoleCells,
		estimatedPoleToPoleCells: Math.PI / meanNeighborAngle,
		detail,
		cells,
		faces,
		edges,
		biomes: BIOMES,
	};
}

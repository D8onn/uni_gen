// Turns a generated world into plain vertex data for the renderer, without Three.js.

export const SURFACE_COLORS = new Map([
	["Water", 0x347caa],
	["Mountains", 0x9ca5aa],
	["Grasslands", 0x78ad4d],
	["Forest", 0x28663d],
	["Beaches", 0xdac78f],
	["Desert", 0xc88a4c],
	["Taiga", 0x71908b],
	["Chaparral", 0xa4a05a],
	["River", 0x5aa9d6],
]);

const EDGE_LIFT = 1.0005;
const TREE_LIFT = 0.025;

function scale([x, y, z], factor) {
	return [x * factor, y * factor, z * factor];
}

function subtract(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function getSurfaceType(cell) {
	return cell.hasRiver ? "River" : cell.biome;
}

// Returns { surfaces: [{ type, color, positions }], edgePositions, trees: [{ position, normal }] }.
export function buildPlanetMeshData(world) {
	const { radius } = world;
	// Each boundary corner sits at the mean surface elevation of the three cells meeting there.
	const facePositions = world.faces.map((face) => {
		const averageElevation =
			face.cellIds.reduce((sum, id) => sum + world.cells[id].surfaceElevation, 0) /
			face.cellIds.length;
		return scale(face.center, radius + averageElevation);
	});
	const positionsByType = new Map([...SURFACE_COLORS.keys()].map((type) => [type, []]));

	for (const cell of world.cells) {
		const type = getSurfaceType(cell);
		const positions = positionsByType.get(type);
		if (!positions) throw new Error(`No surface colour for "${type}".`);
		const center = scale(cell.center, radius + cell.surfaceElevation);
		const corners = cell.boundaryFaceIds;
		for (let index = 0; index < corners.length; index++) {
			let pointA = facePositions[corners[index]];
			let pointB = facePositions[corners[(index + 1) % corners.length]];
			const normal = cross(subtract(pointA, center), subtract(pointB, center));
			if (dot(normal, center) < 0) [pointA, pointB] = [pointB, pointA];
			positions.push(...center, ...pointA, ...pointB);
		}
	}

	const surfaces = [];
	for (const [type, positions] of positionsByType) {
		if (positions.length > 0) surfaces.push({ type, color: SURFACE_COLORS.get(type), positions });
	}

	const edgePositions = [];
	for (const edge of world.edges) {
		for (const faceId of [edge.faceA, edge.faceB]) {
			edgePositions.push(...scale(facePositions[faceId], EDGE_LIFT));
		}
	}

	const trees = world.cells
		.filter((cell) => cell.hasTree)
		.map((cell) => ({
			position: scale(cell.center, radius + cell.surfaceElevation + TREE_LIFT),
			normal: [...cell.center],
		}));

	return { surfaces, edgePositions, trees };
}

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

// A boundary corner sits at the mean surface elevation of the three cells meeting there.
function getFacePosition(world, face) {
	const averageElevation =
		face.cellIds.reduce((sum, id) => sum + world.cells[id].surfaceElevation, 0) / face.cellIds.length;
	return scale(face.center, world.radius + averageElevation);
}

function getFacePositions(world) {
	return world.faces.map((face) => getFacePosition(world, face));
}

// Appends the cell's triangles (centre, corner, next corner), each wound to face outward.
function pushCellTriangles(positions, cell, facePositions, radius) {
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

// Returns { surfaces: [{ type, color, positions }], edgePositions, trees: [{ position, normal }] }.
export function buildPlanetMeshData(world) {
	const { radius } = world;
	const facePositions = getFacePositions(world);
	const positionsByType = new Map([...SURFACE_COLORS.keys()].map((type) => [type, []]));

	for (const cell of world.cells) {
		const type = getSurfaceType(cell);
		const positions = positionsByType.get(type);
		if (!positions) throw new Error(`No surface colour for "${type}".`);
		pushCellTriangles(positions, cell, facePositions, radius);
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

// Returns every cell's triangles in cell order as { positions, cellVertexStart }: cell `id` owns vertices
// cellVertexStart[id] up to (not including) cellVertexStart[id + 1], so a cell can be recoloured in place.
export function buildCellMeshData(world) {
	const facePositions = getFacePositions(world);
	const positions = [];
	const cellVertexStart = new Uint32Array(world.cells.length + 1);
	for (const cell of world.cells) {
		pushCellTriangles(positions, cell, facePositions, world.radius);
		cellVertexStart[cell.id + 1] = positions.length / 3;
	}
	return { positions: new Float32Array(positions), cellVertexStart };
}

// Converts an sRGB channel (0-1) to the linear value three.js expects in vertex colours.
function srgbToLinear(channel) {
	return channel <= 0.04045 ? channel * 0.0773993808 : ((channel * 0.9478672986 + 0.0521327014) ** 2.4);
}

// Writes each cell's sRGB colour (`cellColors`, three floats per cell) into `target` as linear colours on all of its vertices.
export function paintCellColors(target, cellVertexStart, cellColors) {
	const cellCount = cellVertexStart.length - 1;
	if (cellColors.length !== cellCount * 3) throw new RangeError("cellColors needs three values per cell.");
	if (target.length !== cellVertexStart[cellCount] * 3) throw new RangeError("target needs three values per vertex.");
	for (let id = 0; id < cellCount; id++) {
		const red = srgbToLinear(cellColors[id * 3]);
		const green = srgbToLinear(cellColors[id * 3 + 1]);
		const blue = srgbToLinear(cellColors[id * 3 + 2]);
		for (let vertex = cellVertexStart[id] * 3; vertex < cellVertexStart[id + 1] * 3; vertex += 3) {
			target[vertex] = red;
			target[vertex + 1] = green;
			target[vertex + 2] = blue;
		}
	}
}

const OUTLINE_LIFT = 1.004;

// The cell's boundary corners in order, as flat x, y, z values just above the surface, for drawing a loop around it.
export function buildCellOutline(world, cellId) {
	const cell = world.cells[cellId];
	if (!cell) throw new RangeError(`Unknown cell id: ${cellId}.`);
	return Float32Array.from(
		cell.boundaryFaceIds.flatMap((faceId) => scale(getFacePosition(world, world.faces[faceId]), OUTLINE_LIFT))
	);
}

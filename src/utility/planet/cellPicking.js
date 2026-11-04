// Turns a click on the globe into a cell, without Three.js.

/**
 * The cell that owns a triangle of the cell mesh (see `buildCellMeshData`): a binary search of `cellVertexStart`,
 * which holds each cell's first vertex followed by the total vertex count. Triangle `n` uses vertices 3n to 3n + 2.
 */
export function getCellOfTriangle(cellVertexStart, triangle) {
	const vertex = triangle * 3;
	const cellCount = cellVertexStart.length - 1;
	if (!Number.isInteger(triangle) || triangle < 0 || vertex >= cellVertexStart[cellCount]) {
		throw new RangeError(`Triangle ${triangle} is not in the mesh.`);
	}
	let low = 0;
	let high = cellCount - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if (cellVertexStart[middle] <= vertex) low = middle;
		else high = middle - 1;
	}
	return low;
}

/**
 * Tells a click from the start of a drag (such as orbiting). `down` records where a press began; `up` returns true when
 * the same button is released within `maxMove` pixels of that spot, and false for a drag or an unmatched release.
 */
export function createClickDetector({ maxMove = 4 } = {}) {
	let start = null;
	return {
		down({ x, y, button = 0 }) {
			start = { x, y, button };
		},
		up({ x, y, button = 0 }) {
			const press = start;
			start = null;
			return press !== null && press.button === button && button === 0 && Math.hypot(x - press.x, y - press.y) <= maxMove;
		},
		cancel() {
			start = null;
		},
	};
}

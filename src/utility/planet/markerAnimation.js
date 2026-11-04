// Moves markers smoothly toward their targets as plain data, without Three.js. When the markers change, each new one
// continues the nearest old one, so a changing number of markers does not send any of them across the globe.

const chord = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function normalized([x, y, z]) {
	const length = Math.hypot(x, y, z) || 1;
	return [x / length, y / length, z / length];
}

/**
 * Pairs old markers with new ones by direction (arrays of unit vectors), nearest pairs first, each used at most once.
 * Returns `match[j]`, the old marker new marker j continues (or -1); `spawn[j]`, for an unmatched new marker the nearest old
 * one to grow from (or -1 if there are none); and `retire`, a `{ from, into }` for each unmatched old marker with the
 * nearest new one to merge into (or -1 if there are none).
 */
export function pairMarkers(from, to) {
	const pairs = [];
	from.forEach((a, i) => to.forEach((b, j) => pairs.push([chord(a, b), i, j])));
	pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
	const match = to.map(() => -1);
	const used = from.map(() => false);
	for (const [, i, j] of pairs) {
		if (match[j] !== -1 || used[i]) continue;
		match[j] = i;
		used[i] = true;
	}
	const nearestIndex = (vector, candidates) =>
		candidates.reduce((best, candidate, index) => (best === -1 || chord(vector, candidate) < chord(vector, candidates[best]) ? index : best), -1);
	const spawn = to.map((direction, j) => (match[j] === -1 ? nearestIndex(direction, from) : -1));
	const retire = [];
	from.forEach((direction, i) => !used[i] && retire.push({ from: i, into: nearestIndex(direction, to) }));
	return { match, spawn, retire };
}

/**
 * Keeps the markers on screen. `set(targets)` takes the new `{ direction, height, radius }` targets: a marker that continues an old
 * one eases from where that was, a new one grows from the nearest old marker (or in place), and an old one with no successor shrinks
 * into the nearest new marker and is dropped. `step(seconds)` eases everything and returns true if anything changed.
 * `markers` lists what to draw (at most `maxMarkers`; the oldest shrinking markers go first).
 */
export function createMarkerAnimator({ glideSeconds = 0.25, vanishRadius = 0.01, maxMarkers = 256 } = {}) {
	let markers = []; // { direction, height, radius, target, dying }

	return {
		get markers() {
			return markers;
		},
		set(targets) {
			const live = markers.filter(({ dying }) => !dying);
			const dying = markers.filter(({ dying: isDying }) => isDying);
			const { match, spawn, retire } = pairMarkers(
				live.map(({ direction }) => normalized(direction)),
				targets.map(({ direction }) => direction)
			);
			const next = targets.map((target, index) => {
				if (match[index] !== -1) {
					const marker = live[match[index]];
					marker.target = target;
					return marker;
				}
				const source = spawn[index] === -1 ? target : live[spawn[index]];
				return { direction: [...source.direction], height: source.height, radius: 0, target, dying: false };
			});
			const retiring = retire.map(({ from, into }) => {
				const marker = live[from];
				const destination = into === -1 ? marker : targets[into];
				return Object.assign(marker, { dying: true, target: { direction: destination.direction, height: destination.height, radius: 0 } });
			});
			markers = [...next, ...retiring, ...dying].slice(0, maxMarkers);
		},
		step(seconds) {
			if (seconds <= 0 || markers.length === 0) return false;
			const share = 1 - Math.exp(-seconds / glideSeconds);
			let changed = false;
			for (const marker of markers) {
				const { target } = marker;
				for (let axis = 0; axis < 3; axis++) {
					const move = (target.direction[axis] - marker.direction[axis]) * share;
					marker.direction[axis] += move;
					changed ||= Math.abs(move) > 1e-6;
				}
				const heightMove = (target.height - marker.height) * share;
				const radiusMove = (target.radius - marker.radius) * share;
				marker.height += heightMove;
				marker.radius += radiusMove;
				changed ||= Math.abs(heightMove) > 1e-5 || Math.abs(radiusMove) > 1e-5;
			}
			const before = markers.length;
			markers = markers.filter(({ dying, radius }) => !dying || radius > vanishRadius);
			return changed || markers.length !== before;
		},
	};
}

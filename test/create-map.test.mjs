import assert from "node:assert/strict";
import test from "node:test";
import {
	createMap,
	MapGenerationError,
} from "../src/utility/planet/createMap.js";
import { createSeededRandom } from "../src/utility/planet/seededRandom.js";

test("legacy map generation completes with a biome for every cell", () => {
	const map = createMap(5, 5);

	assert.equal(map.size, 25);
	for (const cell of map.values()) {
		assert.ok(cell.biome);
		assert.ok(Number.isFinite(cell.height));
	}
});

test("biome generation fails clearly when its work budget is exhausted", () => {
	// The legacy generator picks cells with Math.random, and a random pick can hit a contradiction
	// before the step limit. A fixed sequence makes this budget failure repeatable.
	const random = Math.random;
	Math.random = createSeededRandom(1);
	try {
		assert.throws(
			() => createMap(5, 5, 5, 45, 0.1, 0.9, { maxAttempts: 1, maxSteps: 1 }),
			(error) => {
				assert.ok(error instanceof MapGenerationError);
				assert.match(error.message, /after 1 attempts/);
				assert.match(error.diagnostics.reason, /step limit/);
				return true;
			}
		);
	} finally {
		Math.random = random;
	}
});

test("generation limits must be positive integers", () => {
	assert.throws(() => createMap(2, 2, 5, 45, 0.1, 0.9, { maxAttempts: 0 }), RangeError);
	assert.throws(() => createMap(2, 2, 5, 45, 0.1, 0.9, { maxSteps: 1.5 }), RangeError);
});

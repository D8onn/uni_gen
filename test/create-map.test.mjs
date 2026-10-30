import assert from "node:assert/strict";
import test from "node:test";
import {
	createMap,
	MapGenerationError,
} from "../src/utility/planet/createMap.js";

test("legacy map generation completes with a biome for every cell", () => {
	const map = createMap(5, 5);

	assert.equal(map.size, 25);
	for (const cell of map.values()) {
		assert.ok(cell.biome);
		assert.ok(Number.isFinite(cell.height));
	}
});

test("biome generation fails clearly when its work budget is exhausted", () => {
	assert.throws(
		() => createMap(5, 5, 5, 45, 0.1, 0.9, { maxAttempts: 1, maxSteps: 1 }),
		(error) => {
			assert.ok(error instanceof MapGenerationError);
			assert.match(error.message, /after 1 attempts/);
			assert.match(error.diagnostics.reason, /step limit/);
			return true;
		}
	);
});

test("generation limits must be positive integers", () => {
	assert.throws(() => createMap(2, 2, 5, 45, 0.1, 0.9, { maxAttempts: 0 }), RangeError);
	assert.throws(() => createMap(2, 2, 5, 45, 0.1, 0.9, { maxSteps: 1.5 }), RangeError);
});

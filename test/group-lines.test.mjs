import assert from "node:assert/strict";
import test from "node:test";
import { groupLines } from "../src/ui/groupLines.js";

test("the lines give the occupied and total regions and the between-region share of each trait", () => {
	const lines = groupLines({
		regions: 20,
		occupied: 7,
		divergence: { temperatureOptimum: { betweenShare: 0.3141 }, moistureOptimum: { betweenShare: 0.05 } },
	});
	assert.deepEqual(lines, ["Regions     7/20 occupied", "Divergence  T 0.31  M 0.05"]);
});

test("a share that cannot be computed, or no organisms at all, shows a dash", () => {
	assert.deepEqual(groupLines({ regions: 3, occupied: 1, divergence: { temperatureOptimum: { betweenShare: null }, moistureOptimum: { betweenShare: 0 } } }), [
		"Regions     1/3 occupied",
		"Divergence  T -  M 0.00",
	]);
	assert.deepEqual(groupLines({ regions: 3, occupied: 0, divergence: null }), ["Regions     0/3 occupied", "Divergence  T -  M -"]);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT = fileURLToPath(new URL("../scripts/tick-benchmark.mjs", import.meta.url));
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

test("the tick benchmark rejects bad arguments with one clear line and exit status 2", () => {
	const bad = [
		[["--window", "0"], "--window must be a positive integer."],
		[["--reps", "0"], "--reps must be a positive integer."],
		[["--ticks", "0"], "--ticks must be a positive integer."],
		[["--ticks", "2.5"], "--ticks must be a positive integer."],
		[["--founders"], "--founders needs a value."],
		[["--founders", "--reps", "1"], "--founders needs a value."],
		[["--founders", "10,x"], "--founders must be a comma-separated list of whole numbers, 0 or more."],
		[["--founders", "3600,"], "--founders must be a comma-separated list of whole numbers, 0 or more."],
		[["--seed", "-1"], "--seed must be an unsigned 32-bit integer."],
		[["--seed", "4294967296"], "--seed must be an unsigned 32-bit integer."],
		[["--bogus"], "Unknown option: --bogus."],
	];
	for (const [args, expected] of bad) {
		const { status, stdout, stderr } = run(args);
		const label = args.join(" ");
		assert.equal(status, 2, label);
		assert.equal(stdout, "", label);
		const lines = stderr.trimEnd().split("\n");
		assert.equal(lines[0], `tick-benchmark: ${expected}`, label);
		assert.match(lines[1], /^usage: node scripts\/tick-benchmark\.mjs /, label);
		assert.equal(lines.length, 2, label);
		assert.doesNotMatch(stderr, /RangeError|TypeError|\n\s+at /, label);
	}
});

test("the tick benchmark runs a tiny valid case", () => {
	const { status, stdout, stderr } = run(["--founders", "10,20", "--ticks", "4", "--window", "2", "--reps", "1"]);
	assert.equal(status, 0, stderr);
	const rows = stdout.trimEnd().split("\n").slice(2);
	assert.equal(rows.length, 4);
	assert.deepEqual(
		rows.map((row) => row.trim().split(/\s+/).slice(0, 3)),
		[
			["10", "0-2", "10"],
			["10", "2-4", "10"],
			["20", "0-2", "20"],
			["20", "2-4", "20"],
		]
	);
});

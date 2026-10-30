// Prints a compact world-quality summary for fixed seeds: `npm run world-summary -- [seeds...] [--cells N] [--json]`.
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";
import { summarizeWorld } from "../src/utility/planet/worldDiagnostics.js";

const DEFAULT_SEEDS = [1, 42, 12345, 99999];

function parseArguments(args) {
	const seeds = [];
	let poleToPoleCells = 80;
	let json = false;
	for (let index = 0; index < args.length; index++) {
		if (args[index] === "--json") json = true;
		else if (args[index] === "--cells") poleToPoleCells = Number(args[++index]);
		else seeds.push(Number(args[index]));
	}
	return { seeds: seeds.length > 0 ? seeds : DEFAULT_SEEDS, poleToPoleCells, json };
}

const percent = (value) => `${(value * 100).toFixed(1)}%`;
const number = (value) => (value === null ? "-" : value.toFixed(3));

function formatSummary(summary) {
	const lines = [
		`seed ${summary.seed} · ${summary.poleToPoleCells} cells pole-to-pole · ${summary.cells} cells · land ${percent(summary.landShare)}`,
		"  biome        share   elev   temp  moist",
	];
	for (const [biome, stats] of Object.entries(summary.biomes)) {
		lines.push(
			`  ${biome.padEnd(11)} ${percent(stats.share).padStart(6)} ${[stats.meanElevation, stats.meanTemperature, stats.meanMoisture].map((value) => number(value).padStart(6)).join(" ")}`
		);
	}
	lines.push("  land field        min    mean     max");
	for (const [field, stats] of Object.entries(summary.fields)) {
		lines.push(`  ${field.padEnd(15)} ${[stats.min, stats.mean, stats.max].map((value) => number(value).padStart(7)).join(" ")}`);
	}
	const { transitions, drainage, humidity } = summary;
	lines.push(
		`  biome boundaries ${percent(transitions.biomeBoundaryShare)} of ${transitions.edges} edges, ${transitions.implausibleEdges} implausible`,
		`  rivers ${percent(drainage.riverLandShare)} of land (threshold ${drainage.riverThreshold}, longest ${drainage.longestRiver} cells), ${drainage.basins} basins, ${summary.trees} trees`,
		`  humidity ${humidity.converged ? "converged" : "did not converge"} after ${humidity.passes} passes`
	);
	return lines.join("\n");
}

const { seeds, poleToPoleCells, json } = parseArguments(process.argv.slice(2));
const summaries = seeds.map((seed) => summarizeWorld(createGlobeMap({ poleToPoleCells, seed })));
console.log(json ? JSON.stringify(summaries, null, 2) : summaries.map(formatSummary).join("\n\n"));

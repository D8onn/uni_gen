// Times simulation ticks per window of ticks: `node scripts/tick-benchmark.mjs [repoRoot] [--founders 3600,15000,36000] [--seed 42] [--ticks 500] [--window 100] [--reps 5]`.
// repoRoot defaults to this checkout; pass another tree (for example a `git archive` of main) to time it with the same script.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseArguments(args) {
	const options = { root: resolve(new URL("..", import.meta.url).pathname), founders: [3600, 15000, 36000], seed: 42, ticks: 500, window: 100, reps: 5 };
	for (let index = 0; index < args.length; index++) {
		const name = args[index];
		if (name === "--founders") options.founders = args[++index].split(",").map(Number);
		else if (name === "--seed") options.seed = Number(args[++index]);
		else if (name === "--ticks") options.ticks = Number(args[++index]);
		else if (name === "--window") options.window = Number(args[++index]);
		else if (name === "--reps") options.reps = Number(args[++index]);
		else if (name.startsWith("--")) throw new RangeError(`Unknown option: ${name}.`);
		else options.root = resolve(name);
	}
	return options;
}

const options = parseArguments(process.argv.slice(2));
const load = (path) => import(pathToFileURL(resolve(options.root, "src/utility", path)).href);
const { createGlobeMap } = await load("planet/createGlobeMap.js");
const { extractSimulationInput } = await load("ecology/simulationInput.js");
const { createSimulation } = await load("ecology/simulation.js");

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const windowCount = Math.ceil(options.ticks / options.window);
const input = extractSimulationInput(createGlobeMap({ poleToPoleCells: 80, seed: options.seed }));
console.log(`root ${options.root} · seed ${options.seed} · ${options.ticks} ticks in windows of ${options.window} · median of ${options.reps} runs`);
console.log("founders  ticks      count at start  ms/tick  ticks/s");
for (const founders of options.founders) {
	// msPerTick[w][rep] and counts[w] (from the first run; runs are deterministic, so every run has the same counts).
	const msPerTick = Array.from({ length: windowCount }, () => []);
	const counts = [];
	for (let rep = 0; rep < options.reps; rep++) {
		const simulation = createSimulation();
		simulation.setWorld(input);
		simulation.configure({ seed: options.seed, founders, species: "evolving", dispersal: 0.1, speed: 10 });
		for (let windowIndex = 0; windowIndex < windowCount; windowIndex++) {
			const ticks = Math.min(options.window, options.ticks - windowIndex * options.window);
			if (rep === 0) counts.push(simulation.snapshot().summary.count);
			const start = performance.now();
			simulation.step(ticks);
			msPerTick[windowIndex].push((performance.now() - start) / ticks);
		}
	}
	msPerTick.forEach((times, windowIndex) => {
		const first = windowIndex * options.window;
		const range = `${first}-${Math.min(options.ticks, first + options.window)}`;
		const ms = median(times);
		console.log(`${String(founders).padStart(8)}  ${range.padEnd(9)}  ${String(counts[windowIndex]).padStart(14)}  ${ms.toFixed(2).padStart(7)}  ${(1000 / ms).toFixed(1).padStart(7)}`);
	});
}

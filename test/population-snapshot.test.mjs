import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createSimulation } from "../src/utility/ecology/simulation.js";
import { extractSimulationInput } from "../src/utility/ecology/simulationInput.js";
import { createGlobeMap } from "../src/utility/planet/createGlobeMap.js";

// Pinned from the e205227 tree (`git archive e205227`), never from the code under test; regenerate the same way if a Node upgrade moves Math.exp/log/cos.
const PINNED = {
	sha256: "b7202341e7a3e1ee069e95122d1a8e10e1d852d280b07d7b8e41ddf34959993c",
	births: 72234,
	deaths: { starvation: 68, oldAge: 363, mortality: 59317 },
};

// Floats are rounded to 1e-9 so the pin survives last-bit differences; integer cell arrays (counts, regions) are hashed exactly.
function quantize(value) {
	if (typeof value === "number") return Number.isNaN(value) ? "NaN" : Math.round(value * 1e9);
	if (Array.isArray(value)) return value.map(quantize);
	if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, quantize(entry)]));
	return value;
}

function snapshotFingerprint(simulation) {
	const { summary, groups, cells } = simulation.snapshot();
	const hash = createHash("sha256");
	hash.update(JSON.stringify(quantize({ summary, groups })));
	for (const [name, array] of Object.entries(cells)) {
		hash.update(name);
		const exact = array instanceof Uint32Array || array instanceof Int32Array;
		hash.update(JSON.stringify(exact ? Array.from(array) : quantize(Array.from(array))));
	}
	hash.update(JSON.stringify(quantize(simulation.inspectCell(0))));
	return hash.digest("hex");
}

test("an 80-cell seed-42 evolving run (1000 founders, dispersal 0.5) matches its pinned snapshot at tick 500", () => {
	const simulation = createSimulation();
	simulation.setWorld(extractSimulationInput(createGlobeMap({ poleToPoleCells: 80, seed: 42 })));
	simulation.configure({ seed: 42, founders: 1000, species: "evolving", dispersal: 0.5, speed: 10 });
	simulation.step(500);
	const { totals } = simulation.snapshot().summary;
	const name = "seed 42, 80 cells, 1000 evolving founders, dispersal 0.5, tick 500";
	assert.equal(totals.births, PINNED.births, `births differ for ${name}`);
	assert.deepEqual(totals.deaths, PINNED.deaths, `deaths differ for ${name}`);
	assert.equal(snapshotFingerprint(simulation), PINNED.sha256, `snapshot fingerprint differs for ${name}`);
});

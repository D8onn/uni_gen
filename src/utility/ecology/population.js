// Individual organisms of one abstract producer species that live on habitat cells; see the README.
import { createSeededRandom } from "../planet/seededRandom.js";
import { consumeResource, getCellHabitat, RESOURCES, stepHabitat } from "./habitat.js";

// Each heritable trait is the optimum of one habitat condition.
export const TRAIT_CONDITIONS = { temperatureOptimum: "temperature", moistureOptimum: "moisture" };
export const TRAITS = Object.keys(TRAIT_CONDITIONS);

// Selection and mutation are off by default, so these defaults behave exactly like the trait-free model.
export const DEFAULT_PRODUCER = {
	uptake: { water: 0.05, nutrients: 0.02 },
	growthRate: 0.2,
	maintenance: 0.05,
	maxBiomass: 1,
	reproductionBiomass: 0.6,
	offspringBiomass: 0.2,
	reproductionChance: 0.5,
	minBiomass: 0.05,
	maxAge: 400,
	mortalityChance: 0.01,
	maxPerCell: 50,
	maxOrganisms: 100000,
	founderTraits: { temperatureOptimum: 0.5, moistureOptimum: 0.5 },
	selectionStrength: 0,
	mutationRate: 0,
	mutationSize: 0.05,
	dispersalChance: 0,
};
// Species overrides that turn on selection and mutation.
export const EVOLVING_PRODUCER = {
	founderTraits: { temperatureOptimum: 0.5, moistureOptimum: 0.5 },
	selectionStrength: 2,
	mutationRate: 0.1,
	mutationSize: 0.05,
};
export const DEATH_CAUSES = ["starvation", "oldAge", "mortality"];

const FRACTION_PARAMETERS = [
	"growthRate",
	"maintenance",
	"reproductionChance",
	"mortalityChance",
	"mutationRate",
	"dispersalChance",
];
const NON_NEGATIVE_PARAMETERS = ["selectionStrength", "mutationSize"];
const COUNT_PARAMETERS = ["maxAge", "maxPerCell", "maxOrganisms"];

function resolveSpecies(overrides) {
	for (const name of Object.keys(overrides)) {
		if (!(name in DEFAULT_PRODUCER)) throw new RangeError(`Unknown species parameter: ${name}.`);
	}
	for (const resource of Object.keys(overrides.uptake ?? {})) {
		if (!RESOURCES.includes(resource)) throw new RangeError(`Unknown resource: ${resource}.`);
	}
	for (const trait of Object.keys(overrides.founderTraits ?? {})) {
		if (!TRAITS.includes(trait)) throw new RangeError(`Unknown trait: ${trait}.`);
	}
	const species = {
		...DEFAULT_PRODUCER,
		...overrides,
		uptake: { ...DEFAULT_PRODUCER.uptake, ...overrides.uptake },
		founderTraits: { ...DEFAULT_PRODUCER.founderTraits, ...overrides.founderTraits },
	};
	const require = (valid, message) => {
		if (!valid) throw new RangeError(message);
	};
	for (const [resource, value] of Object.entries(species.uptake)) {
		require(Number.isFinite(value) && value >= 0, `${resource} uptake must be a non-negative number.`);
	}
	for (const name of FRACTION_PARAMETERS) {
		const value = species[name];
		require(Number.isFinite(value) && value >= 0 && value <= 1, `${name} must be a number from 0 to 1.`);
	}
	for (const [trait, value] of Object.entries(species.founderTraits)) {
		require(Number.isFinite(value) && value >= 0 && value <= 1, `founder ${trait} must be a number from 0 to 1.`);
	}
	for (const name of NON_NEGATIVE_PARAMETERS) {
		require(Number.isFinite(species[name]) && species[name] >= 0, `${name} must be a non-negative number.`);
	}
	for (const name of COUNT_PARAMETERS) {
		require(Number.isInteger(species[name]) && species[name] >= 1, `${name} must be a positive integer.`);
	}
	const { minBiomass, offspringBiomass, reproductionBiomass, maxBiomass } = species;
	require(
		[minBiomass, offspringBiomass, reproductionBiomass, maxBiomass].every(Number.isFinite) &&
			minBiomass >= 0 &&
			minBiomass < offspringBiomass &&
			offspringBiomass + minBiomass < reproductionBiomass &&
			reproductionBiomass <= maxBiomass,
		"Biomass thresholds must satisfy 0 <= minBiomass < offspringBiomass, offspringBiomass + minBiomass < reproductionBiomass <= maxBiomass."
	);
	return species;
}

function emptyTally() {
	return { births: 0, deaths: Object.fromEntries(DEATH_CAUSES.map((cause) => [cause, 0])) };
}

function mix32(value) {
	value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
	value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
	return (value ^ (value >>> 16)) >>> 0;
}

// An organism's draws for a tick depend only on (seed, tick, id), never on processing order.
function organismRandom(seed, tick, id) {
	return createSeededRandom(mix32(mix32(mix32(seed) ^ tick) ^ id));
}

// Places `initialCount` organisms on seeded random land cells (biome other than "Water").
export function createPopulation(world, { seed = 1, initialCount = 0, species = {} } = {}) {
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new RangeError("seed must be an unsigned 32-bit integer.");
	}
	const resolved = resolveSpecies(species);
	const habitable = world.cells.map((cell) => cell.biome !== "Water");
	const landCellIds = world.cells.filter((cell) => habitable[cell.id]).map((cell) => cell.id);
	const room = Math.min(resolved.maxOrganisms, landCellIds.length * resolved.maxPerCell);
	if (!Number.isInteger(initialCount) || initialCount < 0 || initialCount > room) {
		throw new RangeError(`initialCount must be an integer from 0 to ${room}.`);
	}
	const random = createSeededRandom(seed);
	const cellCounts = new Map();
	const organisms = [];
	while (organisms.length < initialCount) {
		const cellId = landCellIds[Math.floor(random() * landCellIds.length)];
		const count = cellCounts.get(cellId) ?? 0;
		if (count >= resolved.maxPerCell) continue;
		cellCounts.set(cellId, count + 1);
		organisms.push({
			id: organisms.length,
			cellId,
			biomass: resolved.offspringBiomass,
			age: 0,
			parentId: null,
			traits: { ...resolved.founderTraits },
		});
	}
	return {
		seed,
		tick: 0,
		nextId: initialCount,
		species: resolved,
		organisms,
		lastTick: emptyTally(),
		totals: emptyTally(),
		habitable,
		dispersals: { lastTick: 0, total: 0 },
	};
}

// The share of demand a cell can meet, taken from its stocks; the limiting resource sets it for all.
function feedCell(habitat, cellId, biomass, uptake) {
	const { resources } = getCellHabitat(habitat, cellId);
	let met = 1;
	for (const resource of RESOURCES) {
		const demand = uptake[resource] * biomass;
		if (demand > 0) met = Math.min(met, resources[resource] / demand);
	}
	for (const resource of RESOURCES) {
		consumeResource(habitat, cellId, resource, met * uptake[resource] * biomass);
	}
	return met;
}

// How well an organism's traits suit a cell: 1 when every optimum matches its condition.
function habitatMatch(habitat, cellId, traits, selectionStrength) {
	let mismatch = 0;
	for (const trait of TRAITS) {
		mismatch += (habitat.conditions[TRAIT_CONDITIONS[trait]][cellId] - traits[trait]) ** 2;
	}
	return Math.exp(-selectionStrength * mismatch);
}

// Offspring copy the parent's traits; each mutates with mutationRate by a Gaussian step, clamped to 0-1.
function inheritTraits(traits, species, random) {
	const inherited = { ...traits };
	if (species.mutationRate === 0) return inherited;
	for (const trait of TRAITS) {
		if (random() >= species.mutationRate) continue;
		const gaussian = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
		inherited[trait] = Math.min(1, Math.max(0, inherited[trait] + species.mutationSize * gaussian));
	}
	return inherited;
}

// With dispersalChance, the offspring targets a uniformly chosen land neighbor (sorted by id); water is a barrier.
function offspringCell(population, habitat, cellId, random) {
	if (population.species.dispersalChance === 0 || random() >= population.species.dispersalChance) return cellId;
	const landNeighbors = habitat.neighbors[cellId].filter((id) => population.habitable[id]).sort((a, b) => a - b);
	if (landNeighbors.length === 0) return cellId;
	return landNeighbors[Math.floor(random() * landNeighbors.length)];
}

function stepOnce(population, habitat) {
	const { species, seed, tick } = population;
	const tally = emptyTally();
	const cellBiomass = new Map();
	for (const { cellId, biomass } of population.organisms) {
		cellBiomass.set(cellId, (cellBiomass.get(cellId) ?? 0) + biomass);
	}
	const satisfaction = new Map();
	for (const [cellId, biomass] of cellBiomass) {
		satisfaction.set(cellId, feedCell(habitat, cellId, biomass, species.uptake));
	}

	const survivors = [];
	const parents = [];
	for (const organism of population.organisms) {
		const light = habitat.conditions.light[organism.cellId];
		const match = habitatMatch(habitat, organism.cellId, organism.traits, species.selectionStrength);
		const growth = species.growthRate * light * satisfaction.get(organism.cellId) * match - species.maintenance;
		organism.biomass = Math.min(species.maxBiomass, organism.biomass * (1 + growth));
		organism.age += 1;
		const random = organismRandom(seed, tick, organism.id);
		const mortalityRoll = random();
		const reproductionRoll = random();
		let cause = null;
		if (organism.biomass < species.minBiomass) cause = "starvation";
		else if (organism.age >= species.maxAge) cause = "oldAge";
		else if (mortalityRoll < species.mortalityChance) cause = "mortality";
		if (cause) {
			tally.deaths[cause] += 1;
			continue;
		}
		survivors.push(organism);
		if (organism.biomass >= species.reproductionBiomass && reproductionRoll < species.reproductionChance) {
			parents.push({ parent: organism, random });
		}
	}

	// Offspring are admitted in parent-id order while the cell and global caps allow; a full target falls back to the parent's cell.
	const cellCounts = new Map();
	for (const { cellId } of survivors) cellCounts.set(cellId, (cellCounts.get(cellId) ?? 0) + 1);
	const offspring = [];
	let dispersed = 0;
	for (const { parent, random } of parents) {
		const traits = inheritTraits(parent.traits, species, random);
		let cellId = offspringCell(population, habitat, parent.cellId, random);
		if ((cellCounts.get(cellId) ?? 0) >= species.maxPerCell) cellId = parent.cellId;
		const count = cellCounts.get(cellId) ?? 0;
		if (count >= species.maxPerCell || survivors.length + offspring.length >= species.maxOrganisms) continue;
		cellCounts.set(cellId, count + 1);
		parent.biomass -= species.offspringBiomass;
		if (cellId !== parent.cellId) dispersed += 1;
		offspring.push({
			id: population.nextId++,
			cellId,
			biomass: species.offspringBiomass,
			age: 0,
			parentId: parent.id,
			traits,
		});
	}
	tally.births = offspring.length;
	population.dispersals.lastTick = dispersed;
	population.dispersals.total += dispersed;

	population.organisms = [...survivors, ...offspring];
	population.tick += 1;
	population.lastTick = tally;
	population.totals.births += tally.births;
	for (const cause of DEATH_CAUSES) population.totals.deaths[cause] += tally.deaths[cause];
	stepHabitat(habitat, 1);
}

// Each tick feeds, grows, kills, and reproduces organisms, then steps the habitat once; do not also call stepHabitat.
export function stepPopulation(population, habitat, ticks = 1) {
	if (!Number.isInteger(ticks) || ticks < 0) {
		throw new RangeError("ticks must be a non-negative integer.");
	}
	for (let tick = 0; tick < ticks; tick++) stepOnce(population, habitat);
	return population;
}

export function getPopulationSummary(population) {
	const { organisms } = population;
	return {
		tick: population.tick,
		count: organisms.length,
		totalBiomass: organisms.reduce((total, organism) => total + organism.biomass, 0),
		occupiedCells: new Set(organisms.map((organism) => organism.cellId)).size,
		lastTick: structuredClone(population.lastTick),
		totals: structuredClone(population.totals),
		traits: summarizeTraits(organisms),
		dispersals: { ...population.dispersals },
	};
}

// Mean and population standard deviation of each trait, or null for an empty population.
export function summarizeTraits(organisms) {
	if (organisms.length === 0) return null;
	return Object.fromEntries(
		TRAITS.map((trait) => {
			const mean = organisms.reduce((total, organism) => total + organism.traits[trait], 0) / organisms.length;
			const variance =
				organisms.reduce((total, organism) => total + (organism.traits[trait] - mean) ** 2, 0) / organisms.length;
			return [trait, { mean, sd: Math.sqrt(variance) }];
		})
	);
}

// Connected groups of land cells; dispersal never crosses between them. Regions are numbered by their lowest cell id.
export function getDispersalRegions(population, habitat) {
	const { habitable } = population;
	if (habitable.length !== habitat.neighbors.length) throw new RangeError("Population and habitat have different cells.");
	const regionOfCell = habitable.map(() => -1);
	let regionCount = 0;
	for (let start = 0; start < habitable.length; start++) {
		if (!habitable[start] || regionOfCell[start] !== -1) continue;
		regionOfCell[start] = regionCount;
		const stack = [start];
		while (stack.length > 0) {
			for (const neighborId of habitat.neighbors[stack.pop()]) {
				if (!habitable[neighborId] || regionOfCell[neighborId] !== -1) continue;
				regionOfCell[neighborId] = regionCount;
				stack.push(neighborId);
			}
		}
		regionCount += 1;
	}
	return { regionOfCell, regionCount };
}

// Per-group counts and traits for occupied groups (groupOfCell maps cell id to a group id), plus how trait variance splits within and between groups.
export function summarizeGroups(population, groupOfCell) {
	const members = new Map();
	for (const organism of population.organisms) {
		const group = groupOfCell[organism.cellId];
		if (!Number.isInteger(group)) throw new RangeError(`Cell ${organism.cellId} has no group.`);
		if (!members.has(group)) members.set(group, []);
		members.get(group).push(organism);
	}
	const groups = [...members.keys()]
		.sort((a, b) => a - b)
		.map((group) => {
			const organisms = members.get(group);
			return {
				group,
				count: organisms.length,
				totalBiomass: organisms.reduce((total, organism) => total + organism.biomass, 0),
				occupiedCells: new Set(organisms.map((organism) => organism.cellId)).size,
				traits: summarizeTraits(organisms),
			};
		});
	const overall = summarizeTraits(population.organisms);
	if (overall === null) return { groups, divergence: null };
	const total = population.organisms.length;
	const divergence = Object.fromEntries(
		TRAITS.map((trait) => {
			let within = 0;
			let between = 0;
			for (const { count, traits } of groups) {
				within += (count * traits[trait].sd ** 2) / total;
				between += (count * (traits[trait].mean - overall[trait].mean) ** 2) / total;
			}
			return [trait, { within, between, betweenShare: within + between > 0 ? between / (within + between) : null }];
		})
	);
	return { groups, divergence };
}

export function getCellOrganisms(population, cellId) {
	if (!Number.isInteger(cellId) || cellId < 0) throw new RangeError(`Unknown cell id: ${cellId}.`);
	return population.organisms
		.filter((organism) => organism.cellId === cellId)
		.map((organism) => ({ ...organism, traits: { ...organism.traits } }));
}

# A Procedural World Generator

## What this currently is

A web application that procedurally generates a spherical, biome-varied world from a geodesic grid of hexagonal cells, with 12 pentagonal cells closing the sphere. The initial target is 80 cells from pole to pole. The long-term goal is to encompass AI agents capable of simulating evolution.

## How to Execute

To run the generator, use the command `npx vite` to run locally.

## Checks

Run `npm test` for the spherical grid and determinism checks and `npx vite build` for a production build.

## Reproducing a World

Each launch generates a random 32-bit seed and logs it to the browser console. Add `?seed=12345` to the URL to reproduce a world with a specific seed.

## Climate Model

Each cell stores `temperature` and `moisture` (`src/utility/planet/climate.js`), derived from geography after elevation and distance to water and used to classify land biomes. Both are unitless indices from 0 (coldest, driest) to 1 (hottest, wettest), not physical units, and are reproducible from the seed.

- **Temperature** falls linearly with latitude (by 0.85 from equator to pole) and with height above sea level (by 0.35 at the highest possible elevation). There are no seasons, no ocean moderation of coastal temperatures, and no ocean currents.
- **Moisture** is mostly the humidity of the air over a cell. Prevailing winds blow along lines of latitude in three bands per hemisphere, as on Earth: easterly trade winds below 30°, westerlies from 30° to 60°, and polar easterlies above. Air over water is saturated; each land cell takes its air from its upwind neighbors, and the air rains out with distance travelled over land (63% per 0.6 radians on the unit sphere) and when forced uphill. So land far downwind of water dries out, and the lee side of high ground lies in a rain shadow. A boost near any water (fading over about 2 cells at the default resolution) and a small seeded noise term (±0.25) are added. Water cells have moisture 1.
- Simplifications: winds are purely zonal with sharp band edges and no seasonal shift, there is no evaporation from land, rivers add no moisture (inland water cells count as water), and there is no pressure, cloud, or ocean simulation.

## Ecology Model

`src/utility/ecology/habitat.js` keeps per-cell habitat conditions and resources for organisms, separate from the generated world: `createHabitat(world, rates?)` reads the world without changing it and returns plain, serializable arrays indexed by cell id. It does not use Three.js, and nothing in rendering reads it. There is no randomness, so the same world, rates, and calls give the same values.

- **Conditions** (fixed per world, unitless 0–1): `temperature` and `moisture` from the climate model, and `light`, an insolation index equal to the cosine of latitude (1 at the equator, 0 at the poles; no seasons or day/night).
- **Resources** (stocks that change, unitless): `water` and `nutrients`, each between 0 and the cell's capacity. 1 is a completely full, saturated cell. Water capacity is the cell's moisture (1 on water cells); nutrient capacity is temperature × moisture, a productivity proxy. Stocks start full.
- **Time** advances in abstract ticks with `stepHabitat(habitat, ticks = 1)`; a tick is not yet tied to a real duration. Each tick first transfers, then regenerates, each resource.
- **Spatial transfer:** stock moves between neighboring cells toward equal fill (stock ÷ capacity). Across each edge, per tick, `spread / 6 × min(capacity of both cells) × (fill difference)` flows to the less-full cell, where 6 is the largest neighbor count. The total is conserved, stocks stay between 0 and capacity, and the result does not depend on cell order. Water is planned to also flow downhill along the drainage (`flowTo`) later; that is not modeled yet.
- **Regeneration:** after transfer, each stock gains `regeneration × (capacity − stock)`, so a depleted cell recovers geometrically and never exceeds its capacity.
- **Rates** (each 0–1, configurable per resource): water `regeneration` 0.1 and `spread` 0.3; nutrients `regeneration` 0.02 and `spread` 0.05.
- **Queries and updates:** `getCellHabitat(habitat, cellId)` returns `{ conditions, capacity, resources }` for one cell; `consumeResource(habitat, cellId, resource, amount)` takes up to `amount` and returns what was actually taken. Invalid cell ids, resource names, amounts, rates, or tick counts throw a `RangeError`.

## Organism Model

`src/utility/ecology/population.js` simulates individual organisms of one abstract producer species (a "plant") on top of a habitat. Like the habitat, it is plain, serializable data with no Three.js, and nothing in rendering reads it. Organisms carry heritable traits (see Heritable Traits below); there is no dispersal yet.

- **State:** `createPopulation(world, { seed, initialCount, species? })` places `initialCount` organisms on seeded random land cells (any biome except `Water`), at most `maxPerCell` per cell. Each organism is `{ id, cellId, biomass, age, parentId, traits }`. The population also stores `seed`, `tick`, `nextId`, the resolved `species` parameters, and birth and death counts. Organisms stay sorted by id.
- **Units:** biomass is unitless (newborns have 0.2, the maximum is 1); demand and consumption use the habitat's resource units; age counts ticks.
- **Time:** `stepPopulation(population, habitat, ticks = 1)` runs whole ticks. Each tick feeds, grows, kills, and reproduces organisms, then steps the habitat once, so a population tick is one habitat tick. Do not also call `stepHabitat` on a habitat that a population is using.
- **Feeding:** each organism demands `uptake × biomass` of each resource. Per cell, the share of the total demand that the stocks can meet is set by the scarcest resource, and every organism there gets that same share (so food is split in proportion to biomass); only that share is taken from each resource.
- **Growth:** `biomass × (1 + growthRate × light × share − maintenance)`, capped at `maxBiomass`. With the defaults, an organism grows only when it gets more than a quarter of its demand in full light; at the poles, where light is near 0, it shrinks.
- **Death**, checked after growth, by first matching cause: `starvation` when biomass falls below `minBiomass`, `oldAge` when age reaches `maxAge`, otherwise `mortality` with probability `mortalityChance`.
- **Reproduction:** a survivor at or above `reproductionBiomass` reproduces with probability `reproductionChance`, moving `offspringBiomass` from itself into one new organism in the same cell. Offspring are admitted in parent-id order while the cell has fewer than `maxPerCell` and the population fewer than `maxOrganisms` organisms; a parent whose offspring is not admitted keeps its biomass.
- **Determinism:** each organism's random draws for a tick come from a generator seeded by (seed, tick, organism id), and all feeding happens before any growth, death, or birth is applied, so results do not depend on processing order or on unrelated organisms. A population and habitat restored from JSON continue identically.
- **Default parameters** (`DEFAULT_PRODUCER`): uptake water 0.05 and nutrients 0.02 per unit of biomass per tick, `growthRate` 0.2, `maintenance` 0.05, `maxBiomass` 1, `reproductionBiomass` 0.6, `offspringBiomass` 0.2, `reproductionChance` 0.5, `minBiomass` 0.05, `maxAge` 400, `mortalityChance` 0.01, `maxPerCell` 50, `maxOrganisms` 100000, plus the trait parameters below. Any can be overridden through `species`. On a fully productive cell (temperature and moisture 1), nutrients run out and the population settles after about 100 ticks to between 3 and 14 organisms (usually 7–10), well below the per-cell cap.
- **Inspection:** `getPopulationSummary(population)` returns `{ tick, count, totalBiomass, occupiedCells, lastTick, totals, traits }`, where `lastTick` and `totals` hold `births` and `deaths` by cause; `getCellOrganisms(population, cellId)` returns copies of one cell's organisms. Invalid seeds, counts, species parameters, tick counts, or cell ids throw a `RangeError`.

## Heritable Traits

Each organism carries a `traits` object of continuous, heritable values from 0 to 1. Selection is not assigned by biome: it comes only from organisms growing, surviving, and reproducing at different rates.

- **Traits** (`TRAITS`): `temperatureOptimum` and `moistureOptimum`, the temperature and moisture conditions an organism suits best. Founders all start at `founderTraits` (0.5 and 0.5); they are never matched to their cell.
- **Selection:** growth becomes `biomass × (1 + growthRate × light × share × match − maintenance)`, where `match = exp(−selectionStrength × ((temperature − temperatureOptimum)² + (moisture − moistureOptimum)²))` uses the cell's habitat conditions. A poorly matched organism grows more slowly, so it reaches `reproductionBiomass` later, loses out to better-matched organisms in the same cell (food is shared in proportion to biomass), and starves sooner. No genotype suits every climate.
- **Inheritance:** reproduction is asexual. An offspring copies its parent's traits, and each trait mutates with probability `mutationRate` by a Gaussian step with standard deviation `mutationSize`, clamped to 0–1. The parent draws these random values from its (seed, tick, id) generator after its mortality and reproduction rolls, so mutation never changes those rolls. When `mutationRate` is 0, no values are drawn.
- **Defaults are neutral:** `selectionStrength` 0 and `mutationRate` 0 (`mutationSize` 0.05), so without overrides every match is 1, traits never change, and the population behaves exactly as described in the Organism Model. Evolution is opt-in: pass `species: EVOLVING_PRODUCER` (`selectionStrength` 2, `mutationRate` 0.1, `mutationSize` 0.05, founders 0.5/0.5) or set the parameters yourself.
- **Behavior under `EVOLVING_PRODUCER`:** across 10 cells over 3000 ticks, with identical resources and temperature conditions of 0.8 versus 0.2, the mean `temperatureOptimum` moves from 0.5 to about 0.58–0.63 and 0.36–0.43. With `selectionStrength` 0, the temperature has no effect at all. Selection is strong. In the most mismatched habitat (temperature and moisture 1, match about 0.37), groups of linked cells survive, at about 2.5 organisms per cell, but an isolated cell started with only a few founders can die out (10 of 20 seeds with 2 founders over 500 ticks).
- **Inspection:** `getPopulationSummary` also returns `traits`, the mean and standard deviation (`{ mean, sd }`) of each trait, or `null` when the population is empty. `summarizeTraits(organisms)` computes the same for any list, such as one cell's `getCellOrganisms`. Invalid trait names or values, a negative or non-finite `selectionStrength` or `mutationSize`, or a `mutationRate` outside 0–1 throw a `RangeError`.

## Biome Classification

Each cell's biome (`src/utility/planet/biomes.js`) comes from its own terrain and climate, checked in this order. Elevation levels are fractions of the maximum elevation (0.45 render units); temperature and moisture are the indices above.

| Biome | Environmental range |
| --- | --- |
| Water | elevation below -0.175 |
| Mountains | elevation above 0.72 |
| Beaches | land touching water, elevation below 0.15, temperature at least 0.3 |
| Taiga | temperature below 0.3 (any moisture) |
| Forest | moisture at least 0.62 |
| Desert | temperature at least 0.55, moisture below 0.27 |
| Chaparral | temperature at least 0.55, moisture 0.27 to 0.45 |
| Grasslands | everything else: temperature 0.3 to 0.55 with moisture below 0.62, or temperature at least 0.55 with moisture 0.45 to 0.62 |

Transitions: Water, Mountains, and Beaches come from terrain and may border any biome. Two climate biomes may border each other only if their ranges touch: Taiga–Grasslands, Taiga–Forest, Grasslands–Forest, Grasslands–Desert, Grasslands–Chaparral, and Desert–Chaparral. Where a sharp climate change puts any other pair side by side (most often Chaparral next to Forest across a rain shadow or coast), both cells become Grasslands, which borders every biome, as an ecotone. This one refinement pass reads only the unrefined biomes, so it does not depend on cell order; it changes about 2% of cells at 80 cells pole-to-pole. River cells keep their biome and are drawn in their own color; every biome has a color in `planetMeshData.js`.

Simplifications: Taiga stands in for all cold land (there is no tundra or ice), and Grasslands covers both cool steppe and warm savanna.

## Assets

Tree Assets from: https://michaelsgamelab.itch.io/rpg-cabin-models

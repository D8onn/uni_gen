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

## Assets

Tree Assets from: https://michaelsgamelab.itch.io/rpg-cabin-models

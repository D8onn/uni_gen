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

## Assets

Tree Assets from: https://michaelsgamelab.itch.io/rpg-cabin-models

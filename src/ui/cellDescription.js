// Turns one cell's world data and the worker's `cell` message into the lines the inspector shows, without touching the page.
import { summarizeTraits } from "../utility/ecology/population.js";

const number = (value, digits = 2) => value.toFixed(digits);
const stock = (amount, capacity) => `${number(amount)} of ${number(capacity)}`;

/**
 * `cell` is the world's cell (biome, elevation, river, neighbors) and `data` the worker's `cell` message
 * (`conditions`, `capacity`, `resources`, `organisms`, `tick`), or null before it arrives.
 * Returns `{ title, rows: [[label, value]], organisms }`; `organisms` is null without data, otherwise
 * `{ count, traits, list }` with the mean and standard deviation of each trait (null when the cell is empty).
 */
export function describeCell(cell, data) {
	const rows = [
		["Elevation", number(cell.elevation)],
		["River", cell.hasRiver ? "yes" : "no"],
		["Neighbors", `${cell.neighbors.length}${cell.neighbors.length === 5 ? " (pentagon)" : ""}`],
	];
	if (data !== null) {
		const { conditions, capacity, resources } = data;
		rows.push(
			["Temperature", number(conditions.temperature)],
			["Moisture", number(conditions.moisture)],
			["Light", number(conditions.light)],
			["Water", stock(resources.water, capacity.water)],
			["Nutrients", stock(resources.nutrients, capacity.nutrients)],
			["Tick", String(data.tick)]
		);
	}
	return {
		title: `Cell ${cell.id}: ${cell.biome}`,
		rows,
		organisms:
			data === null
				? null
				: {
						count: data.organisms.length,
						traits: summarizeTraits(data.organisms),
						list: data.organisms.map(({ id, age, biomass, traits }) => ({ id, age, biomass, ...traits })),
					},
	};
}

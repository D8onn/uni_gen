// The slice of a world the simulation reads, as plain data that can be posted to the worker.

/**
 * Extracts what habitat and population need from a generated world: its seed plus per-cell
 * `biome`, `latitude`, `temperature`, `moisture`, and `neighbors`, indexed by cell id.
 */
export function extractSimulationInput(world) {
	const { cells } = world;
	cells.forEach((cell, index) => {
		if (cell.id !== index) throw new RangeError(`Cell ${index} has id ${cell.id}; ids must match positions.`);
	});
	return {
		seed: world.seed,
		biome: cells.map((cell) => cell.biome),
		latitude: Float64Array.from(cells, (cell) => cell.latitude),
		temperature: Float64Array.from(cells, (cell) => cell.temperature),
		moisture: Float64Array.from(cells, (cell) => cell.moisture),
		neighbors: cells.map((cell) => [...cell.neighbors]),
	};
}

// Validates a posted input and rebuilds the `{ seed, cells }` world shape that habitat and population read.
export function worldFromSimulationInput(input) {
	const { seed, biome, latitude, temperature, moisture, neighbors } = input ?? {};
	if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new RangeError("The world's seed must be an unsigned 32-bit integer.");
	}
	if (!Array.isArray(biome) || biome.length === 0) throw new RangeError("The world must have at least one cell.");
	const count = biome.length;
	for (const [name, values] of Object.entries({ latitude, temperature, moisture, neighbors })) {
		if (values?.length !== count) throw new RangeError(`The world's ${name} must have one entry per cell.`);
	}
	const cells = biome.map((cellBiome, id) => {
		const cellNeighbors = neighbors[id];
		if (!Array.isArray(cellNeighbors) || cellNeighbors.some((other) => !Number.isInteger(other) || other < 0 || other >= count)) {
			throw new RangeError(`Cell ${id} has an invalid neighbor list.`);
		}
		return {
			id,
			biome: cellBiome,
			latitude: latitude[id],
			temperature: temperature[id],
			moisture: moisture[id],
			neighbors: [...cellNeighbors],
		};
	});
	return { seed, cells };
}

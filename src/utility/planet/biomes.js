// Biome ranges are documented in the README "Biome Classification" section.
export const BIOMES = [
	"Water",
	"Mountains",
	"Grasslands",
	"Forest",
	"Beaches",
	"Desert",
	"Taiga",
	"Chaparral",
];

// Elevation levels as fractions of the maximum elevation.
export const SEA_LEVEL = -0.175;
export const BEACH_LEVEL = 0.15;
export const MOUNTAIN_LEVEL = 0.72;
export const COLD_TEMPERATURE = 0.3;
export const WARM_TEMPERATURE = 0.55;
export const ARID_MOISTURE = 0.27;
export const SEMIARID_MOISTURE = 0.45;
export const HUMID_MOISTURE = 0.62;

// Water, Mountains, and Beaches come from terrain alone and may border any biome.
const TERRAIN_BIOMES = new Set(["Water", "Mountains", "Beaches"]);

// Climate biomes whose temperature-moisture ranges touch; any other pair needs a jump in climate.
const CLIMATE_TRANSITIONS = [
	["Taiga", "Grasslands"],
	["Taiga", "Forest"],
	["Grasslands", "Forest"],
	["Grasslands", "Desert"],
	["Grasslands", "Chaparral"],
	["Desert", "Chaparral"],
];

export const ECOTONE_BIOME = "Grasslands";

export function isPlausibleTransition(biomeA, biomeB) {
	if (biomeA === biomeB || TERRAIN_BIOMES.has(biomeA) || TERRAIN_BIOMES.has(biomeB)) return true;
	return CLIMATE_TRANSITIONS.some(
		([first, second]) =>
			(first === biomeA && second === biomeB) || (first === biomeB && second === biomeA)
	);
}

export function classifyClimateBiome(temperature, moisture) {
	if (temperature < COLD_TEMPERATURE) return "Taiga";
	if (moisture >= HUMID_MOISTURE) return "Forest";
	if (temperature >= WARM_TEMPERATURE && moisture < ARID_MOISTURE) return "Desert";
	if (temperature >= WARM_TEMPERATURE && moisture < SEMIARID_MOISTURE) return "Chaparral";
	return "Grasslands";
}

// `coastal` is true for land touching water; elevation is in the same units as maxElevation.
export function classifyBiome({ elevation, temperature, moisture, coastal }, maxElevation) {
	if (elevation < SEA_LEVEL * maxElevation) return "Water";
	if (elevation > MOUNTAIN_LEVEL * maxElevation) return "Mountains";
	if (coastal && elevation < BEACH_LEVEL * maxElevation && temperature >= COLD_TEMPERATURE) {
		return "Beaches";
	}
	return classifyClimateBiome(temperature, moisture);
}

// Cells with an implausible neighbor become the ecotone, which borders every biome; one pass over unrefined biomes is order-independent.
export function refineBiomes(cells) {
	return cells.map((cell) =>
		cell.neighbors.every((id) => isPlausibleTransition(cell.biome, cells[id].biome))
			? cell.biome
			: ECOTONE_BIOME
	);
}

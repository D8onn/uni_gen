// The panel's lines about dispersal regions, without touching the page.

// What the Divergence line means, for the panel's help.
export const DIVERGENCE_HELP =
	"T and M are the share of the temperature and moisture optimum's variance that lies between dispersal regions rather than within them. 0 means all the variation is within regions (the regions look alike); towards 1 the regions have diverged. A dash means there is nothing to compare yet.";

const share = (trait) => (trait?.betweenShare == null ? "-" : trait.betweenShare.toFixed(2));

/**
 * `groups` is a snapshot's `{ regions, occupied, divergence }`. Returns the lines for how many regions hold organisms and
 * the share of each trait's variance that lies between regions, for the temperature (T) and moisture (M) optimum (0 when
 * regions look alike, towards 1 as they diverge; "-" when there is nothing to compare).
 */
export function groupLines({ regions, occupied, divergence }) {
	return [
		`Regions     ${occupied}/${regions} occupied`,
		`Divergence  T ${share(divergence?.temperatureOptimum)}  M ${share(divergence?.moistureOptimum)}`,
	];
}

// Applies the selected cell view to the globe and keeps the live views current as snapshots arrive.
import { createHabitat } from "../utility/ecology/habitat.js";
import { CELL_VIEWS, computeCellColors, getViewLegend, isLiveView } from "../utility/planet/cellViews.js";

/**
 * `planet` is what `createPlanet` returns and `client` the simulation client. `select(viewId)` switches
 * the view and returns its legend (null for the biome view); trees show only in the biome view.
 */
export function createViewController({ planet, client }) {
	const { conditions } = createHabitat(planet.world);
	let viewId = "biome";
	let cells = null;

	function apply() {
		if (isLiveView(viewId) && cells === null) return; // keep the current colours until the first snapshot
		planet.setCellColors(computeCellColors(viewId, { world: planet.world, conditions, cells }));
		planet.setTreesVisible(viewId === "biome");
	}

	client.subscribe((message) => {
		if (message.type !== "snapshot") return;
		cells = message.cells;
		if (isLiveView(viewId)) apply();
	});

	return {
		list: CELL_VIEWS,
		select(id) {
			const legend = getViewLegend(id);
			viewId = id;
			apply();
			return legend;
		},
	};
}

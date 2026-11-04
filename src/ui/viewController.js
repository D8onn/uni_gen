// Applies the selected cell view to the globe and keeps the live views and the organism markers current as snapshots arrive.
import { createHabitat } from "../utility/ecology/habitat.js";
import { CELL_VIEWS, computeCellColors, getViewLegend, isLiveView } from "../utility/planet/cellViews.js";
import { getMarkerUnit, placeMarkers, SMALL_UNIT } from "../utility/planet/populationMarkers.js";

/**
 * `planet` is what `createPlanet` returns and `client` the simulation client. `select(viewId)` switches
 * the view and returns its legend (null for the biome view); trees show only in the biome view.
 * Markers (one per group of organisms, see `placeMarkers`) follow every snapshot; `setMarkersVisible` shows or hides them,
 * and `onMarkers(listener)` reports `{ unit, shown, organisms }` after each update (and at once if there is one).
 */
export function createViewController({ planet, client }) {
	const { conditions } = createHabitat(planet.world);
	let viewId = "biome";
	let snapshot = null;
	let unit = SMALL_UNIT;
	let markerInfo = null;
	const markerListeners = new Set();

	function apply() {
		if (isLiveView(viewId) && snapshot === null) return; // keep the current colours until the first snapshot
		planet.setCellColors(
			computeCellColors(viewId, { world: planet.world, conditions, cells: snapshot?.cells, maxPerCell: snapshot?.maxPerCell })
		);
		planet.setTreesVisible(viewId === "biome");
	}

	function updateMarkers() {
		const organisms = snapshot.summary.count;
		unit = getMarkerUnit(organisms, unit);
		const markers = placeMarkers(planet.world, snapshot.cells.count, unit);
		planet.setMarkers(markers, unit);
		markerInfo = { unit, shown: markers.length, organisms };
		for (const listener of markerListeners) listener(markerInfo);
	}

	client.subscribe((message) => {
		if (message.type !== "snapshot") return;
		snapshot = message;
		updateMarkers();
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
		setMarkersVisible: (visible) => planet.setMarkersVisible(visible),
		onMarkers(listener) {
			markerListeners.add(listener);
			if (markerInfo !== null) listener(markerInfo);
		},
	};
}

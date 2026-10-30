import * as THREE from "three";
import WebGL from "three/addons/capabilities/WebGL.js";
import { createSimulationPanel } from "./ui/simulationPanel.js";
import { createPlanet } from "./utility/";
import { createSimulationClient } from "./utility/ecology/simulationClient.js";
import { parseSimulationParams } from "./utility/ecology/simulationParams.js";

THREE.DefaultLoadingManager.onStart = function (url, itemsLoaded, itemsTotal) {
	console.log(
		"Started loading file: " +
			url +
			".\nLoaded " +
			itemsLoaded +
			" of " +
			itemsTotal +
			" files."
	);
};

THREE.DefaultLoadingManager.onLoad = function () {
	console.log("Loading Complete!");
	document.getElementById("loading").classList.add("fade-out");
	setTimeout(() => {
		document.getElementById("loading").remove();
	}, 1100);
};

THREE.DefaultLoadingManager.onProgress = function (url, itemsLoaded, itemsTotal) {
	console.log(
		"Loading file: " +
			url +
			".\nLoaded " +
			itemsLoaded +
			" of " +
			itemsTotal +
			" files."
	);
};

THREE.DefaultLoadingManager.onError = function (url) {
	console.log("There was an error loading " + url);
};

async function createWorldFromUrl() {
	const params = parseSimulationParams(window.location.search);
	const client = createSimulationClient();
	client.configure(params);
	const world = await createPlanet({ poleToPoleCells: 80, seed: params.seed });
	createSimulationPanel({ client, params });
	return world;
}

if (!WebGL.isWebGL2Available()) {
	document.getElementById("container").appendChild(WebGL.getWebGL2ErrorMessage());
} else {
	createWorldFromUrl().catch((error) => {
		console.error("Unable to generate world:", error);
		document.getElementById("loading").textContent =
			`Unable to generate world: ${error.message}`;
	});
}

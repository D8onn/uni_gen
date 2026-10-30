import * as THREE from "three";
import WebGL from "three/addons/capabilities/WebGL.js";
import { createPlanet } from "./utility/";

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
	const worldOptions = { poleToPoleCells: 80 };
	const seed = new URLSearchParams(window.location.search).get("seed");
	if (seed !== null) {
		if (seed.trim() === "") {
			throw new RangeError("seed must be a non-empty unsigned 32-bit integer.");
		}
		worldOptions.seed = Number(seed);
	}
	return createPlanet(worldOptions);
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

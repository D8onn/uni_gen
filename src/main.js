import * as THREE from "three";
import WebGL from "three/addons/capabilities/WebGL.js";
import { createUni, createPlanet } from "./utility/";

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

if (!WebGL.isWebGL2Available()) {
	document.getElementById("container").appendChild(WebGL.getWebGL2ErrorMessage());
} else {
	// use the utility functions to create the planet
	const width = 60;
	const height = 60;
	const radius = 0.5;
	const landHeight = 5;
	const noiseScale = 60;
	const waterThreshold = 0.1;
	const mountainsThreshold = 0.95;
	createPlanet(
		width,
		height,
		landHeight,
		radius,
		noiseScale,
		waterThreshold,
		mountainsThreshold
	);
}

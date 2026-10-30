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

if (!WebGL.isWebGL2Available()) {
	document.getElementById("container").appendChild(WebGL.getWebGL2ErrorMessage());
} else {
	createPlanet({ poleToPoleCells: 80 });
}

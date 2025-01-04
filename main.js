import * as THREE from "three";
import WebGL from "three/addons/capabilities/WebGL.js";
import { createUni, createPlanet } from "./utility/";

let camera, renderer, scene;

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
	createPlanet();
}

function init() {
	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera(
		75,
		window.innerWidth / window.innerHeight,
		0.1,
		1000
	);
	renderer = createRenderer();

	scene.background = new THREE.Color(0x606968);
	createAxis();

	window.addEventListener("resize", onWindowResize);
}

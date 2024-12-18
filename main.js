import * as THREE from "three";
import WebGL from "three/addons/capabilities/WebGL.js";
import { OrbitControls } from "three/examples/jsm/Addons.js";
import { createUni, createPlanet } from "./utility/";

let camera, renderer, scene;

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

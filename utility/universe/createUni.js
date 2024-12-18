import * as THREE from "three";
import { createHexagonEdges } from "./createHex.js";
import {
	createAxis,
	createControls,
	createRenderer,
	onWindowResize,
} from "../sceneHelpers.js";
import { OrbitControls } from "three/examples/jsm/Addons.js";

let scene, renderer, camera;
export function createUni() {
	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera(
		75,
		window.innerWidth / window.innerHeight,
		0.1,
		1000
	);
	renderer = createRenderer();

	scene.background = new THREE.Color(0x606968);
	createAxis(scene);

	window.addEventListener("resize", onWindowResize(camera, renderer));

	// initial camera position
	camera.position.set(20, 2, 0);
	const controls = createControls(camera, renderer);

	const detail = 20;
	const radius = 10;

	// create hex from sphere geometry
	const [sphere] = createHexagonEdges(radius, detail);
	// scene.add(wireframe);
	scene.add(sphere);

	renderer.setAnimationLoop(animate);

	function animate() {
		controls.update();
		renderer.render(scene, camera);

		// sphere.rotation.x += 0.001;
		// sphere.rotation.y -= 0.001;
	}
}

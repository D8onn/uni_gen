import * as THREE from "three";
import { createMap } from "./createMap";
import {
	createAxis,
	createControls,
	createRenderer,
	onWindowResize,
} from "../sceneHelpers.js";

let biomes = {
	0: "hot",
	1: "arid",
	2: "temperate",
	3: "tropical",
	4: "polar",
};

let scene, camera, renderer;

let colors = new Map();

colors.set("hot", new THREE.MeshBasicMaterial({ color: 0x7d332c }));
colors.set("arid", new THREE.MeshBasicMaterial({ color: 0xfe5402 }));
colors.set("temperate", new THREE.MeshBasicMaterial({ color: 0x2bd066 }));
colors.set("tropical", new THREE.MeshBasicMaterial({ color: 0x60bad2 }));
colors.set("polar", new THREE.MeshBasicMaterial({ color: 0x5c508d }));

export function createPlanet() {
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

	///////////////////////////////////////////////////
	// This is where creating the planet map is done //
	var planetMap = createMap(10, 4);
	const radius = 1;
	const group = new THREE.Group();
	planetMap.forEach((val, key) => {
		const geometry = new THREE.CylinderGeometry(radius, radius, val.height, 6);

		const material = colors.get(biomes[THREE.MathUtils.randInt(0, 4)]);
		const cylinder = new THREE.Mesh(geometry, material);
		cylinder.position.set(...findPosition(val, radius));
		group.add(cylinder);

		// const wireframe = new THREE.LineSegments(geometry);
		// wireframe.material = new THREE.MeshBasicMaterial({ color: 0x000000 });
		// wireframe.material.opacity = 0.75;
		// wireframe.material.transparent = true;
		// wireframe.position.set(...findPosition(val, radius));
		// group.add(wireframe);
	});
	scene.add(group);

	///////////////////////////////////////////////////

	renderer.setAnimationLoop(animate);

	function animate() {
		controls.update();
		renderer.render(scene, camera);
	}
	var map = createMap();
}

function findPosition(val, radius) {
	var diameter = radius * 2;
	var x =
		val.y % 2 == 0
			? val.x * diameter * Math.cos(THREE.MathUtils.degToRad(30))
			: val.x * diameter * Math.cos(THREE.MathUtils.degToRad(30)) +
			  Math.cos(THREE.MathUtils.degToRad(30));
	var z = val.height / 2;
	var y =
		val.y % 2 == 0
			? val.y * radius + val.y * Math.sin(THREE.MathUtils.degToRad(30))
			: val.y * radius + val.y * Math.sin(THREE.MathUtils.degToRad(30));
	return [x, z, y];
}

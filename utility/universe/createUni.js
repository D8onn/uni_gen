import * as THREE from "three";
import { createHexagonEdges } from "./";
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
	createAxis();

	window.addEventListener("resize", onWindowResize);

	const detail = 20;
	const radius = 10;

	// create hex from sphere geometry
	const [sphere] = createHexagonEdges(radius, detail);
	// scene.add(wireframe);
	scene.add(sphere);

	// initial camera position
	camera.position.set(20, 2, 0);
	const controls = createControls();

	renderer.setAnimationLoop(animate);

	function animate() {
		controls.update();
		renderer.render(scene, camera);

		// sphere.rotation.x += 0.001;
		// sphere.rotation.y -= 0.001;
	}
}

function createRenderer() {
	const renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	document.body.appendChild(renderer.domElement);
	return renderer;
}

function createControls() {
	// OrbitControls for moving camera around
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.enableZoom = true;
	controls.enablePan = true;
	controls.dampingFactor = 0.05;
	controls.minDistance = 1;
	controls.maxDistance = 50;

	return controls;
}

function createAxis() {
	const axesHelper = new THREE.AxesHelper(50);
	scene.add(axesHelper);
	const gridHelper = new THREE.GridHelper(50, 50);
	scene.add(gridHelper);
	const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });

	for (let i = 0; i <= 50; i++) {
		const marker = new THREE.SphereGeometry(0.1);
		var obj = new THREE.Mesh(marker, markerMaterial);
		obj.position.set(i, 0, 0);
		scene.add(obj);
		obj = new THREE.Mesh(marker, markerMaterial);

		obj.position.set(0, i, 0);
		scene.add(obj);
		obj = new THREE.Mesh(marker, markerMaterial);

		obj.position.set(0, 0, i);
		scene.add(obj);
	}
}

function onWindowResize() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
}

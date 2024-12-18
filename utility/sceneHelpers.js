import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/Addons.js";
export function createRenderer() {
	const renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	document.body.appendChild(renderer.domElement);
	return renderer;
}

export function createControls(camera, renderer) {
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

export function createAxis(scene) {
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

export function onWindowResize(camera, renderer) {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
}

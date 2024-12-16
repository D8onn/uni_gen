import * as THREE from "three";
import WebGL from "three/addons/capabilities/WebGL.js";
if (!WebGL.isWebGL2Available()) {
	document
		.getElementById("container")
		.appendChild(WebGL.getWebGL2ErrorMessage());
} else {
	init();
}

function init() {
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x606968);

	const camera = new THREE.PerspectiveCamera(
		75,
		window.innerWidth / window.innerHeight,
		0.1,
		1000
	);

	const renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	document.body.appendChild(renderer.domElement);

	const colors = [];

	const geometry = new THREE.SphereGeometry(8, 80, 80);
	const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });

	// create sphere
	const sphere = new THREE.Mesh(geometry, material);
	scene.add(sphere);

	// create edge lines for sphere
	const edges = new THREE.EdgesGeometry(geometry);
	const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
	const edgeLines = new THREE.LineSegments(edges, edgeMaterial);
	scene.add(edgeLines);

	camera.position.z = 20;

	renderer.setAnimationLoop(animate);

	function animate() {
		renderer.render(scene, camera);
		sphere.rotation.x += 0.001;
		sphere.rotation.y -= 0.001;
		edgeLines.rotation.x += 0.001;
		edgeLines.rotation.y -= 0.001;
	}
}

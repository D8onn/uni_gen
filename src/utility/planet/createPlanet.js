import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createControls, createRenderer } from "../sceneHelpers.js";
import { createGlobeMap } from "./createGlobeMap.js";
import { addLighting } from "./lighting.js";
import { buildPlanetMeshData } from "./planetMeshData.js";
import { createRandomSeed } from "./seededRandom.js";

const up = new THREE.Vector3(0, 1, 0);

export async function createPlanet({
	poleToPoleCells = 80,
	radius = 10,
	seed = createRandomSeed(),
} = {}) {
	const globe = createGlobeMap({ poleToPoleCells, seed, radius });
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(
		50,
		window.innerWidth / window.innerHeight,
		radius * 0.01,
		radius * 20
	);
	const renderer = createRenderer();

	scene.background = new THREE.Color(0x07111a);
	window.addEventListener("resize", () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	});

	const controls = createControls(camera, renderer);
	controls.enablePan = false;
	controls.minDistance = radius * 1.15;
	controls.maxDistance = radius * 8;
	camera.position.set(0, radius * 1.6, radius * 3.2);

	const gltf = await new GLTFLoader().loadAsync("/models/tree.glb");
	gltf.scene.traverse((object) => {
		if (!object.isMesh) return;
		const toLambert = (material) =>
			new THREE.MeshLambertMaterial({
				color: material.color,
				map: material.map,
				alphaMap: material.alphaMap,
				transparent: material.transparent,
				alphaTest: material.alphaTest,
				side: material.side,
			});
		object.material = Array.isArray(object.material)
			? object.material.map(toLambert)
			: toLambert(object.material);
	});
	gltf.scene.scale.set(0.1, 0.16, 0.1);
	const meshData = buildPlanetMeshData(globe);
	addGlobeSurface(scene, meshData);
	addTrees(scene, meshData, gltf.scene);

	addLighting(scene, camera);

	renderer.setAnimationLoop(() => {
		controls.update();
		renderer.render(scene, camera);
	});

	console.info(
		`World seed: ${globe.seed}. Generated ${globe.cells.length} spherical cells (${globe.estimatedPoleToPoleCells.toFixed(1)} cells pole-to-pole; 12 pentagons).`
	);
	return {
		seed: globe.seed,
		cellCount: globe.cells.length,
		estimatedPoleToPoleCells: globe.estimatedPoleToPoleCells,
	};
}

function addGlobeSurface(scene, meshData) {
	for (const { color, positions } of meshData.surfaces) {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
		geometry.computeVertexNormals();
		const material = new THREE.MeshLambertMaterial({ color });
		const mesh = new THREE.Mesh(geometry, material);
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		scene.add(mesh);
	}

	const edgeGeometry = new THREE.BufferGeometry();
	edgeGeometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(meshData.edgePositions, 3)
	);
	const edges = new THREE.LineSegments(
		edgeGeometry,
		new THREE.LineBasicMaterial({ color: 0x142019, transparent: true, opacity: 0.55 })
	);
	edges.renderOrder = 1;
	scene.add(edges);
}

function addTrees(scene, meshData, treeModel) {
	for (const { position, normal } of meshData.trees) {
		const tree = treeModel.clone(true);
		tree.position.fromArray(position);
		tree.quaternion.setFromUnitVectors(up, new THREE.Vector3().fromArray(normal));
		scene.add(tree);
	}
}

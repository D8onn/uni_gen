import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createControls, createRenderer } from "../sceneHelpers.js";
import { computeCellColors } from "./cellViews.js";
import { createGlobeMap } from "./createGlobeMap.js";
import { addLighting } from "./lighting.js";
import { buildCellMeshData, buildPlanetMeshData, paintCellColors } from "./planetMeshData.js";
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
	const surface = addGlobeSurface(scene, buildCellMeshData(globe), meshData.edgePositions);
	const trees = addTrees(scene, meshData, gltf.scene);
	surface.setCellColors(computeCellColors("biome", { world: globe }));

	addLighting(scene, camera);

	renderer.setAnimationLoop(() => {
		controls.update();
		renderer.render(scene, camera);
	});

	console.info(
		`World seed: ${globe.seed}. Generated ${globe.cells.length} spherical cells (${globe.estimatedPoleToPoleCells.toFixed(1)} cells pole-to-pole; 12 pentagons).`
	);
	return {
		world: globe,
		seed: globe.seed,
		cellCount: globe.cells.length,
		estimatedPoleToPoleCells: globe.estimatedPoleToPoleCells,
		// Colours each cell from three sRGB floats per cell id (see `computeCellColors`).
		setCellColors: surface.setCellColors,
		setTreesVisible: (visible) => (trees.visible = visible),
	};
}

function addGlobeSurface(scene, { positions, cellVertexStart }, edgePositions) {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	const colors = new THREE.BufferAttribute(new Float32Array(positions.length), 3);
	colors.setUsage(THREE.DynamicDrawUsage);
	geometry.setAttribute("color", colors);
	geometry.computeVertexNormals();
	scene.add(new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true })));

	const edgeGeometry = new THREE.BufferGeometry();
	edgeGeometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(edgePositions, 3)
	);
	const edges = new THREE.LineSegments(
		edgeGeometry,
		new THREE.LineBasicMaterial({ color: 0x142019, transparent: true, opacity: 0.55 })
	);
	edges.renderOrder = 1;
	scene.add(edges);

	return {
		setCellColors(cellColors) {
			paintCellColors(colors.array, cellVertexStart, cellColors);
			colors.needsUpdate = true;
		},
	};
}

function addTrees(scene, meshData, treeModel) {
	const trees = new THREE.Group();
	for (const { position, normal } of meshData.trees) {
		const tree = treeModel.clone(true);
		tree.position.fromArray(position);
		tree.quaternion.setFromUnitVectors(up, new THREE.Vector3().fromArray(normal));
		trees.add(tree);
	}
	scene.add(trees);
	return trees;
}

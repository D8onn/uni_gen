import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createControls, createRenderer } from "../sceneHelpers.js";
import { createGlobeMap } from "./createGlobeMap.js";

const biomeColors = new Map([
	["Water", 0x347caa],
	["Mountains", 0x9ca5aa],
	["Grasslands", 0x78ad4d],
	["Forest", 0x28663d],
	["Beaches", 0xdac78f],
	["Desert", 0xc88a4c],
	["Taiga", 0x71908b],
	["Chaparral", 0xa4a05a],
]);

const up = new THREE.Vector3(0, 1, 0);

function createRandomSeed() {
	const values = new Uint32Array(1);
	if (globalThis.crypto?.getRandomValues) {
		return globalThis.crypto.getRandomValues(values)[0];
	}
	return Math.floor(Math.random() * 0x100000000);
}

export async function createPlanet({
	poleToPoleCells = 80,
	radius = 10,
	seed = createRandomSeed(),
} = {}) {
	const globe = createGlobeMap({ poleToPoleCells, seed });
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
	addGlobeSurface(scene, globe, radius);
	addTrees(scene, globe, gltf.scene, radius);

	const light = new THREE.DirectionalLight(0xffffff, 2.2);
	light.position.set(radius * 3, radius * 4, radius * 2);
	light.castShadow = false;
	scene.add(light, light.target);
	scene.add(new THREE.HemisphereLight(0xdbeaff, 0x443622, 1.1));

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

function addGlobeSurface(scene, globe, radius) {
	const facePositions = globe.faces.map((face) => {
		const averageElevation =
			face.cellIds.reduce((sum, id) => sum + globe.cells[id].surfaceElevation, 0) /
			face.cellIds.length;
		return face.center.clone().multiplyScalar(radius + averageElevation);
	});
	const positionsByBiome = new Map(
		[...biomeColors.keys()].map((biome) => [biome, []])
	);

	for (const cell of globe.cells) {
		const positions = positionsByBiome.get(cell.biome);
		const center = cell.center.clone().multiplyScalar(radius + cell.surfaceElevation);
		for (let index = 0; index < cell.boundaryFaceIds.length; index++) {
			let pointA = facePositions[cell.boundaryFaceIds[index]];
			let pointB =
				facePositions[cell.boundaryFaceIds[(index + 1) % cell.boundaryFaceIds.length]];
			const normal = new THREE.Vector3().crossVectors(
				new THREE.Vector3().subVectors(pointA, center),
				new THREE.Vector3().subVectors(pointB, center)
			);
			if (normal.dot(center) < 0) [pointA, pointB] = [pointB, pointA];
			positions.push(
				center.x,
				center.y,
				center.z,
				pointA.x,
				pointA.y,
				pointA.z,
				pointB.x,
				pointB.y,
				pointB.z
			);
		}
	}

	for (const [biome, positions] of positionsByBiome) {
		if (positions.length === 0) continue;
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
		geometry.computeVertexNormals();
		const color = biomeColors.get(biome);
		const material = new THREE.MeshLambertMaterial({ color });
		const mesh = new THREE.Mesh(geometry, material);
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		scene.add(mesh);
	}

	const edgePositions = [];
	for (const edge of globe.edges) {
		for (const faceId of [edge.faceA, edge.faceB]) {
			const point = facePositions[faceId].clone().multiplyScalar(1.0005);
			edgePositions.push(point.x, point.y, point.z);
		}
	}
	const edgeGeometry = new THREE.BufferGeometry();
	edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
	const edges = new THREE.LineSegments(
		edgeGeometry,
		new THREE.LineBasicMaterial({ color: 0x142019, transparent: true, opacity: 0.55 })
	);
	edges.renderOrder = 1;
	scene.add(edges);
}

function addTrees(scene, globe, treeModel, radius) {
	for (const cell of globe.cells) {
		if (!cell.hasTree) continue;
		const tree = treeModel.clone(true);
		const normal = cell.center.clone();
		tree.position.copy(normal).multiplyScalar(radius + cell.surfaceElevation + 0.025);
		tree.quaternion.setFromUnitVectors(up, normal);
		scene.add(tree);
	}
}

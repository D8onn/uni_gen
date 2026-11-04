import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createControls, createRenderer } from "../sceneHelpers.js";
import { computeCellColors } from "./cellViews.js";
import { createGlobeMap } from "./createGlobeMap.js";
import { addLighting } from "./lighting.js";
import { buildCellMeshData, buildPlanetMeshData, paintCellColors } from "./planetMeshData.js";
import { getMarkerSize, MAX_MARKERS } from "./populationMarkers.js";
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
	const markers = addMarkers(scene, globe);
	surface.setCellColors(computeCellColors("biome", { world: globe }));

	addLighting(scene, camera);

	let lastFrame = null;
	renderer.setAnimationLoop((time) => {
		controls.update();
		markers.animate(lastFrame === null ? 0 : (time - lastFrame) / 1000);
		lastFrame = time;
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
		// Shows one marker per `{ cellId }` sized for `unit` organisms (see `placeMarkers`); markers glide to their new cells.
		setMarkers: markers.set,
		setMarkersVisible: (visible) => (markers.mesh.visible = visible),
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

const MARKER_LIFT = 0.5; // a marker sits half a radius above the surface
const MARKER_GLIDE_SECONDS = 0.25; // time constant for a marker moving to its new cell

// Instanced spheres marking groups of organisms. Each marker keeps a direction, a height, and a radius that ease toward their targets.
function addMarkers(scene, globe) {
	const mesh = new THREE.InstancedMesh(
		new THREE.IcosahedronGeometry(1, 1),
		new THREE.MeshLambertMaterial({ color: 0xff5fa2, emissive: 0x4a1030 }),
		MAX_MARKERS
	);
	mesh.count = 0;
	mesh.frustumCulled = false; // the instances move, so the base geometry's bounds do not apply
	scene.add(mesh);

	const targets = [];
	const current = [];
	const matrix = new THREE.Matrix4();
	const direction = new THREE.Vector3();

	function write() {
		current.forEach(({ direction: [x, y, z], height, radius }, index) => {
			direction.set(x, y, z).normalize();
			matrix.makeScale(radius, radius, radius).setPosition(direction.multiplyScalar(height));
			mesh.setMatrixAt(index, matrix);
		});
		mesh.count = current.length;
		mesh.instanceMatrix.needsUpdate = true;
	}

	return {
		mesh,
		set(markerCells, unit) {
			const radius = getMarkerSize(unit) * globe.radius;
			targets.length = 0;
			for (const { cellId } of markerCells) {
				const cell = globe.cells[cellId];
				targets.push({ direction: [...cell.center], height: globe.radius + cell.surfaceElevation + radius * MARKER_LIFT, radius });
			}
			current.length = Math.min(current.length, targets.length);
			targets.forEach((target, index) => {
				current[index] ??= { ...target, direction: [...target.direction] };
			});
			write();
		},
		// Eases each marker toward its target over about MARKER_GLIDE_SECONDS, redrawing only while something moves.
		animate(seconds) {
			if (seconds <= 0) return;
			const share = 1 - Math.exp(-seconds / MARKER_GLIDE_SECONDS);
			let moving = false;
			current.forEach((marker, index) => {
				const target = targets[index];
				for (let axis = 0; axis < 3; axis++) {
					const step = (target.direction[axis] - marker.direction[axis]) * share;
					marker.direction[axis] += step;
					moving ||= Math.abs(step) > 1e-6;
				}
				const heightStep = (target.height - marker.height) * share;
				const radiusStep = (target.radius - marker.radius) * share;
				marker.height += heightStep;
				marker.radius += radiusStep;
				moving ||= Math.abs(heightStep) > 1e-5 || Math.abs(radiusStep) > 1e-5;
			});
			if (moving) write();
		},
	};
}

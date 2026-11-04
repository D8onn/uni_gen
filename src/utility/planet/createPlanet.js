import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createControls, createRenderer } from "../sceneHelpers.js";
import { createClickDetector, getCellOfTriangle } from "./cellPicking.js";
import { computeCellColors } from "./cellViews.js";
import { createGlobeMap } from "./createGlobeMap.js";
import { addLighting } from "./lighting.js";
import { createMarkerAnimator } from "./markerAnimation.js";
import { buildCellMeshData, buildCellOutline, buildPlanetMeshData, paintCellColors } from "./planetMeshData.js";
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
	const cellMesh = buildCellMeshData(globe);
	const surface = addGlobeSurface(scene, cellMesh, meshData.edgePositions);
	const trees = addTrees(scene, meshData, gltf.scene);
	const markers = addMarkers(scene, globe);
	const selection = addSelection(scene, globe, cellMesh);
	const clicks = addCellClicks({ renderer, camera, terrain: surface.mesh, cellVertexStart: cellMesh.cellVertexStart });
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
		// Calls `listener(cellId)` when the terrain is clicked, with null for a click that misses it; a drag is not a click. Returns a function that stops listening.
		onCellClick: clicks.onClick,
		// Outlines and tints one cell as selected; null clears it.
		setSelectedCell: selection.set,
	};
}

function addGlobeSurface(scene, { positions, cellVertexStart }, edgePositions) {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	const colors = new THREE.BufferAttribute(new Float32Array(positions.length), 3);
	colors.setUsage(THREE.DynamicDrawUsage);
	geometry.setAttribute("color", colors);
	geometry.computeVertexNormals();
	const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
	scene.add(mesh);

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
		mesh,
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

const SELECTION_LIFT = 1.003; // the selection's tint floats just above the surface, and its outline a little higher

// A translucent tint and an outline on the selected cell.
function addSelection(scene, globe, { positions, cellVertexStart }) {
	const group = new THREE.Group();
	group.visible = false;
	const tint = new THREE.Mesh(
		new THREE.BufferGeometry(),
		new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false })
	);
	const outline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff }));
	tint.renderOrder = outline.renderOrder = 2;
	group.add(tint, outline);
	scene.add(group);

	const setPositions = (object, values) => {
		object.geometry.dispose();
		object.geometry = new THREE.BufferGeometry();
		object.geometry.setAttribute("position", new THREE.BufferAttribute(values, 3));
	};
	return {
		set(cellId) {
			group.visible = cellId !== null;
			if (cellId === null) return;
			const raised = positions.slice(cellVertexStart[cellId] * 3, cellVertexStart[cellId + 1] * 3).map((value) => value * SELECTION_LIFT);
			setPositions(tint, raised);
			setPositions(outline, buildCellOutline(globe, cellId));
		},
	};
}

// Reports which cell a click on the terrain lands on, using the cell mesh's vertex ranges to name the triangle's cell.
function addCellClicks({ renderer, camera, terrain, cellVertexStart }) {
	const canvas = renderer.domElement;
	const raycaster = new THREE.Raycaster();
	const pointer = new THREE.Vector2();
	const detector = createClickDetector();
	const listeners = new Set();
	canvas.addEventListener("pointerdown", (event) => detector.down({ x: event.clientX, y: event.clientY, button: event.button }));
	canvas.addEventListener("pointercancel", () => detector.cancel());
	canvas.addEventListener("pointerup", (event) => {
		if (!detector.up({ x: event.clientX, y: event.clientY, button: event.button })) return;
		const bounds = canvas.getBoundingClientRect();
		pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
		raycaster.setFromCamera(pointer, camera);
		const [hit] = raycaster.intersectObject(terrain, false);
		const cellId = hit ? getCellOfTriangle(cellVertexStart, hit.faceIndex) : null;
		for (const listener of listeners) listener(cellId);
	});
	return {
		onClick(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

const MARKER_LIFT = 0.5; // a marker sits half a radius above the surface

// Instanced spheres marking groups of organisms; `createMarkerAnimator` decides where each one is drawn.
function addMarkers(scene, globe) {
	const capacity = MAX_MARKERS * 2; // markers still shrinking into their neighbours count too
	const mesh = new THREE.InstancedMesh(
		new THREE.IcosahedronGeometry(1, 1),
		new THREE.MeshLambertMaterial({ color: 0xff5fa2, emissive: 0x4a1030 }),
		capacity
	);
	mesh.count = 0;
	mesh.frustumCulled = false; // the instances move, so the base geometry's bounds do not apply
	scene.add(mesh);

	const animator = createMarkerAnimator({ maxMarkers: capacity });
	const matrix = new THREE.Matrix4();
	const direction = new THREE.Vector3();

	function write() {
		animator.markers.forEach(({ direction: [x, y, z], height, radius }, index) => {
			direction.set(x, y, z).normalize();
			matrix.makeScale(radius, radius, radius).setPosition(direction.multiplyScalar(height));
			mesh.setMatrixAt(index, matrix);
		});
		mesh.count = animator.markers.length;
		mesh.instanceMatrix.needsUpdate = true;
	}

	return {
		mesh,
		set(markerCells, unit) {
			const radius = getMarkerSize(unit) * globe.radius;
			animator.set(
				markerCells.map(({ cellId }) => {
					const cell = globe.cells[cellId];
					return { direction: [...cell.center], height: globe.radius + cell.surfaceElevation + radius * MARKER_LIFT, radius };
				})
			);
			write();
		},
		animate(seconds) {
			if (animator.step(seconds)) write();
		},
	};
}

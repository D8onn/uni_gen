import * as THREE from "three";
import { createMap } from "./createMap";
import { createAxis, createControls, createRenderer } from "../sceneHelpers.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
	GLTFLoader,
	MTLLoader,
	OBJLoader,
	RGBELoader,
} from "three/examples/jsm/Addons.js";

let biomes = {
	0: "Water",
	1: "Mountains",
	2: "Grasslands",
	3: "Forest",
	4: "Beaches",
	5: "Desert",
	6: "Taiga",
	7: "Chaparral",
};

let colors = new Map();
let landHeight = 5;
let tree = null;

let scene, camera, renderer, envmap;

export async function createPlanet(
	width,
	height,
	landHeight = 5,
	radius = 1,
	noiseScale = 45,
	waterThreshold = 0.1,
	mountainsThreshold = 0.9
) {
	height = height;
	width = width;

	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera(
		75,
		window.innerWidth / window.innerHeight,
		0.1,
		2000
	);
	renderer = createRenderer();

	scene.background = new THREE.Color(0xf6f0f0);

	window.addEventListener("resize", onWindowResize);

	// initial camera position
	camera.position.set(0, 30, 30);
	const controls = createControls(camera, renderer);

	// creates an environment map that makes the hexagons look nicer
	var pmrem = new THREE.PMREMGenerator(renderer);
	var envmapTexture = await new RGBELoader()
		.setDataType(THREE.FloatType)
		.loadAsync("/models/lakeside_sunrise_4k.hdr");
	envmap = pmrem.fromEquirectangular(envmapTexture).texture;

	// creates the tree object for the forests
	// asset from: https://michaelsgamelab.itch.io/rpg-cabin-models
	var loader = new GLTFLoader();
	var gltf = await loader.loadAsync("/models/tree.glb", (prg) => {});
	tree = gltf.scene;
	tree.scale.set(0.3, 0.5, 0.3);

	///////////////////////////////////////////////////
	// This is where creating the planet map is done //
	setUpBiomesColor();

	var planetMap = createMap(
		width,
		height,
		landHeight,
		noiseScale,
		waterThreshold,
		mountainsThreshold
	);
	console.log(planetMap);

	// create lighting
	const color = 0xffffff;
	const intensity = 0.75;
	const light = new THREE.DirectionalLight(color, intensity);
	light.position.set(0, 20, -5);
	light.target.position.set(10, 0, 0);
	light.castShadow = true;
	light.shadow.mapSize.width = 1024;
	light.shadow.mapSize.height = 1024;
	light.shadow.camera.near = 0.1;
	light.shadow.camera.far = 200;

	scene.add(light);
	scene.add(light.target);

	const skyColor = 0xffffff; // light blue
	const groundColor = 0xb97a20; // brownish orange
	const hemiLight = new THREE.HemisphereLight(skyColor, groundColor, intensity);
	scene.add(hemiLight);

	buildMap(scene, planetMap, radius, width, height);

	///////////////////////////////////////////////////

	renderer.setAnimationLoop(animate);

	function animate() {
		controls.update();
		renderer.render(scene, camera);
	}
}

function buildMap(scene, planetMap, radius, width, height) {
	var waterGeo = new THREE.BoxGeometry(0, 0, 0);
	var grasslandGeo = new THREE.BoxGeometry(0, 0, 0);
	var forestGeo = new THREE.BoxGeometry(0, 0, 0);
	var desertGeo = new THREE.BoxGeometry(0, 0, 0);
	var beachGeo = new THREE.BoxGeometry(0, 0, 0);
	var mountainGeo = new THREE.BoxGeometry(0, 0, 0);
	var taigaGeo = new THREE.BoxGeometry(0, 0, 0);
	var chaparralGeo = new THREE.BoxGeometry(0, 0, 0);

	planetMap.forEach((val, key) => {
		const geometry = new THREE.CylinderGeometry(radius, radius, val.height, 6);
		geometry.translate(...findPosition(val, radius, width, height));

		if (val.biome == biomes[0]) {
			waterGeo = mergeGeometries([waterGeo, geometry]);
		} else if (val.biome == biomes[1]) {
			mountainGeo = mergeGeometries([mountainGeo, geometry]);
		} else if (val.biome == biomes[2]) {
			grasslandGeo = mergeGeometries([grasslandGeo, geometry]);
		} else if (val.biome == biomes[3]) {
			const num = THREE.MathUtils.randFloat(0, 1);
			if (num < 0.15) {
				var newTree = tree.clone();
				var position = [...findPosition(val, radius, width, height)];
				position[1] *= 2;
				newTree.position.set(...position);
				scene.add(newTree);
			}

			forestGeo = mergeGeometries([forestGeo, geometry]);
		} else if (val.biome == biomes[4]) {
			beachGeo = mergeGeometries([beachGeo, geometry]);
		} else if (val.biome == biomes[5]) {
			desertGeo = mergeGeometries([desertGeo, geometry]);
		} else if (val.biome == biomes[6]) {
			taigaGeo = mergeGeometries([taigaGeo, geometry]);
		} else if (val.biome == biomes[7]) {
			chaparralGeo = mergeGeometries([chaparralGeo, geometry]);
		} else {
		}
	});

	var waterMesh = createMesh(waterGeo, colors.get(biomes[0]));
	var mountainMesh = createMesh(mountainGeo, colors.get(biomes[1]));
	var grasslandMesh = createMesh(grasslandGeo, colors.get(biomes[2]));
	var forestMesh = createMesh(forestGeo, colors.get(biomes[3]));
	var beachMesh = createMesh(beachGeo, colors.get(biomes[4]));
	var desertMesh = createMesh(desertGeo, colors.get(biomes[5]));
	var taigaMesh = createMesh(taigaGeo, colors.get(biomes[6]));
	var chaparralMesh = createMesh(chaparralGeo, colors.get(biomes[7]));
	scene.add(
		waterMesh,
		mountainMesh,
		grasslandMesh,
		forestMesh,
		beachMesh,
		desertMesh,
		taigaMesh,
		chaparralMesh
	);
}

function createMesh(geo, mat) {
	const mesh = new THREE.Mesh(geo, mat);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;
}

function setUpBiomesColor() {
	colors.set(
		"Forest",
		new THREE.MeshStandardMaterial({
			color: 0x0b620d,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
	colors.set(
		"Temperate",
		new THREE.MeshStandardMaterial({
			color: 0x54ab7f,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
	colors.set(
		"Taiga",
		new THREE.MeshStandardMaterial({
			color: 0x0eeff1,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
	colors.set(
		"Chaparral",
		new THREE.MeshStandardMaterial({
			color: 0xd5d12a,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
	colors.set(
		"Beaches",
		new THREE.MeshStandardMaterial({
			color: 0xc2b280,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
	colors.set(
		"Grasslands",
		new THREE.MeshStandardMaterial({
			color: 0x6cc936,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
	colors.set(
		"Desert",
		new THREE.MeshStandardMaterial({
			color: 0x9c4914,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
	colors.set(
		"Mountains",
		new THREE.MeshStandardMaterial({
			color: 0xfffafa,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
	colors.set(
		"Ice Caps",
		new THREE.MeshStandardMaterial({
			color: 0xbddcff,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);

	colors.set(
		"Water",
		new THREE.MeshStandardMaterial({
			color: 0x4e51f8,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
}

function findPosition(val, radius, width, height) {
	var diameter = radius * 2.0;
	var x =
		val.y % 2 == 0
			? val.x * diameter * Math.cos(THREE.MathUtils.degToRad(30)) -
			  width * Math.cos(THREE.MathUtils.degToRad(30)) * radius
			: val.x * diameter * Math.cos(THREE.MathUtils.degToRad(30)) +
			  radius * Math.cos(THREE.MathUtils.degToRad(30)) -
			  width * Math.cos(THREE.MathUtils.degToRad(30)) * radius;
	var z = val.height / 2;
	var y =
		val.y % 2 == 0
			? val.y * radius + val.y * radius * Math.sin(THREE.MathUtils.degToRad(30))
			: val.y * radius + val.y * radius * Math.sin(THREE.MathUtils.degToRad(30));
	y = height % 2 == 0 ? y + radius : y;
	return [
		x, // * Math such that the map is in center of page
		z,
		y - (Math.floor(height / 2.0) / 2.0) * (diameter + radius),
	];
}

function onWindowResize() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
}

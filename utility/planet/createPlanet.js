import * as THREE from "three";
import { createMap } from "./createMap";
import { createAxis, createControls, createRenderer } from "../sceneHelpers.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { RGBELoader } from "three/examples/jsm/Addons.js";

let biomes = {
	0: "Tropical",
	1: "Temperate",
	2: "Taiga",
	3: "Chaparral",
	4: "Savannas",
	5: "Temperate Grassland",
	6: "Hot Desert",
	7: "Cold Desert",
	8: "Arctic Tundra",
	9: "Alpine Tundra",
	10: "Ice Caps",
	11: "Freshwater",
	12: "Ocean",
};

let colors = new Map();
let height = 40;
let width = 40;
let landHeight = 3;

let scene, camera, renderer, envmap;

export async function createPlanet() {
	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera(
		75,
		window.innerWidth / window.innerHeight,
		0.1,
		1000
	);
	renderer = createRenderer();

	scene.background = new THREE.Color(0xba8945);
	// createAxis(scene);

	window.addEventListener("resize", onWindowResize);

	// initial camera position
	camera.position.set(0, 20, 20);
	const controls = createControls(camera, renderer);

	// creates an environment map that makes the hexagons look nicer
	var pmrem = new THREE.PMREMGenerator(renderer);
	var envmapTexture = await new RGBELoader()
		.setDataType(THREE.FloatType)
		.loadAsync("../../assets/lakeside_sunrise_4k.hdr");
	envmap = pmrem.fromEquirectangular(envmapTexture).texture;
	///////////////////////////////////////////////////////////////

	///////////////////////////////////////////////////
	// This is where creating the planet map is done //
	setUpBiomesColor();

	var planetMap = createMap(width, height);

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

	const skyColor = 0xf4c10b; // light blue
	const groundColor = 0xb97a20; // brownish orange
	const hemiLight = new THREE.HemisphereLight(skyColor, groundColor, intensity);
	scene.add(hemiLight);

	buildMap(scene, planetMap);

	///////////////////////////////////////////////////

	renderer.setAnimationLoop(animate);

	function animate() {
		controls.update();
		renderer.render(scene, camera);
	}
}

function buildMap(scene, planetMap) {
	const radius = 0.5;
	var hexagonGeometries = new THREE.BoxGeometry(0, 0, 0);
	var waterGeo = new THREE.BoxGeometry(0, 0, 0);

	planetMap.forEach((val, key) => {
		const geometry = new THREE.CylinderGeometry(radius, radius, val.height, 6);
		geometry.translate(...findPosition(val, radius));

		if (val.biome == 12) {
			waterGeo = mergeGeometries([waterGeo, geometry]);
		} else {
			hexagonGeometries = mergeGeometries([hexagonGeometries, geometry]);
		}
	});

	var restMesh = createMesh(hexagonGeometries, colors.get(biomes[2]));
	var waterMesh = createMesh(waterGeo, colors.get(biomes[12]));
	scene.add(restMesh, waterMesh);
}

function createMesh(geo, mat) {
	const mesh = new THREE.Mesh(geo, mat);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;
}

function setUpBiomesColor() {
	colors.set(
		"Tropical",
		new THREE.MeshStandardMaterial({
			color: 0x20dfbd,
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
			color: 0x89b847,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
	colors.set(
		"Savannas",
		new THREE.MeshStandardMaterial({
			color: 0xd2d728,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
	colors.set(
		"Temperate Grassland",
		new THREE.MeshStandardMaterial({
			color: 0x6cc936,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
	colors.set(
		"Hot Desert",
		new THREE.MeshStandardMaterial({
			color: 0xd38b2c,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
	colors.set(
		"Cold Desert",
		new THREE.MeshStandardMaterial({
			color: 0x72858d,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
	colors.set(
		"Arctic Tundra",
		new THREE.MeshStandardMaterial({
			color: 0xc9f1fa,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
	colors.set(
		"Alpine Tundra",
		new THREE.MeshStandardMaterial({
			color: 0xdeffbb,
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
		"Freshwater",
		new THREE.MeshStandardMaterial({
			color: 0x2982d6,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
	colors.set(
		"Ocean",
		new THREE.MeshStandardMaterial({
			color: 0x4e51f8,
			envMap: envmap,
			flatShading: true,
			roughness: 0.25,
			metalness: 0.25,
		})
	);
}

function findPosition(val, radius) {
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

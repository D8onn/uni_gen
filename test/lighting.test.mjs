import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { addLighting } from "../src/utility/planet/lighting.js";

// Camera positions around a planet of radius 10: above, below, each side, and the diagonals.
const viewpoints = [
	[0, 16, 32],
	[0, -35, 4],
	[35, 3, 0],
	[-35, 3, 0],
	[0, 3, -35],
	[20, 26, 13],
	[-20, -26, -13],
];

function createRig(position) {
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(50, 1.3, 0.1, 200);
	const lights = addLighting(scene, camera);
	camera.position.set(...position);
	camera.lookAt(0, 0, 0);
	scene.updateMatrixWorld(true);
	return { scene, camera, ...lights };
}

// Direction the key light's rays travel, in world space.
function keyDirection(key) {
	return key.target.getWorldPosition(new THREE.Vector3()).sub(key.getWorldPosition(new THREE.Vector3())).normalize();
}

test("the side of the planet facing the camera gets the same key light from every viewpoint", () => {
	const lit = viewpoints.map((position) => {
		const { camera, key } = createRig(position);
		const towardCamera = camera.position.clone().normalize();
		return towardCamera.dot(keyDirection(key).negate());
	});

	for (const amount of lit) {
		assert.ok(Math.abs(amount - lit[0]) < 1e-9, `lit amounts ${lit.join(", ")}`);
	}
	assert.ok(lit[0] > 0.6, `key light reaches the facing side at ${lit[0]}`);
});

test("the key light is off the view axis so terrain relief still shows as shading", () => {
	const { camera, key } = createRig(viewpoints[0]);
	const viewAxis = camera.position.clone().normalize().negate();
	const angle = THREE.MathUtils.radToDeg(viewAxis.angleTo(keyDirection(key)));

	assert.ok(angle > 20 && angle < 60, `key light is ${angle} degrees off the view axis`);
});

test("no light is fixed to the world, and an even fill reaches the parts facing away from the key", () => {
	const { scene, camera, fill } = createRig(viewpoints[1]);
	const lights = [];
	scene.traverse((object) => {
		if (object.isLight) lights.push(object);
	});

	assert.ok(fill.intensity > 0);
	assert.ok(lights.includes(fill));
	assert.ok(lights.every((light) => !light.isHemisphereLight));
	for (const light of lights) {
		if (light.isAmbientLight) continue;
		let ancestor = light.parent;
		while (ancestor && ancestor !== camera) ancestor = ancestor.parent;
		assert.equal(ancestor, camera, "directional lights travel with the camera");
	}
});

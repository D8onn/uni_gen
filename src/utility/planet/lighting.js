import * as THREE from "three";

const KEY_INTENSITY = 2.2;
const AMBIENT_INTENSITY = 1.1;

// A planet has no fixed "up", and a light fixed in the world leaves whichever side faces away
// from it dark. Lights parented to the camera light the side you are looking at the same way
// from every angle: a key light from the upper left of the view, plus an even fill so the parts
// facing away from the key stay readable.
export function addLighting(scene, camera) {
	const key = new THREE.DirectionalLight(0xffffff, KEY_INTENSITY);
	// Direction is key.target - key.position, fixed in camera space whatever the orbit distance.
	key.position.set(-1, 1.2, 1.5);
	key.target.position.set(0, 0, 0);
	key.castShadow = false;
	camera.add(key, key.target);

	const fill = new THREE.AmbientLight(0xdbeaff, AMBIENT_INTENSITY);
	// The camera must be in the scene for its lights to be rendered.
	scene.add(camera, fill);
	return { key, fill };
}

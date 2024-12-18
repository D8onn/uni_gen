import * as THREE from "three";

let meshMaterials = [];
meshMaterials.push(new THREE.MeshBasicMaterial({ color: 0x7cfc00, transparent: true }));
meshMaterials.push(new THREE.MeshBasicMaterial({ color: 0x397d02, transparent: true }));
meshMaterials.push(new THREE.MeshBasicMaterial({ color: 0x77ee00, transparent: true }));
meshMaterials.push(new THREE.MeshBasicMaterial({ color: 0x61b329, transparent: true }));
meshMaterials.push(new THREE.MeshBasicMaterial({ color: 0x83f52c, transparent: true }));
meshMaterials.push(new THREE.MeshBasicMaterial({ color: 0x83f52c, transparent: true }));
meshMaterials.push(new THREE.MeshBasicMaterial({ color: 0x4cbb17, transparent: true }));
meshMaterials.push(new THREE.MeshBasicMaterial({ color: 0x00ee00, transparent: true }));
meshMaterials.push(new THREE.MeshBasicMaterial({ color: 0x00aa11, transparent: true }));

let oceanMaterial = [];
oceanMaterial.push(new THREE.MeshBasicMaterial({ color: 0x0f2342, transparent: true }));
oceanMaterial.push(new THREE.MeshBasicMaterial({ color: 0x0f1e38, transparent: true }));

export function createHexagonEdges(radius, detail) {
	// from hexasphere.js
	var hexasphere = new Hexasphere(radius, detail, 1);

	const group = new THREE.Group();
	console.log(hexasphere);
	for (var i = 0; i < hexasphere.tiles.length; i++) {
		var tile = hexasphere.tiles[i];
		var vert = [];
		tile.boundary.forEach((el) => {
			vert.push(new THREE.Vector3(+el.x, +el.y, +el.z));
		});
		const [x, y, z] = [tile.centerPoint.x, tile.centerPoint.y, tile.centerPoint.z];
		const target = new THREE.Vector3(x, y, z);
		const axis = new THREE.Vector3(0, 1, 0);

		const geometry = new THREE.CylinderGeometry(
			0.5,
			0,
			target.length(),
			tile.boundary.length
		);
		const num = THREE.MathUtils.randInt(0, meshMaterials.length);
		const mesh = new THREE.Mesh(geometry, meshMaterials[num]);
		mesh.quaternion.setFromUnitVectors(axis, target.clone().normalize());
		mesh.position.set(x, y, z);
		group.add(mesh);
	}
	console.log(group);

	// const wireframe = new THREE.LineSegments(wire);
	// wireframe.material.opacity = 0.75;
	// wireframe.material.transparent = true;

	return [group];
}

// Prints the golden mesh hashes used by test/planet-mesh-data.test.mjs, built from the pre-split
// createPlanet renderer at a given commit (never from the code under test).
// Usage: node scripts/golden-mesh-hashes.mjs [git-ref]  (default: WG-05 climate commit fee761d)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_REF = "fee761d7c16940472f2f26d6495d8df474ce99ab";
const GOLDEN_CASES = [
	[80, 12345],
	[20, 42],
];

const ref = process.argv[2] ?? DEFAULT_REF;
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const workDir = mkdtempSync(join(tmpdir(), "uni-gen-golden-"));

function bytes(array) {
	return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

try {
	const archive = execFileSync("git", ["archive", ref, "src"], { cwd: repoRoot });
	execFileSync("tar", ["-x", "-C", workDir], { input: archive });
	symlinkSync(join(repoRoot, "node_modules"), join(workDir, "node_modules"), "dir");
	const planetDir = join(workDir, "src/utility/planet");
	// Exposes the old renderer's private scene builders without running its browser-only setup.
	appendFileSync(join(planetDir, "createPlanet.js"), "\nexport { addGlobeSurface, addTrees, biomeColors };\n");

	const THREE = await import(pathToFileURL(join(workDir, "node_modules/three/build/three.module.js")));
	const { addGlobeSurface, addTrees, biomeColors } = await import(
		pathToFileURL(join(planetDir, "createPlanet.js"))
	);
	const { createGlobeMap } = await import(pathToFileURL(join(planetDir, "createGlobeMap.js")));
	const biomeByColor = new Map([...biomeColors].map(([biome, color]) => [color, biome]));

	for (const [poleToPoleCells, seed] of GOLDEN_CASES) {
		const radius = 10;
		const globe = createGlobeMap({ poleToPoleCells, seed, radius });
		const scene = new THREE.Scene();
		addGlobeSurface(scene, globe, radius);
		const treeMarker = new THREE.Object3D();
		const treeStart = scene.children.length;
		addTrees(scene, globe, treeMarker, radius);

		// Same byte layout as hashMeshData in the test.
		const hash = createHash("sha256");
		for (const object of scene.children.slice(0, treeStart)) {
			const positions = object.geometry.getAttribute("position").array;
			if (object.isMesh) hash.update(biomeByColor.get(object.material.color.getHex()));
			else hash.update("edges");
			hash.update(bytes(positions));
		}
		const treeCells = globe.cells.filter((cell) => cell.hasTree);
		const treeData = scene.children
			.slice(treeStart)
			.flatMap((tree, index) => [...tree.position.toArray(), ...treeCells[index].center.toArray()]);
		hash.update(bytes(new Float64Array(treeData)));
		console.log(`[${poleToPoleCells}, ${seed}, "${hash.digest("hex")}"],`);
	}
} finally {
	rmSync(workDir, { recursive: true, force: true });
}

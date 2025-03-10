import { defineConfig } from "vite";

export default defineConfig({
	base: "/", // Ensure assets load correctly in production
	build: {
		outDir: "dist", // Build output directory
	},
});
// https://vitejs.dev/config/

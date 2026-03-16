import { defineConfig } from "tsdown"

export default defineConfig({
	entry: ["src/index.ts", "src/agent-runner.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
})

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const bundledAgentNames = [
	"leader",
	"supervisor",
	"scout",
	"planner",
	"worker",
	"reviewer",
	"docs-keeper",
] as const

export const townPackageName = "@schilderlabs/pitown-package"

function resolvePackageRoot() {
	return join(dirname(fileURLToPath(import.meta.url)), "..")
}

export function resolvePiTownPackageRoot() {
	return resolvePackageRoot()
}

export function resolvePiTownExtensionPath() {
	return join(resolvePackageRoot(), "pi", "extensions", "index.ts")
}

export function resolvePiTownMayorPromptPath() {
	return join(resolvePackageRoot(), "pi", "agents", "leader.md")
}

export function readPiTownMayorPrompt() {
	return readFileSync(resolvePiTownMayorPromptPath(), "utf-8")
}

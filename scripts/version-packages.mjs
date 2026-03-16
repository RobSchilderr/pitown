import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const packagePaths = [
	"packages/cli/package.json",
	"packages/core/package.json",
	"packages/pi-package/package.json",
]

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf-8"))
}

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`, "utf-8")
}

function isSemver(version) {
	return /^\d+\.\d+\.\d+$/.test(version)
}

function bumpVersion(version, bump) {
	if (!isSemver(version)) {
		throw new Error(`Unsupported version format: ${version}`)
	}

	const [major, minor, patch] = version.split(".").map((value) => Number.parseInt(value, 10))
	if (bump === "patch") return `${major}.${minor}.${patch + 1}`
	if (bump === "minor") return `${major}.${minor + 1}.0`
	if (bump === "major") return `${major + 1}.0.0`

	throw new Error(`Unknown bump type: ${bump}`)
}

function resolveNextVersion(currentVersion, arg) {
	if (arg === "patch" || arg === "minor" || arg === "major") {
		return bumpVersion(currentVersion, arg)
	}

	if (!isSemver(arg)) {
		throw new Error(`Expected patch, minor, major, or an exact semver like 0.2.2. Received: ${arg}`)
	}

	return arg
}

function main() {
	const [arg] = process.argv.slice(2)
	const paths = packagePaths.map((path) => resolve(path))
	const packages = paths.map((path) => ({ path, json: readJson(path) }))
	const versions = [...new Set(packages.map((pkg) => pkg.json.version))]

	if (versions.length !== 1) {
		throw new Error(`Package versions are not in sync: ${versions.join(", ")}`)
	}

	const currentVersion = versions[0]
	if (!currentVersion) {
		throw new Error("Could not determine current package version")
	}

	if (arg === "--check") {
		console.log(`Versions are in sync at ${currentVersion}`)
		return
	}

	if (!arg) {
		throw new Error("Usage: node scripts/version-packages.mjs <patch|minor|major|x.y.z|--check>")
	}

	const nextVersion = resolveNextVersion(currentVersion, arg)
	for (const pkg of packages) {
		pkg.json.version = nextVersion
		writeJson(pkg.path, pkg.json)
	}

	console.log(`Updated Pi Town package versions: ${currentVersion} -> ${nextVersion}`)
}

main()

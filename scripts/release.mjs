import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const rootDir = resolve(".")
const cliPackagePath = resolve("packages/cli/package.json")
const releaseTags = [
	{ tagPrefix: "pitown-v", packageName: "@schilderlabs/pitown" },
	{ tagPrefix: "pitown-core-v", packageName: "@schilderlabs/pitown-core" },
	{ tagPrefix: "pitown-package-v", packageName: "@schilderlabs/pitown-package" },
]

function run(command, args, options = {}) {
	const rendered = [command, ...args].join(" ")
	console.log(`> ${rendered}`)
	const result = spawnSync(command, args, {
		cwd: rootDir,
		stdio: "inherit",
		...options,
	})

	if (result.status !== 0) {
		process.exit(result.status ?? 1)
	}
}

function capture(command, args) {
	const result = spawnSync(command, args, {
		cwd: rootDir,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	})

	if (result.status !== 0) {
		const stderr = result.stderr?.trim()
		throw new Error(stderr || `${command} ${args.join(" ")} failed`)
	}

	return result.stdout.trim()
}

function printUsage() {
	console.log(
		[
			"Usage:",
			"  node scripts/release.mjs <patch|minor|major|x.y.z> [--link] [--github]",
			"",
			"Examples:",
			"  pnpm release patch --link",
			"  pnpm release minor",
			"  pnpm release 0.3.0 --github",
			"",
			"With --github, the script commits once and pushes these tags:",
			"  pitown-v<version>",
			"  pitown-core-v<version>",
			"  pitown-package-v<version>",
		].join("\n"),
	)
}

function assertCleanGit() {
	const status = capture("git", ["status", "--porcelain"])
	if (status !== "") {
		throw new Error("Git working tree is not clean. Commit or stash existing changes before running a GitHub release.")
	}
}

function readCliVersion() {
	return JSON.parse(readFileSync(cliPackagePath, "utf-8")).version
}

function main() {
	const args = process.argv.slice(2)
	const bump = args.find((arg) => !arg.startsWith("--"))
	const link = args.includes("--link")
	const github = args.includes("--github")

	if (!bump || args.includes("--help") || args.includes("-h")) {
		printUsage()
		process.exit(bump ? 0 : 1)
	}

	if (github) {
		assertCleanGit()
	}

	run("node", ["scripts/version-packages.mjs", bump])
	run("pnpm", ["syncpack:check"])
	run("pnpm", ["typecheck"])
	run("pnpm", ["test"])
	run("pnpm", ["build"])

	if (link) {
		run("pnpm", ["--dir", "packages/cli", "link", "--global"])
	}

	const version = readCliVersion()
	console.log(`Prepared Pi Town release v${version}`)

	if (!github) {
		console.log("GitHub publish skipped. Re-run with --github to commit, tag, and push the package release tags.")
		return
	}

	const tags = releaseTags.map(({ tagPrefix }) => `${tagPrefix}${version}`)

	run("git", ["add", "-A"])
	run("git", ["commit", "-m", `release: v${version}`])
	for (const tag of tags) {
		run("git", ["tag", tag])
	}
	run("git", ["push", "origin", "HEAD", ...tags])
	console.log(
		[
			"Triggered GitHub release workflow for:",
			...releaseTags.map(({ packageName }, index) => `- ${packageName}: ${tags[index]}`),
		].join("\n"),
	)
}

try {
	main()
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error))
	process.exit(1)
}

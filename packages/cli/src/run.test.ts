import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createRepoSlug, getRepoIdentity } from "../../core/src/index.js"
import { runTown } from "./run.js"
import { showTownStatus } from "./status.js"

const originalHome = process.env.HOME
const originalPath = process.env.PATH

afterEach(() => {
	if (originalHome === undefined) delete process.env.HOME
	else process.env.HOME = originalHome

	if (originalPath === undefined) delete process.env.PATH
	else process.env.PATH = originalPath
})

function createFakePi(binDir: string, options?: { stdout?: string; stderr?: string; exitCode?: number }) {
	const piPath = join(binDir, "pi")
	mkdirSync(binDir, { recursive: true })
	const stdout = options?.stdout ?? "pi cli stdout\n"
	const stderr = options?.stderr ?? "pi cli stderr\n"
	const exitCode = options?.exitCode ?? 0
	writeFileSync(
		piPath,
		[
			"#!/bin/sh",
			`printf ${JSON.stringify(stdout)}`,
			`printf ${JSON.stringify(stderr)} >&2`,
			`exit ${exitCode}`,
		].join("\n"),
		"utf-8",
	)
	chmodSync(piPath, 0o755)
}

function captureLogs(fn: () => void): string[] {
	const lines: string[] = []
	const originalLog = console.log
	console.log = (...args: unknown[]) => {
		lines.push(args.map((value) => String(value)).join(" "))
	}

	try {
		fn()
		return lines
	} finally {
		console.log = originalLog
	}
}

describe("runTown", () => {
	it("uses CLI flags before user config and updates the latest local status pointer", () => {
		const home = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		process.env.HOME = home

		const binDir = join(home, "bin")
		createFakePi(binDir)
		process.env.PATH = `${binDir}:${originalPath ?? ""}`

		const configRepo = join(home, "config-repo")
		const cliRepo = join(home, "cli-repo")
		const configPlan = join(home, "private-plans")
		mkdirSync(configRepo, { recursive: true })
		mkdirSync(cliRepo, { recursive: true })
		mkdirSync(configPlan, { recursive: true })

		const townHome = join(home, ".pi-town")
		mkdirSync(townHome, { recursive: true })
		writeFileSync(
			join(townHome, "config.json"),
			`${JSON.stringify({ repo: configRepo, plan: configPlan, goal: "config goal" }, null, 2)}\n`,
			"utf-8",
		)

		const result = runTown(["--repo", cliRepo, "--goal", "cli goal"])
		const repoSlug = createRepoSlug(getRepoIdentity(resolve(cliRepo)), resolve(cliRepo))
		expect(result.manifest.repoRoot).toBe(resolve(cliRepo))
		expect(result.manifest.planPath).toBe(resolve(configPlan))
		expect(result.manifest.goal).toBe("cli goal")
		expect(result.runDir.startsWith(join(home, ".pi-town", "repos"))).toBe(true)
		expect(
			JSON.parse(readFileSync(join(home, ".pi-town", "repos", repoSlug, "agents", "leader", "state.json"), "utf-8")) as {
				role: string
				status: string
			},
		).toEqual(
			expect.objectContaining({
				role: "leader",
				status: "idle",
			}),
		)

		const latestPointer = JSON.parse(readFileSync(join(home, ".pi-town", "latest-run.json"), "utf-8")) as {
			repoSlug: string
			runId: string
		}
		expect(latestPointer.repoSlug).toBe(repoSlug)
		expect(latestPointer.runId).toBe(result.runId)

		const output = captureLogs(() => showTownStatus())
		expect(output.join("\n")).toContain("[pitown] status")
		expect(output.join("\n")).toContain(`- latest run: ${result.runId}`)
		expect(output.join("\n")).toContain(`- repo root: ${resolve(cliRepo)}`)
	})

	it("surfaces Pi auth guidance when Pi is installed but not configured", () => {
		const home = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		process.env.HOME = home

		const binDir = join(home, "bin")
		createFakePi(binDir, { stderr: "No models available.\n", exitCode: 1 })
		process.env.PATH = `${binDir}:${originalPath ?? ""}`

		const repo = join(home, "repo")
		mkdirSync(repo, { recursive: true })

		const output = captureLogs(() => runTown(["--repo", repo]))
		expect(output.join("\n")).toContain("- pi exit code: 1")
		expect(output.join("\n")).toContain("Pi appears to be installed but not authenticated or configured")
		expect(output.join("\n")).toContain('pi -p "hello"')
	})

	it("runs without a configured plan path and recommends a private plans location", () => {
		const home = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		process.env.HOME = home

		const binDir = join(home, "bin")
		createFakePi(binDir)
		process.env.PATH = `${binDir}:${originalPath ?? ""}`

		const repo = join(home, "repo")
		mkdirSync(repo, { recursive: true })

		const result = runTown(["--repo", repo])
		expect(result.manifest.planPath).toBeNull()
		expect(result.summary.recommendedPlanDir).toBeTruthy()
		expect(result.summary.message).toContain("Recommended private plans location")
	})
})

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { readPiTownMayorPrompt, resolvePiTownExtensionPath } from "@schilderlabs/pitown-package"
import {
	createRepoSlug,
	getRepoIdentity,
	getRepoRoot,
	runController,
	type ControllerRunResult,
} from "../../core/src/index.js"
import { isDirectExecution } from "./entrypoint.js"
import { resolveRunConfig } from "./config.js"
import {
	getLatestRunPointerPath,
	getRecommendedPlanDir,
	getRepoArtifactsDir,
	getRepoLatestRunPointerPath,
	getTownHomeDir,
} from "./paths.js"

interface LatestRunPointer {
	repoSlug: string
	repoRoot: string
	runId: string
	runDir: string
	latestDir: string
	manifestPath: string
	metricsPath: string
	summaryPath: string
	updatedAt: string
}

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

function assertDirectory(path: string, label: string) {
	if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`)
	if (!statSync(path).isDirectory()) throw new Error(`${label} is not a directory: ${path}`)
}

function createLatestRunPointer(result: ControllerRunResult, repoSlug: string, repoRoot: string): LatestRunPointer {
	return {
		repoSlug,
		repoRoot,
		runId: result.runId,
		runDir: result.runDir,
		latestDir: result.latestDir,
		manifestPath: join(result.latestDir, "manifest.json"),
		metricsPath: join(result.latestDir, "metrics.json"),
		summaryPath: join(result.latestDir, "run-summary.json"),
		updatedAt: new Date().toISOString(),
	}
}

export function runTown(argv = process.argv.slice(2)): ControllerRunResult {
	const config = resolveRunConfig(argv)
	assertDirectory(config.repo, "Target repo")
	if (config.plan) assertDirectory(config.plan, "Plan path")

	const townHome = getTownHomeDir()
	mkdirSync(townHome, { recursive: true })

	const repoRoot = getRepoRoot(config.repo)
	const repoId = getRepoIdentity(repoRoot)
	const repoSlug = createRepoSlug(repoId, repoRoot)
	const recommendedPlanDir = config.plan ? null : getRecommendedPlanDir(repoSlug)
	const artifactsDir = getRepoArtifactsDir(repoSlug)

	const result = runController({
		artifactsDir,
		cwd: repoRoot,
		goal: config.goal,
		mode: "single-pi",
		planPath: config.plan,
		recommendedPlanDir,
		appendedSystemPrompt: readPiTownMayorPrompt(),
		extensionPath: resolvePiTownExtensionPath(),
	})

	const latestPointer = createLatestRunPointer(result, repoSlug, repoRoot)
	writeJson(getLatestRunPointerPath(), latestPointer)
	writeJson(getRepoLatestRunPointerPath(repoSlug), latestPointer)

	console.log("[pitown] run written")
	console.log(`- run id: ${result.runId}`)
	console.log(`- repo root: ${result.manifest.repoRoot}`)
	console.log(`- branch: ${result.manifest.branch}`)
	console.log(`- artifacts: ${result.runDir}`)
	console.log(`- latest metrics: ${latestPointer.metricsPath}`)
	console.log(`- pi exit code: ${result.piInvocation.exitCode}`)
	if (!result.summary.success) console.log(`- note: ${result.summary.message}`)
	if (result.manifest.planPath) console.log(`- plan path: ${result.manifest.planPath}`)
	if (result.summary.recommendedPlanDir) console.log(`- recommended plans: ${result.summary.recommendedPlanDir}`)

	return result
}

if (isDirectExecution(import.meta.url)) {
	const result = runTown()
	if (result.piInvocation.exitCode !== 0) process.exitCode = result.piInvocation.exitCode
}

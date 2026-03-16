import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { readPiTownMayorPrompt, resolvePiTownExtensionPath } from "@schilderlabs/pitown-package"
import {
	createRepoSlug,
	getRepoIdentity,
	getRepoRoot,
	runLoop,
	type ControllerRunResult,
	type LoopRunResult,
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

function getLatestControllerResult(result: LoopRunResult): ControllerRunResult {
	const latestIteration = result.iterations[result.iterations.length - 1]
	if (!latestIteration) {
		throw new Error("Autonomous run did not produce any mayor iterations.")
	}

	return latestIteration.controllerResult
}

export function runTown(argv = process.argv.slice(2)): LoopRunResult {
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

	const result = runLoop({
		runOptions: {
			artifactsDir,
			cwd: repoRoot,
			goal: config.goal,
			mode: "single-pi",
			planPath: config.plan,
			recommendedPlanDir,
			appendedSystemPrompt: readPiTownMayorPrompt(),
			extensionPath: resolvePiTownExtensionPath(),
		},
		stopOnMayorIdleNoWork: true,
	})
	const latestControllerResult = getLatestControllerResult(result)

	const latestPointer = createLatestRunPointer(latestControllerResult, repoSlug, repoRoot)
	writeJson(getLatestRunPointerPath(), latestPointer)
	writeJson(getRepoLatestRunPointerPath(repoSlug), latestPointer)

	console.log("[pitown] autonomous run written")
	console.log(`- loop id: ${result.loopId}`)
	console.log(`- iterations: ${result.totalIterations}`)
	console.log(`- stop reason: ${result.stopReason}`)
	console.log(`- latest run id: ${latestControllerResult.runId}`)
	console.log(`- repo root: ${latestControllerResult.manifest.repoRoot}`)
	console.log(`- branch: ${latestControllerResult.manifest.branch}`)
	console.log(`- artifacts: ${latestControllerResult.runDir}`)
	console.log(`- latest metrics: ${latestPointer.metricsPath}`)
	console.log(`- aggregate interrupt rate: ${result.aggregateMetrics.interruptRate}`)
	console.log(`- aggregate autonomous completion: ${result.aggregateMetrics.autonomousCompletionRate}`)
	console.log(`- latest pi exit code: ${latestControllerResult.piInvocation.exitCode}`)
	if (!latestControllerResult.summary.success) console.log(`- note: ${latestControllerResult.summary.message}`)
	if (latestControllerResult.manifest.planPath) console.log(`- plan path: ${latestControllerResult.manifest.planPath}`)
	if (latestControllerResult.summary.recommendedPlanDir) {
		console.log(`- recommended plans: ${latestControllerResult.summary.recommendedPlanDir}`)
	}

	return result
}

if (isDirectExecution(import.meta.url)) {
	const result = runTown()
	const latestIteration = result.iterations[result.iterations.length - 1]
	if (latestIteration && latestIteration.controllerResult.piInvocation.exitCode !== 0) {
		process.exitCode = latestIteration.controllerResult.piInvocation.exitCode
	}
}

import { existsSync, mkdirSync, statSync } from "node:fs"
import { readPiTownMayorPrompt, resolvePiTownExtensionPath } from "@schilderlabs/pitown-package"
import {
	createRepoSlug,
	getRepoIdentity,
	getRepoRoot,
	runLoop,
	type LoopRunResult,
} from "../../core/src/index.js"
import { resolveLoopConfig } from "./loop-config.js"
import {
	getRecommendedPlanDir,
	getRepoArtifactsDir,
	getTownHomeDir,
} from "./paths.js"

function assertDirectory(path: string, label: string) {
	if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`)
	if (!statSync(path).isDirectory()) throw new Error(`${label} is not a directory: ${path}`)
}

function formatMs(ms: number): string {
	if (ms < 1000) return `${ms}ms`
	return `${(ms / 1000).toFixed(1)}s`
}

export function loopTown(argv = process.argv.slice(2)): LoopRunResult {
	const config = resolveLoopConfig(argv)
	assertDirectory(config.repo, "Target repo")
	if (config.plan) assertDirectory(config.plan, "Plan path")

	const townHome = getTownHomeDir()
	mkdirSync(townHome, { recursive: true })

	const repoRoot = getRepoRoot(config.repo)
	const repoId = getRepoIdentity(repoRoot)
	const repoSlug = createRepoSlug(repoId, repoRoot)
	const recommendedPlanDir = config.plan ? null : getRecommendedPlanDir(repoSlug)
	const artifactsDir = getRepoArtifactsDir(repoSlug)

	console.log(`[pitown-loop] starting loop (max ${config.maxIterations} iterations, ${config.maxTimeMinutes}min wall time)`)

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
		maxIterations: config.maxIterations,
		maxWallTimeMs: config.maxTimeMinutes * 60_000,
		stopOnPiFailure: config.stopOnPiFailure,
		onIterationComplete(iteration) {
			const board = iteration.boardSnapshot
			const taskSummary = board.tasks.length > 0
				? `${board.tasks.length} tasks (${board.tasks.filter((t) => t.status === "completed").length} completed, ${board.tasks.filter((t) => t.status === "running").length} running)`
				: "no tasks tracked"
			const leaderStatus = board.agents.find((a) => a.agentId === "leader")?.status ?? "unknown"

			console.log(`[pitown-loop] iteration ${iteration.iteration}/${config.maxIterations} completed (${formatMs(iteration.elapsedMs)})`)
			console.log(`  - pi exit code: ${iteration.controllerResult.piInvocation.exitCode}`)
			console.log(`  - run: ${iteration.controllerResult.runId}`)
			console.log(`  - board: ${taskSummary}, leader ${leaderStatus}`)
			console.log(`  - metrics: interrupt rate ${iteration.metrics.interruptRate}, autonomous completion ${iteration.metrics.autonomousCompletionRate}`)
			if (iteration.stopReason) {
				console.log(`  - stopping: ${iteration.stopReason}`)
			} else {
				console.log(`  - continuing: ${iteration.continueReason}`)
			}
		},
	})

	console.log(`[pitown-loop] stopped after ${result.totalIterations} iteration${result.totalIterations === 1 ? "" : "s"} (${formatMs(result.totalElapsedMs)} total)`)
	console.log(`  - reason: ${result.stopReason}`)
	console.log(`  - aggregate metrics: interrupt rate ${result.aggregateMetrics.interruptRate}, autonomous completion ${result.aggregateMetrics.autonomousCompletionRate}`)

	return result
}

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { listAgentStates } from "./agents.js"
import { runController } from "./controller.js"
import { appendJsonl } from "./events.js"
import { computeMetrics } from "./metrics.js"
import { listTaskRecords } from "./tasks.js"
import type {
	BoardSnapshot,
	ControllerRunResult,
	LoopIterationResult,
	LoopOptions,
	LoopRunResult,
	LoopStopReason,
	MetricsSnapshot,
} from "./types.js"

const DEFAULT_MAX_ITERATIONS = 10
const DEFAULT_MAX_WALL_TIME_MS = 3_600_000

function createLoopId(): string {
	return `loop-${new Date().toISOString().replace(/[:.]/g, "-")}`
}

function writeJson(path: string, value: unknown) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

export function snapshotBoard(artifactsDir: string): BoardSnapshot {
	const tasks = listTaskRecords(artifactsDir)
	const agents = listAgentStates(artifactsDir)

	const taskEntries = tasks.map((task) => ({ taskId: task.taskId, status: task.status }))
	const agentEntries = agents.map((agent) => ({
		agentId: agent.agentId,
		status: agent.status,
		blocked: agent.blocked,
	}))

	const allTasksCompleted = tasks.length > 0 && tasks.every((task) => task.status === "completed")
	const allRemainingTasksBlocked =
		tasks.length > 0 && tasks.every((task) => task.status === "completed" || task.status === "blocked")

	const mayor = agents.find((agent) => agent.agentId === "mayor")
	const mayorBlocked = mayor?.blocked === true

	const hasQueuedOrRunningWork =
		agents.some((agent) => agent.status === "queued" || agent.status === "running" || agent.status === "starting") ||
		tasks.some((task) => task.status === "queued" || task.status === "running")

	return {
		tasks: taskEntries,
		agents: agentEntries,
		allTasksCompleted,
		allRemainingTasksBlocked,
		mayorBlocked,
		hasQueuedOrRunningWork,
	}
}

export function evaluateStopCondition(input: {
	iteration: number
	maxIterations: number
	elapsedMs: number
	maxWallTimeMs: number
	piExitCode: number
	stopOnPiFailure: boolean
	board: BoardSnapshot
	metrics: MetricsSnapshot
	interruptRateThreshold: number | null
}): { stopReason: LoopStopReason | null; continueReason: string | null } {
	if (input.iteration >= input.maxIterations) {
		return { stopReason: "max-iterations-reached", continueReason: null }
	}

	if (input.elapsedMs >= input.maxWallTimeMs) {
		return { stopReason: "max-wall-time-reached", continueReason: null }
	}

	if (input.stopOnPiFailure && input.piExitCode !== 0) {
		return { stopReason: "pi-exit-nonzero", continueReason: null }
	}

	if (input.board.allTasksCompleted) {
		return { stopReason: "all-tasks-completed", continueReason: null }
	}

	if (input.board.mayorBlocked) {
		return { stopReason: "mayor-blocked", continueReason: null }
	}

	if (input.board.allRemainingTasksBlocked) {
		return { stopReason: "all-remaining-tasks-blocked", continueReason: null }
	}

	if (
		input.interruptRateThreshold !== null &&
		input.metrics.interruptRate > input.interruptRateThreshold
	) {
		return { stopReason: "high-interrupt-rate", continueReason: null }
	}

	const reasons: string[] = []
	if (input.board.hasQueuedOrRunningWork) reasons.push("queued or running work remains")
	if (input.board.tasks.length === 0) reasons.push("no tasks tracked yet")
	if (reasons.length === 0) reasons.push("mayor idle, no stop condition met")

	return { stopReason: null, continueReason: reasons.join("; ") }
}

function aggregateMetrics(iterations: LoopIterationResult[]): MetricsSnapshot {
	if (iterations.length === 0) {
		return computeMetrics({ taskAttempts: [], interrupts: [] })
	}

	let totalTaskAttempts = 0
	let totalCompletedTasks = 0
	let totalInterrupts = 0
	let totalObservedInterruptCategories = 0
	let totalCoveredInterruptCategories = 0
	let interruptRateSum = 0
	let autonomousCompletionRateSum = 0
	let contextCoverageScoreSum = 0
	let mttcValues: number[] = []
	let ftdValues: number[] = []

	for (const iter of iterations) {
		const m = iter.metrics
		totalTaskAttempts += m.totals.taskAttempts
		totalCompletedTasks += m.totals.completedTasks
		totalInterrupts += m.totals.interrupts
		totalObservedInterruptCategories += m.totals.observedInterruptCategories
		totalCoveredInterruptCategories += m.totals.coveredInterruptCategories
		interruptRateSum += m.interruptRate
		autonomousCompletionRateSum += m.autonomousCompletionRate
		contextCoverageScoreSum += m.contextCoverageScore
		if (m.meanTimeToCorrectHours !== null) mttcValues.push(m.meanTimeToCorrectHours)
		if (m.feedbackToDemoCycleTimeHours !== null) ftdValues.push(m.feedbackToDemoCycleTimeHours)
	}

	const count = iterations.length
	const round = (v: number) => Math.round(v * 1000) / 1000
	const avg = (values: number[]) => (values.length === 0 ? null : round(values.reduce((s, v) => s + v, 0) / values.length))

	return {
		interruptRate: round(interruptRateSum / count),
		autonomousCompletionRate: round(autonomousCompletionRateSum / count),
		contextCoverageScore: round(contextCoverageScoreSum / count),
		meanTimeToCorrectHours: avg(mttcValues),
		feedbackToDemoCycleTimeHours: avg(ftdValues),
		totals: {
			taskAttempts: totalTaskAttempts,
			completedTasks: totalCompletedTasks,
			interrupts: totalInterrupts,
			observedInterruptCategories: totalObservedInterruptCategories,
			coveredInterruptCategories: totalCoveredInterruptCategories,
		},
	}
}

export function runLoop(options: LoopOptions): LoopRunResult {
	const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS
	const maxWallTimeMs = options.maxWallTimeMs ?? DEFAULT_MAX_WALL_TIME_MS
	const stopOnPiFailure = options.stopOnPiFailure ?? true
	const interruptRateThreshold = options.interruptRateThreshold ?? null
	const loopId = createLoopId()
	const artifactsDir = options.runOptions.artifactsDir
	const loopDir = join(artifactsDir, "loops", loopId)

	mkdirSync(loopDir, { recursive: true })

	const loopStartedAt = Date.now()
	const iterations: LoopIterationResult[] = []
	let finalStopReason: LoopStopReason = "max-iterations-reached"

	appendJsonl(join(loopDir, "events.jsonl"), {
		type: "loop_started",
		loopId,
		maxIterations,
		maxWallTimeMs,
		stopOnPiFailure,
		createdAt: new Date().toISOString(),
	})

	for (let iteration = 1; iteration <= maxIterations; iteration++) {
		const iterationStart = Date.now()

		let controllerResult: ControllerRunResult
		try {
			controllerResult = runController(options.runOptions)
		} catch (error) {
			// If controller fails to run (e.g. lease issue), record and stop
			appendJsonl(join(loopDir, "events.jsonl"), {
				type: "loop_iteration_error",
				loopId,
				iteration,
				error: (error as Error).message,
				createdAt: new Date().toISOString(),
			})
			finalStopReason = "pi-exit-nonzero"
			break
		}

		const iterationElapsedMs = Date.now() - iterationStart
		const totalElapsedMs = Date.now() - loopStartedAt
		const board = snapshotBoard(artifactsDir)
		const metrics = controllerResult.metrics

		const { stopReason, continueReason } = evaluateStopCondition({
			iteration,
			maxIterations,
			elapsedMs: totalElapsedMs,
			maxWallTimeMs,
			piExitCode: controllerResult.piInvocation.exitCode,
			stopOnPiFailure,
			board,
			metrics,
			interruptRateThreshold,
		})

		const iterationResult: LoopIterationResult = {
			iteration,
			controllerResult,
			boardSnapshot: board,
			metrics,
			elapsedMs: iterationElapsedMs,
			continueReason,
			stopReason,
		}

		iterations.push(iterationResult)

		writeJson(join(loopDir, `iteration-${iteration}.json`), {
			iteration,
			runId: controllerResult.runId,
			boardSnapshot: board,
			metrics,
			elapsedMs: iterationElapsedMs,
			continueReason,
			stopReason,
		})

		appendJsonl(join(loopDir, "events.jsonl"), {
			type: "loop_iteration_completed",
			loopId,
			iteration,
			runId: controllerResult.runId,
			piExitCode: controllerResult.piInvocation.exitCode,
			stopReason,
			continueReason,
			createdAt: new Date().toISOString(),
		})

		if (options.onIterationComplete) {
			options.onIterationComplete(iterationResult)
		}

		if (stopReason !== null) {
			finalStopReason = stopReason
			break
		}
	}

	const totalElapsedMs = Date.now() - loopStartedAt
	const finalBoard = iterations.length > 0 ? iterations[iterations.length - 1].boardSnapshot : snapshotBoard(artifactsDir)
	const aggregate = aggregateMetrics(iterations)

	const loopResult: LoopRunResult = {
		loopId,
		iterations,
		stopReason: finalStopReason,
		totalIterations: iterations.length,
		totalElapsedMs,
		finalBoardSnapshot: finalBoard,
		aggregateMetrics: aggregate,
	}

	writeJson(join(loopDir, "loop-summary.json"), {
		loopId,
		stopReason: finalStopReason,
		totalIterations: iterations.length,
		totalElapsedMs,
		finalBoardSnapshot: finalBoard,
		aggregateMetrics: aggregate,
	})

	appendJsonl(join(loopDir, "events.jsonl"), {
		type: "loop_finished",
		loopId,
		stopReason: finalStopReason,
		totalIterations: iterations.length,
		totalElapsedMs,
		createdAt: new Date().toISOString(),
	})

	return loopResult
}

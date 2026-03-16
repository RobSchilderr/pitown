import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentSessionRecord, createAgentState, writeAgentState } from "./agents.js"
import { readJsonl } from "./events.js"
import { createTaskRecord, writeTaskRecord } from "./tasks.js"
import { evaluateStopCondition, runLoop, snapshotBoard } from "./loop.js"
import type { BoardSnapshot, LoopIterationResult, MetricsSnapshot } from "./types.js"

const originalHome = process.env["HOME"]

afterEach(() => {
	if (originalHome === undefined) delete process.env["HOME"]
	else process.env["HOME"] = originalHome
})

function createFakePi(dir: string, exitCode = 0): string {
	const fakePiPath = join(dir, "fake-pi.sh")
	writeFileSync(
		fakePiPath,
		[
			"#!/bin/sh",
			'printf "pi stdout\\n"',
			'printf "pi stderr\\n" >&2',
			`exit ${exitCode}`,
		].join("\n"),
		"utf-8",
	)
	chmodSync(fakePiPath, 0o755)
	return fakePiPath
}

function emptyMetrics(): MetricsSnapshot {
	return {
		interruptRate: 0,
		autonomousCompletionRate: 0,
		contextCoverageScore: 0,
		meanTimeToCorrectHours: null,
		feedbackToDemoCycleTimeHours: null,
		totals: {
			taskAttempts: 0,
			completedTasks: 0,
			interrupts: 0,
			observedInterruptCategories: 0,
			coveredInterruptCategories: 0,
		},
	}
}

function emptyBoard(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
	return {
		tasks: [],
		agents: [],
		allTasksCompleted: false,
		allRemainingTasksBlocked: false,
		mayorBlocked: false,
		hasQueuedOrRunningWork: false,
		...overrides,
	}
}

describe("evaluateStopCondition", () => {
	it("stops at max iterations", () => {
		const result = evaluateStopCondition({
			iteration: 3,
			maxIterations: 3,
			elapsedMs: 0,
			maxWallTimeMs: 3_600_000,
			piExitCode: 0,
			stopOnPiFailure: true,
			stopOnMayorIdleNoWork: false,
			board: emptyBoard(),
			metrics: emptyMetrics(),
			interruptRateThreshold: null,
		})
		expect(result.stopReason).toBe("max-iterations-reached")
	})

	it("stops at max wall time", () => {
		const result = evaluateStopCondition({
			iteration: 1,
			maxIterations: 10,
			elapsedMs: 4_000_000,
			maxWallTimeMs: 3_600_000,
			piExitCode: 0,
			stopOnPiFailure: true,
			stopOnMayorIdleNoWork: false,
			board: emptyBoard(),
			metrics: emptyMetrics(),
			interruptRateThreshold: null,
		})
		expect(result.stopReason).toBe("max-wall-time-reached")
	})

	it("stops on pi failure when stopOnPiFailure is true", () => {
		const result = evaluateStopCondition({
			iteration: 1,
			maxIterations: 10,
			elapsedMs: 0,
			maxWallTimeMs: 3_600_000,
			piExitCode: 1,
			stopOnPiFailure: true,
			stopOnMayorIdleNoWork: false,
			board: emptyBoard(),
			metrics: emptyMetrics(),
			interruptRateThreshold: null,
		})
		expect(result.stopReason).toBe("pi-exit-nonzero")
	})

	it("continues on pi failure when stopOnPiFailure is false", () => {
		const result = evaluateStopCondition({
			iteration: 1,
			maxIterations: 10,
			elapsedMs: 0,
			maxWallTimeMs: 3_600_000,
			piExitCode: 1,
			stopOnPiFailure: false,
			stopOnMayorIdleNoWork: false,
			board: emptyBoard(),
			metrics: emptyMetrics(),
			interruptRateThreshold: null,
		})
		expect(result.stopReason).toBeNull()
	})

	it("stops when all tasks completed", () => {
		const result = evaluateStopCondition({
			iteration: 1,
			maxIterations: 10,
			elapsedMs: 0,
			maxWallTimeMs: 3_600_000,
			piExitCode: 0,
			stopOnPiFailure: true,
			stopOnMayorIdleNoWork: false,
			board: emptyBoard({ allTasksCompleted: true }),
			metrics: emptyMetrics(),
			interruptRateThreshold: null,
		})
		expect(result.stopReason).toBe("all-tasks-completed")
	})

	it("stops when mayor blocked", () => {
		const result = evaluateStopCondition({
			iteration: 1,
			maxIterations: 10,
			elapsedMs: 0,
			maxWallTimeMs: 3_600_000,
			piExitCode: 0,
			stopOnPiFailure: true,
			stopOnMayorIdleNoWork: false,
			board: emptyBoard({ mayorBlocked: true }),
			metrics: emptyMetrics(),
			interruptRateThreshold: null,
		})
		expect(result.stopReason).toBe("mayor-blocked")
	})

	it("optionally stops when the mayor is idle and no work remains", () => {
		const result = evaluateStopCondition({
			iteration: 1,
			maxIterations: 10,
			elapsedMs: 0,
			maxWallTimeMs: 3_600_000,
			piExitCode: 0,
			stopOnPiFailure: true,
			stopOnMayorIdleNoWork: true,
			board: emptyBoard({
				agents: [{ agentId: "mayor", status: "idle", blocked: false }],
			}),
			metrics: emptyMetrics(),
			interruptRateThreshold: null,
		})
		expect(result.stopReason).toBe("mayor-idle-no-work")
	})

	it("stops when all remaining tasks blocked", () => {
		const result = evaluateStopCondition({
			iteration: 1,
			maxIterations: 10,
			elapsedMs: 0,
			maxWallTimeMs: 3_600_000,
			piExitCode: 0,
			stopOnPiFailure: true,
			stopOnMayorIdleNoWork: false,
			board: emptyBoard({ allRemainingTasksBlocked: true }),
			metrics: emptyMetrics(),
			interruptRateThreshold: null,
		})
		expect(result.stopReason).toBe("all-remaining-tasks-blocked")
	})

	it("stops on high interrupt rate when threshold set", () => {
		const metrics = emptyMetrics()
		metrics.interruptRate = 0.8
		const result = evaluateStopCondition({
			iteration: 1,
			maxIterations: 10,
			elapsedMs: 0,
			maxWallTimeMs: 3_600_000,
			piExitCode: 0,
			stopOnPiFailure: true,
			stopOnMayorIdleNoWork: false,
			board: emptyBoard(),
			metrics,
			interruptRateThreshold: 0.5,
		})
		expect(result.stopReason).toBe("high-interrupt-rate")
	})

	it("continues when no stop condition is met", () => {
		const result = evaluateStopCondition({
			iteration: 1,
			maxIterations: 10,
			elapsedMs: 0,
			maxWallTimeMs: 3_600_000,
			piExitCode: 0,
			stopOnPiFailure: true,
			stopOnMayorIdleNoWork: false,
			board: emptyBoard({ hasQueuedOrRunningWork: true }),
			metrics: emptyMetrics(),
			interruptRateThreshold: null,
		})
		expect(result.stopReason).toBeNull()
		expect(result.continueReason).toContain("queued or running work remains")
	})

	it("priority: max iterations beats all tasks completed", () => {
		const result = evaluateStopCondition({
			iteration: 3,
			maxIterations: 3,
			elapsedMs: 0,
			maxWallTimeMs: 3_600_000,
			piExitCode: 0,
			stopOnPiFailure: true,
			stopOnMayorIdleNoWork: false,
			board: emptyBoard({ allTasksCompleted: true }),
			metrics: emptyMetrics(),
			interruptRateThreshold: null,
		})
		expect(result.stopReason).toBe("max-iterations-reached")
	})
})

describe("snapshotBoard", () => {
	it("returns empty board when no artifacts exist", () => {
		const artifactsDir = mkdtempSync(join(tmpdir(), "pi-town-snap-"))
		const board = snapshotBoard(artifactsDir)
		expect(board.tasks).toEqual([])
		expect(board.agents).toEqual([])
		expect(board.allTasksCompleted).toBe(false)
		expect(board.allRemainingTasksBlocked).toBe(false)
		expect(board.mayorBlocked).toBe(false)
		expect(board.hasQueuedOrRunningWork).toBe(false)
	})

	it("detects all tasks completed", () => {
		const artifactsDir = mkdtempSync(join(tmpdir(), "pi-town-snap-"))
		const tasksDir = join(artifactsDir, "tasks")
		mkdirSync(tasksDir, { recursive: true })
		writeFileSync(
			join(tasksDir, "T-1.json"),
			JSON.stringify({
				taskId: "T-1",
				title: "task one",
				status: "completed",
				role: "dev",
				assignedAgentId: "a1",
				createdBy: "mayor",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			}),
			"utf-8",
		)
		const board = snapshotBoard(artifactsDir)
		expect(board.allTasksCompleted).toBe(true)
		expect(board.tasks).toHaveLength(1)
		expect(board.tasks[0]!.status).toBe("completed")
	})

	it("detects mayor blocked", () => {
		const artifactsDir = mkdtempSync(join(tmpdir(), "pi-town-snap-"))
		const mayorDir = join(artifactsDir, "agents", "mayor")
		mkdirSync(mayorDir, { recursive: true })
		writeFileSync(
			join(mayorDir, "state.json"),
			JSON.stringify({
				agentId: "mayor",
				role: "mayor",
				status: "blocked",
				taskId: null,
				task: null,
				branch: null,
				updatedAt: "2026-01-01T00:00:00.000Z",
				lastMessage: null,
				waitingOn: "human",
				blocked: true,
				runId: null,
				session: { runtime: "pi", persisted: true, sessionDir: null, sessionId: null, sessionPath: null, processId: null, lastAttachedAt: null },
			}),
			"utf-8",
		)
		const board = snapshotBoard(artifactsDir)
		expect(board.mayorBlocked).toBe(true)
	})

	it("detects queued or running work", () => {
		const artifactsDir = mkdtempSync(join(tmpdir(), "pi-town-snap-"))
		const tasksDir = join(artifactsDir, "tasks")
		mkdirSync(tasksDir, { recursive: true })
		writeFileSync(
			join(tasksDir, "T-1.json"),
			JSON.stringify({
				taskId: "T-1",
				title: "task one",
				status: "running",
				role: "dev",
				assignedAgentId: "a1",
				createdBy: "mayor",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			}),
			"utf-8",
		)
		const board = snapshotBoard(artifactsDir)
		expect(board.hasQueuedOrRunningWork).toBe(true)
	})
})

describe("runLoop", () => {
	it("stops at max iterations", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-town-loop-"))
		process.env["HOME"] = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		const artifactsDir = join(cwd, "state")
		const fakePiPath = createFakePi(cwd, 0)

		const result = runLoop({
			runOptions: {
				artifactsDir,
				cwd,
				goal: "test goal",
				mode: "single-pi",
				piCommand: fakePiPath,
			},
			maxIterations: 3,
		})

		expect(result.totalIterations).toBe(3)
		expect(result.stopReason).toBe("max-iterations-reached")
		expect(result.iterations).toHaveLength(3)
	})

	it("stops on pi failure when stopOnPiFailure is true", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-town-loop-"))
		process.env["HOME"] = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		const artifactsDir = join(cwd, "state")
		const fakePiPath = createFakePi(cwd, 1)

		const result = runLoop({
			runOptions: {
				artifactsDir,
				cwd,
				goal: "test goal",
				mode: "single-pi",
				piCommand: fakePiPath,
			},
			maxIterations: 5,
			stopOnPiFailure: true,
		})

		expect(result.totalIterations).toBe(1)
		expect(result.stopReason).toBe("pi-exit-nonzero")
	})

	it("continues on pi failure when stopOnPiFailure is false", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-town-loop-"))
		process.env["HOME"] = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		const artifactsDir = join(cwd, "state")
		const fakePiPath = createFakePi(cwd, 1)

		const result = runLoop({
			runOptions: {
				artifactsDir,
				cwd,
				goal: "test goal",
				mode: "single-pi",
				piCommand: fakePiPath,
			},
			maxIterations: 2,
			stopOnPiFailure: false,
		})

		// Should run all 2 iterations despite exit code 1
		// Mayor becomes blocked after exit code 1, so it stops on mayor-blocked
		expect(result.totalIterations).toBeLessThanOrEqual(2)
		expect(["max-iterations-reached", "mayor-blocked"]).toContain(result.stopReason)
	})

	it("respects wall time limit", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-town-loop-"))
		process.env["HOME"] = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		const artifactsDir = join(cwd, "state")
		const fakePiPath = createFakePi(cwd, 0)

		const result = runLoop({
			runOptions: {
				artifactsDir,
				cwd,
				goal: "test goal",
				mode: "single-pi",
				piCommand: fakePiPath,
			},
			maxIterations: 100,
			maxWallTimeMs: 1,
		})

		// First iteration runs, then wall time check kicks in
		expect(result.totalIterations).toBeGreaterThanOrEqual(1)
		expect(result.stopReason).toBe("max-wall-time-reached")
	})

	it("stops when all tasks are completed", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-town-loop-"))
		process.env["HOME"] = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		const artifactsDir = join(cwd, "state")
		const fakePiPath = createFakePi(cwd, 0)

		// Pre-populate a completed task
		const tasksDir = join(artifactsDir, "tasks")
		mkdirSync(tasksDir, { recursive: true })
		writeFileSync(
			join(tasksDir, "T-1.json"),
			JSON.stringify({
				taskId: "T-1",
				title: "task one",
				status: "completed",
				role: "dev",
				assignedAgentId: "a1",
				createdBy: "mayor",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			}),
			"utf-8",
		)

		const result = runLoop({
			runOptions: {
				artifactsDir,
				cwd,
				goal: "test goal",
				mode: "single-pi",
				piCommand: fakePiPath,
			},
			maxIterations: 10,
		})

		expect(result.stopReason).toBe("all-tasks-completed")
		expect(result.totalIterations).toBe(1)
	})

	it("waits for background workers to settle before giving the mayor a follow-up turn", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-town-loop-"))
		process.env["HOME"] = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		const artifactsDir = join(cwd, "state")
		const fakePiPath = createFakePi(cwd, 0)

		writeAgentState(
			artifactsDir,
			createAgentState({
				agentId: "worker-001",
				role: "worker",
				status: "running",
				taskId: "task-001",
				task: "finish the auth fix",
				lastMessage: "working",
				session: createAgentSessionRecord(),
			}),
		)
		writeTaskRecord(
			artifactsDir,
			createTaskRecord({
				taskId: "task-001",
				title: "finish the auth fix",
				status: "running",
				role: "worker",
				assignedAgentId: "worker-001",
				createdBy: "mayor",
			}),
		)

		const result = runLoop({
			runOptions: {
				artifactsDir,
				cwd,
				goal: "test goal",
				mode: "single-pi",
				piCommand: fakePiPath,
			},
			maxIterations: 3,
			onIterationComplete(iteration) {
				if (iteration.iteration !== 1) return

				writeAgentState(
					artifactsDir,
					createAgentState({
						agentId: "worker-001",
						role: "worker",
						status: "idle",
						taskId: "task-001",
						task: "finish the auth fix",
						lastMessage: "done",
						session: createAgentSessionRecord(),
					}),
				)
				writeTaskRecord(
					artifactsDir,
					createTaskRecord({
						taskId: "task-001",
						title: "finish the auth fix",
						status: "completed",
						role: "worker",
						assignedAgentId: "worker-001",
						createdBy: "mayor",
					}),
				)
			},
		})

		expect(result.totalIterations).toBe(2)
		expect(result.stopReason).toBe("all-tasks-completed")
		expect(result.iterations[0]?.continueReason).toContain("queued or running work remains")
		expect(result.iterations[1]?.stopReason).toBe("all-tasks-completed")
	})

	it("calls onIterationComplete for each iteration", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-town-loop-"))
		process.env["HOME"] = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		const artifactsDir = join(cwd, "state")
		const fakePiPath = createFakePi(cwd, 0)
		const callbacks: LoopIterationResult[] = []

		runLoop({
			runOptions: {
				artifactsDir,
				cwd,
				goal: "test goal",
				mode: "single-pi",
				piCommand: fakePiPath,
			},
			maxIterations: 2,
			onIterationComplete(iteration) {
				callbacks.push(iteration)
			},
		})

		expect(callbacks).toHaveLength(2)
		expect(callbacks[0]!.iteration).toBe(1)
		expect(callbacks[1]!.iteration).toBe(2)
	})

	it("writes distinct loop artifacts per iteration", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-town-loop-"))
		process.env["HOME"] = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		const artifactsDir = join(cwd, "state")
		const fakePiPath = createFakePi(cwd, 0)

		const result = runLoop({
			runOptions: {
				artifactsDir,
				cwd,
				goal: "test goal",
				mode: "single-pi",
				piCommand: fakePiPath,
			},
			maxIterations: 2,
		})

		const loopDir = join(artifactsDir, "loops", result.loopId)
		expect(existsSync(join(loopDir, "iteration-1.json"))).toBe(true)
		expect(existsSync(join(loopDir, "iteration-2.json"))).toBe(true)
		expect(existsSync(join(loopDir, "loop-summary.json"))).toBe(true)

		const events = readJsonl<{ type: string }>(join(loopDir, "events.jsonl"))
		const types = events.map((e) => e.type)
		expect(types[0]).toBe("loop_started")
		expect(types.filter((t) => t === "loop_iteration_completed")).toHaveLength(2)
		expect(types[types.length - 1]).toBe("loop_finished")
	})

	it("each iteration produces a distinct run artifact", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-town-loop-"))
		process.env["HOME"] = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		const artifactsDir = join(cwd, "state")
		const fakePiPath = createFakePi(cwd, 0)

		const result = runLoop({
			runOptions: {
				artifactsDir,
				cwd,
				goal: "test goal",
				mode: "single-pi",
				piCommand: fakePiPath,
			},
			maxIterations: 2,
		})

		const runIds = result.iterations.map((i) => i.controllerResult.runId)
		expect(new Set(runIds).size).toBe(2)

		for (const iter of result.iterations) {
			expect(existsSync(iter.controllerResult.runDir)).toBe(true)
		}
	})

	it("aggregates metrics across iterations", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-town-loop-"))
		process.env["HOME"] = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		const artifactsDir = join(cwd, "state")
		const fakePiPath = createFakePi(cwd, 0)

		const result = runLoop({
			runOptions: {
				artifactsDir,
				cwd,
				goal: "test goal",
				mode: "single-pi",
				piCommand: fakePiPath,
			},
			maxIterations: 3,
		})

		expect(result.aggregateMetrics).toBeDefined()
		expect(result.aggregateMetrics.interruptRate).toBe(0)
		expect(result.aggregateMetrics.totals.taskAttempts).toBe(0)
	})

	it("loop summary is written with correct data", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-town-loop-"))
		process.env["HOME"] = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		const artifactsDir = join(cwd, "state")
		const fakePiPath = createFakePi(cwd, 0)

		const result = runLoop({
			runOptions: {
				artifactsDir,
				cwd,
				goal: "test goal",
				mode: "single-pi",
				piCommand: fakePiPath,
			},
			maxIterations: 2,
		})

		const loopDir = join(artifactsDir, "loops", result.loopId)
		const summary = JSON.parse(readFileSync(join(loopDir, "loop-summary.json"), "utf-8")) as {
			loopId: string
			stopReason: string
			totalIterations: number
		}
		expect(summary.loopId).toBe(result.loopId)
		expect(summary.stopReason).toBe("max-iterations-reached")
		expect(summary.totalIterations).toBe(2)
	})
})

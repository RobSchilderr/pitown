import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { appendJsonl } from "./events.js"
import { acquireRepoLease } from "./lease.js"
import { computeMetrics } from "./metrics.js"
import { createRepoSlug, getCurrentBranch, getRepoIdentity, getRepoRoot } from "./repo.js"
import { assertCommandAvailable, runCommandSync } from "./shell.js"
import type { ControllerRunResult, PiInvocationRecord, RunManifest, RunOptions, RunSummary } from "./types.js"

function createRunId(): string {
	return `run-${new Date().toISOString().replace(/[:.]/g, "-")}`
}

function writeJson(path: string, value: unknown) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

function writeText(path: string, value: string) {
	writeFileSync(path, value, "utf-8")
}

function createPiPrompt(input: {
	repoRoot: string
	planPath: string | null
	goal: string | null
	recommendedPlanDir: string | null
}): string {
	const goal = input.goal ?? "continue from current scaffold state"

	if (input.planPath) {
		return [
			"Read the private plans in:",
			`- ${input.planPath}`,
			"",
			"and the current code in:",
			`- ${input.repoRoot}`,
			"",
			`Goal: ${goal}`,
			"Continue from the current scaffold state.",
			"Keep any persisted run artifacts high-signal and avoid copying private plan contents into them.",
		].join("\n")
	}

	return [
		`Work in the repository at: ${input.repoRoot}`,
		`Goal: ${goal}`,
		"No private plan path is configured for this run.",
		input.recommendedPlanDir
			? `If you need private plans, use a user-owned location such as: ${input.recommendedPlanDir}`
			: "If you need private plans, keep them in a user-owned location outside the repo.",
		"Continue from the current scaffold state.",
	].join("\n")
}

function assertPiRuntimeAvailable(piCommand: string) {
	try {
		assertCommandAvailable(piCommand)
	} catch (error) {
		if (piCommand === "pi") {
			throw new Error(
				[
					"Pi Town requires the `pi` CLI to run `pitown run`.",
					"Install Pi: npm install -g @mariozechner/pi-coding-agent",
					"Then authenticate Pi and verify it works: pi -p \"hello\"",
					`Details: ${(error as Error).message}`,
				].join("\n"),
			)
		}

		throw new Error(
			[
				`Pi Town could not execute the configured Pi command: ${piCommand}`,
				"Make sure the command exists on PATH or points to an executable file.",
				`Details: ${(error as Error).message}`,
			].join("\n"),
		)
	}
}

function createManifest(input: {
	runId: string
	repoId: string
	repoSlug: string
	repoRoot: string
	branch: string
	goal: string | null
	planPath: string | null
	recommendedPlanDir: string | null
	mode: "single-pi"
	leasePath: string
}): RunManifest {
	return {
		runId: input.runId,
		repoId: input.repoId,
		repoSlug: input.repoSlug,
		repoRoot: input.repoRoot,
		branch: input.branch,
		goal: input.goal,
		planPath: input.planPath,
		recommendedPlanDir: input.recommendedPlanDir,
		mode: input.mode,
		startedAt: new Date().toISOString(),
		endedAt: null,
		stopReason: null,
		leasePath: input.leasePath,
		piExitCode: null,
		completedTaskCount: 0,
		blockedTaskCount: 0,
		skippedTaskCount: 0,
		totalCostUsd: 0,
	}
}

function createSummary(input: {
	runId: string
	mode: "single-pi"
	exitCode: number
	recommendedPlanDir: string | null
}): RunSummary {
	const success = input.exitCode === 0
	const recommendation =
		input.recommendedPlanDir === null
			? ""
			: ` No plan path was configured. Recommended private plans location: ${input.recommendedPlanDir}.`

	return {
		runId: input.runId,
		mode: input.mode,
		createdAt: new Date().toISOString(),
		success,
		message: success ? `Pi invocation completed.${recommendation}` : `Pi invocation failed.${recommendation}`,
		piExitCode: input.exitCode,
		recommendedPlanDir: input.recommendedPlanDir,
	}
}

export function runController(options: RunOptions): ControllerRunResult {
	const cwd = options.cwd ?? process.cwd()
	const artifactsDir = options.artifactsDir
	const repoRoot = getRepoRoot(cwd)
	const repoId = getRepoIdentity(repoRoot)
	const repoSlug = createRepoSlug(repoId, repoRoot)
	const branch = options.branch ?? getCurrentBranch(repoRoot) ?? "workspace"
	const goal = options.goal ?? null
	const planPath = options.planPath ?? null
	const recommendedPlanDir = planPath ? null : (options.recommendedPlanDir ?? null)
	const mode = options.mode ?? "single-pi"
	const piCommand = options.piCommand ?? "pi"
	const runId = createRunId()
	const runDir = join(artifactsDir, "runs", runId)
	const latestDir = join(artifactsDir, "latest")
	const stdoutPath = join(runDir, "stdout.txt")
	const stderrPath = join(runDir, "stderr.txt")
	const prompt = createPiPrompt({ repoRoot, planPath, goal, recommendedPlanDir })

	assertPiRuntimeAvailable(piCommand)

	mkdirSync(runDir, { recursive: true })
	mkdirSync(latestDir, { recursive: true })

	writeText(join(runDir, "questions.jsonl"), "")
	writeText(join(runDir, "interventions.jsonl"), "")
	writeJson(join(runDir, "agent-state.json"), {
		status: "starting",
		updatedAt: new Date().toISOString(),
	})

	const lease = acquireRepoLease(runId, repoId, branch)

	try {
		const manifest = createManifest({
			runId,
			repoId,
			repoSlug,
			repoRoot,
			branch,
			goal,
			planPath,
			recommendedPlanDir,
			mode,
			leasePath: lease.path,
		})

		appendJsonl(join(runDir, "events.jsonl"), {
			type: "run_started",
			runId,
			repoId,
			repoSlug,
			branch,
			createdAt: manifest.startedAt,
		})

		const piStartedAt = new Date().toISOString()
		appendJsonl(join(runDir, "events.jsonl"), {
			type: "pi_invocation_started",
			runId,
			command: piCommand,
			createdAt: piStartedAt,
		})

		const piResult = runCommandSync(piCommand, ["--no-session", "-p", prompt], {
			cwd: repoRoot,
			env: process.env,
		})
		const piEndedAt = new Date().toISOString()

		writeText(stdoutPath, piResult.stdout)
		writeText(stderrPath, piResult.stderr)

		const piInvocation: PiInvocationRecord = {
			command: piCommand,
			cwd: repoRoot,
			repoRoot,
			planPath,
			goal,
			startedAt: piStartedAt,
			endedAt: piEndedAt,
			exitCode: piResult.exitCode,
			stdoutPath,
			stderrPath,
			promptSummary: planPath
				? "Read private plan path and continue from current scaffold state."
				: "Continue from current scaffold state without a configured private plan path.",
		}
		writeJson(join(runDir, "pi-invocation.json"), piInvocation)

		appendJsonl(join(runDir, "events.jsonl"), {
			type: "pi_invocation_finished",
			runId,
			command: piCommand,
			exitCode: piInvocation.exitCode,
			createdAt: piEndedAt,
		})

		const metrics = computeMetrics({
			taskAttempts: [],
			interrupts: [],
		})
		const summary = createSummary({
			runId,
			mode,
			exitCode: piInvocation.exitCode,
			recommendedPlanDir,
		})
		const finalManifest: RunManifest = {
			...manifest,
			endedAt: piEndedAt,
			stopReason:
				piInvocation.exitCode === 0
					? "pi invocation completed"
					: `pi invocation exited with code ${piInvocation.exitCode}`,
			piExitCode: piInvocation.exitCode,
		}

		writeJson(join(runDir, "manifest.json"), finalManifest)
		writeJson(join(runDir, "metrics.json"), metrics)
		writeJson(join(runDir, "run-summary.json"), summary)
		writeJson(join(runDir, "agent-state.json"), {
			status: summary.success ? "completed" : "failed",
			updatedAt: piEndedAt,
			exitCode: piInvocation.exitCode,
		})
		writeJson(join(latestDir, "manifest.json"), finalManifest)
		writeJson(join(latestDir, "metrics.json"), metrics)
		writeJson(join(latestDir, "run-summary.json"), summary)

		appendJsonl(join(runDir, "events.jsonl"), {
			type: "run_finished",
			runId,
			createdAt: finalManifest.endedAt,
			stopReason: finalManifest.stopReason,
			metrics,
		})

		return {
			runId,
			runDir,
			latestDir,
			manifest: finalManifest,
			metrics,
			summary,
			piInvocation,
		}
	} finally {
		lease.release()
	}
}

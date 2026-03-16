import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import {
	appendAgentMessage,
	createAgentSessionRecord,
	createAgentState,
	getAgentDir,
	getAgentSessionsDir,
	getLatestAgentSession,
	readAgentState,
	writeAgentState,
} from "./agents.js"
import { createTaskRecord, updateTaskRecordStatus, writeTaskRecord } from "./tasks.js"
import { assertCommandAvailable, runCommandSync } from "./shell.js"
import type { AgentSessionRecord, AgentStateSnapshot, TaskRecord } from "./types.js"

export interface SpawnAgentRunOptions {
	repoRoot: string
	artifactsDir: string
	role: string
	agentId: string
	task: string | null
	appendedSystemPrompt?: string | null | undefined
	extensionPath?: string | null | undefined
	taskId?: string | null | undefined
}

export interface SpawnAgentRunResult {
	launch: {
		processId: number
		startedAt: string
	}
	latestSession: AgentSessionRecord
}

export interface DelegateTaskOptions {
	repoRoot: string
	artifactsDir: string
	fromAgentId: string
	role: string
	agentId?: string | null | undefined
	appendedSystemPrompt?: string | null | undefined
	extensionPath?: string | null | undefined
	task: string
}

export interface DelegateTaskResult {
	task: TaskRecord
	agentId: string
	launch: SpawnAgentRunResult["launch"]
	latestSession: AgentSessionRecord
}

export interface ResolvedAgentSession {
	state: AgentStateSnapshot
	session: AgentSessionRecord
}

export interface RunAgentTurnOptions {
	repoRoot: string
	artifactsDir: string
	agentId: string
	message: string
	from?: string
	runtimeArgs?: string[] | null
}

export interface RunAgentTurnResult {
	piResult: { stdout: string; stderr: string; exitCode: number }
	latestSession: AgentSessionRecord
	completionMessage: string
}

function createPiInvocationArgs(input: {
	sessionDir?: string | null
	sessionPath?: string | null
	prompt?: string | null
	appendedSystemPrompt?: string | null | undefined
	extensionPath?: string | null | undefined
}): string[] {
	const args: string[] = []

	if (input.extensionPath) args.push("--extension", input.extensionPath)
	if (input.appendedSystemPrompt) args.push("--append-system-prompt", input.appendedSystemPrompt)
	if (input.sessionPath) args.push("--session", input.sessionPath)
	else if (input.sessionDir) args.push("--session-dir", input.sessionDir)
	else throw new Error("Pi invocation requires a session path or session directory")
	if (input.prompt) args.push("-p", input.prompt)

	return args
}

function createDetachedRunnerInvocation(encodedPayload: string): { command: string; args: string[] } {
	const modulePath = fileURLToPath(import.meta.url)
	if (modulePath.endsWith(".ts")) {
		const require = createRequire(import.meta.url)
		return {
			command: process.execPath,
			args: ["--import", require.resolve("tsx"), fileURLToPath(new URL("./agent-runner.ts", import.meta.url)), encodedPayload],
		}
	}

	return {
		command: process.execPath,
		args: [fileURLToPath(new URL("./agent-runner.mjs", import.meta.url)), encodedPayload],
	}
}

export function createRolePrompt(input: { role: string; task: string | null; repoRoot: string }): string {
	const task = input.task ?? "pick the next bounded task from the current repo context"

	switch (input.role) {
		case "mayor":
			return [
				"You are the Pi Town mayor.",
				"You coordinate work for this repository and act as the primary human-facing agent.",
				"",
				`Repository: ${input.repoRoot}`,
				`Task: ${task}`,
				"Keep updates concise, choose bounded next steps, and leave a durable artifact trail.",
			].join("\n")
		case "reviewer":
			return [
				"You are the Pi Town reviewer.",
				"You review work for correctness, safety, and completeness.",
				"",
				`Repository: ${input.repoRoot}`,
				`Task: ${task}`,
				"Focus on validation confidence, regressions, and whether the output is ready for a human handoff.",
			].join("\n")
		case "docs-keeper":
			return [
				"You are the Pi Town docs keeper.",
				"You summarize outcomes, blockers, and continuity in compact factual language.",
				"",
				`Repository: ${input.repoRoot}`,
				`Task: ${task}`,
				"Keep the output concise and useful for the next run or human review.",
			].join("\n")
		default:
			return [
				"You are the Pi Town worker.",
				"You implement one bounded task at a time.",
				"",
				`Repository: ${input.repoRoot}`,
				`Task: ${task}`,
				"Keep scope tight, prefer explicit validations, and summarize what changed and what still needs follow-up.",
			].join("\n")
	}
}

export function resolveAgentSession(agentId: string, artifactsDir: string): ResolvedAgentSession {
	const state = readAgentState(artifactsDir, agentId)
	if (state === null) throw new Error(`Unknown agent: ${agentId}`)

	const latestSession = getLatestAgentSession(artifactsDir, agentId)
	const sessionPath = state.session.sessionPath ?? latestSession.sessionPath
	const sessionId = state.session.sessionId ?? latestSession.sessionId
	const sessionDir = state.session.sessionDir ?? latestSession.sessionDir ?? getAgentSessionsDir(artifactsDir, agentId)

	if (sessionPath === null) {
		throw new Error(`Agent ${agentId} does not have a persisted Pi session yet.`)
	}

	return {
		state,
		session: createAgentSessionRecord({
			sessionDir,
			sessionId,
			sessionPath,
			processId: state.session.processId,
			lastAttachedAt: new Date().toISOString(),
		}),
	}
}

export function queueAgentMessage(input: { artifactsDir: string; agentId: string; from: string; body: string }) {
	const state = readAgentState(input.artifactsDir, input.agentId)
	if (state === null) throw new Error(`Unknown agent: ${input.agentId}`)

	appendAgentMessage({
		artifactsDir: input.artifactsDir,
		agentId: input.agentId,
		box: "inbox",
		from: input.from,
		body: input.body,
	})

	writeAgentState(
		input.artifactsDir,
		createAgentState({
			...state,
			status: state.status === "idle" ? "queued" : state.status,
			lastMessage: input.body,
			waitingOn: null,
			blocked: false,
			session: createAgentSessionRecord({
				sessionDir: state.session.sessionDir ?? getAgentSessionsDir(input.artifactsDir, input.agentId),
				sessionId: state.session.sessionId,
				sessionPath: state.session.sessionPath,
				processId: state.session.processId,
				lastAttachedAt: state.session.lastAttachedAt,
			}),
		}),
	)
}

export function updateAgentStatus(input: {
	artifactsDir: string
	agentId: string
	status: "queued" | "running" | "idle" | "blocked" | "completed" | "failed" | "stopped"
	lastMessage?: string | null
	waitingOn?: string | null
	blocked?: boolean
}) {
	const state = readAgentState(input.artifactsDir, input.agentId)
	if (state === null) throw new Error(`Unknown agent: ${input.agentId}`)

	if (state.taskId) {
		const taskStatus =
			input.status === "completed"
				? "completed"
				: input.status === "blocked" || input.status === "failed"
					? "blocked"
					: input.status === "stopped"
						? "aborted"
					: input.status === "running" || input.status === "queued"
						? "running"
						: null
		if (taskStatus) updateTaskRecordStatus(input.artifactsDir, state.taskId, taskStatus)
	}

	writeAgentState(
		input.artifactsDir,
		createAgentState({
			...state,
			status: input.status,
			lastMessage: input.lastMessage ?? state.lastMessage,
			waitingOn: input.waitingOn ?? state.waitingOn,
			blocked: input.blocked ?? state.blocked,
			session: state.session,
		}),
	)
}

export function spawnAgentRun(options: SpawnAgentRunOptions): SpawnAgentRunResult {
	const sessionDir = getAgentSessionsDir(options.artifactsDir, options.agentId)

	if (readAgentState(options.artifactsDir, options.agentId) !== null) {
		throw new Error(`Agent already exists: ${options.agentId}`)
	}

	assertCommandAvailable("pi")

	const state = createAgentState({
		agentId: options.agentId,
		role: options.role,
		status: "queued",
		taskId: options.taskId ?? null,
		task: options.task,
		lastMessage: options.task ? `Spawned with task: ${options.task}` : `Spawned ${options.role} agent`,
		session: createAgentSessionRecord({
			sessionDir,
		}),
	})
	writeAgentState(options.artifactsDir, state)
	if (options.task) {
		appendAgentMessage({
			artifactsDir: options.artifactsDir,
			agentId: options.agentId,
			box: "inbox",
			from: "system",
			body: options.task,
		})
	}

	writeAgentState(
		options.artifactsDir,
		createAgentState({
			...state,
			status: "running",
			lastMessage: options.task ? `Running ${options.role} task: ${options.task}` : `Running ${options.role} agent`,
		}),
	)

	const prompt = createRolePrompt({ role: options.role, task: options.task, repoRoot: options.repoRoot })
	const piArgs = createPiInvocationArgs({
		sessionDir,
		prompt,
		appendedSystemPrompt: options.appendedSystemPrompt,
		extensionPath: options.extensionPath,
	})
	const startedAt = new Date().toISOString()
	const encodedPayload = Buffer.from(
		JSON.stringify({
			repoRoot: options.repoRoot,
			artifactsDir: options.artifactsDir,
			agentId: options.agentId,
			role: options.role,
			task: options.task,
			taskId: options.taskId ?? null,
			sessionDir,
			piArgs,
		}),
		"utf-8",
	).toString("base64url")
	const runner = createDetachedRunnerInvocation(encodedPayload)
	const child = spawn(runner.command, runner.args, {
		cwd: options.repoRoot,
		detached: true,
		env: process.env,
		stdio: "ignore",
	})
	child.unref()

	if (!child.pid) {
		throw new Error(`Failed to launch detached ${options.role} run for ${options.agentId}`)
	}

	writeFileSync(
		`${getAgentDir(options.artifactsDir, options.agentId)}/latest-invocation.json`,
		`${JSON.stringify(
			{
				command: "pi",
				args: piArgs,
				exitCode: null,
				sessionDir,
				sessionPath: null,
				sessionId: null,
				processId: child.pid,
				startedAt,
			},
			null,
			2,
		)}\n`,
		"utf-8",
	)

	return {
		launch: {
			processId: child.pid,
			startedAt,
		},
		latestSession: createAgentSessionRecord({
			sessionDir,
		}),
	}
}

export function runAgentTurn(options: RunAgentTurnOptions): RunAgentTurnResult {
	assertCommandAvailable("pi")

	const resolved = resolveAgentSession(options.agentId, options.artifactsDir)
	const messageSource = options.from ?? "human"
	writeAgentState(
		options.artifactsDir,
		createAgentState({
			...resolved.state,
			status: "running",
			lastMessage: `Responding to ${messageSource}: ${options.message}`,
			waitingOn: null,
			blocked: false,
			session: resolved.session,
		}),
	)

	const piArgs =
		options.runtimeArgs && options.runtimeArgs.length > 0
			? options.runtimeArgs
			: createPiInvocationArgs({
					sessionPath: resolved.session.sessionPath,
					prompt: options.message,
				})
	const piResult = runCommandSync("pi", piArgs, {
		cwd: options.repoRoot,
		env: process.env,
	})
	const latestSession = getLatestAgentSession(options.artifactsDir, options.agentId)
	const agentArtifactsDir = getAgentDir(options.artifactsDir, options.agentId)
	writeFileSync(`${agentArtifactsDir}/latest-stdout.txt`, piResult.stdout, "utf-8")
	writeFileSync(`${agentArtifactsDir}/latest-stderr.txt`, piResult.stderr, "utf-8")
	writeFileSync(
		`${agentArtifactsDir}/latest-invocation.json`,
		`${JSON.stringify(
			{
				command: "pi",
				args: piArgs,
				exitCode: piResult.exitCode,
				sessionDir: latestSession.sessionDir,
				sessionPath: latestSession.sessionPath,
				sessionId: latestSession.sessionId,
			},
			null,
			2,
		)}\n`,
		"utf-8",
	)

	const completionMessage =
		piResult.stdout.trim() ||
		(piResult.exitCode === 0
			? `${resolved.state.role} turn completed`
			: `${resolved.state.role} turn exited with code ${piResult.exitCode}`)
	appendAgentMessage({
		artifactsDir: options.artifactsDir,
		agentId: options.agentId,
		box: "outbox",
		from: options.agentId,
		body: completionMessage,
	})

	writeAgentState(
		options.artifactsDir,
		createAgentState({
			...resolved.state,
			status: piResult.exitCode === 0 ? "idle" : "blocked",
			lastMessage: completionMessage,
			waitingOn: piResult.exitCode === 0 ? null : "human-or-follow-up-run",
			blocked: piResult.exitCode !== 0,
			session: createAgentSessionRecord({
				sessionDir: latestSession.sessionDir,
				sessionId: latestSession.sessionId,
				sessionPath: latestSession.sessionPath,
				processId: null,
			}),
		}),
	)

	return { piResult, latestSession, completionMessage }
}

export function delegateTask(options: DelegateTaskOptions): DelegateTaskResult {
	const fromState = readAgentState(options.artifactsDir, options.fromAgentId)
	if (fromState === null) throw new Error(`Unknown delegating agent: ${options.fromAgentId}`)

	const agentId = options.agentId ?? `${options.role}-${Date.now()}`
	const task = createTaskRecord({
		taskId: `task-${Date.now()}`,
		title: options.task,
		status: "queued",
		role: options.role,
		assignedAgentId: agentId,
		createdBy: options.fromAgentId,
	})
	writeTaskRecord(options.artifactsDir, task)

	appendAgentMessage({
		artifactsDir: options.artifactsDir,
		agentId: options.fromAgentId,
		box: "outbox",
		from: options.fromAgentId,
		body: `Delegated ${task.taskId} to ${agentId}: ${options.task}`,
	})

	const { launch, latestSession } = spawnAgentRun({
		repoRoot: options.repoRoot,
		artifactsDir: options.artifactsDir,
		role: options.role,
		agentId,
		appendedSystemPrompt: options.appendedSystemPrompt,
		extensionPath: options.extensionPath,
		task: options.task,
		taskId: task.taskId,
	})

	appendAgentMessage({
		artifactsDir: options.artifactsDir,
		agentId,
		box: "inbox",
		from: options.fromAgentId,
		body: `Delegated by ${options.fromAgentId} as ${task.taskId}: ${options.task}`,
	})

	writeTaskRecord(options.artifactsDir, {
		...task,
		status: "running",
		updatedAt: new Date().toISOString(),
	})

	return {
		task: {
			...task,
			status: "running",
			updatedAt: new Date().toISOString(),
		},
		agentId,
		launch,
		latestSession,
	}
}

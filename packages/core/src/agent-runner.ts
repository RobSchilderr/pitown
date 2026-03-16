import { spawn } from "node:child_process"
import { createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { finished } from "node:stream/promises"
import {
	appendAgentMessage,
	createAgentSessionRecord,
	createAgentState,
	getAgentDir,
	getLatestAgentSession,
	readAgentState,
	writeAgentState,
} from "./agents.js"
import { notifyTaskDelegator, resumeAgentTurnDetached } from "./orchestration.js"
import { updateTaskRecordStatus } from "./tasks.js"

interface DetachedAgentRunPayload {
	kind?: "spawn"
	repoRoot: string
	artifactsDir: string
	agentId: string
	role: string
	task: string | null
	taskId: string | null
	sessionDir: string
	piArgs: string[]
	autoResumeTarget?: {
		agentId: string
		message: string
		appendedSystemPrompt?: string | null
		extensionPath?: string | null
	} | null
}

interface DetachedAgentTurnPayload {
	kind: "turn"
	repoRoot: string
	artifactsDir: string
	agentId: string
	role: string
	message: string
	from: string
	piArgs: string[]
	wakeLockPath: string
}

interface ChildCompletion {
	exitCode: number
	error: Error | null
}

async function waitForChild(child: ReturnType<typeof spawn>): Promise<ChildCompletion> {
	return new Promise((resolve) => {
		let error: Error | null = null
		child.once("error", (value) => {
			error = value
		})
		child.once("close", (code) => {
			resolve({
				exitCode: code ?? 1,
				error,
			})
		})
	})
}

async function runDetachedAgent(payload: DetachedAgentRunPayload) {
	const startedAt = new Date().toISOString()
	const agentArtifactsDir = getAgentDir(payload.artifactsDir, payload.agentId)
	const stdoutPath = `${agentArtifactsDir}/latest-stdout.txt`
	const stderrPath = `${agentArtifactsDir}/latest-stderr.txt`
	const invocationPath = `${agentArtifactsDir}/latest-invocation.json`
	mkdirSync(agentArtifactsDir, { recursive: true })

	const stdoutStream = createWriteStream(stdoutPath, { encoding: "utf-8" })
	const stderrStream = createWriteStream(stderrPath, { encoding: "utf-8" })
	const child = spawn("pi", payload.piArgs, {
		cwd: payload.repoRoot,
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	})

	if (child.stdout) child.stdout.pipe(stdoutStream)
	if (child.stderr) child.stderr.pipe(stderrStream)

	const currentState = readAgentState(payload.artifactsDir, payload.agentId)
	if (currentState) {
		writeAgentState(
			payload.artifactsDir,
			createAgentState({
				...currentState,
				status: "running",
				lastMessage: payload.task ? `Running ${payload.role} task: ${payload.task}` : `Running ${payload.role} agent`,
				waitingOn: null,
				blocked: false,
				session: createAgentSessionRecord({
					sessionDir: payload.sessionDir,
					sessionId: currentState.session.sessionId,
					sessionPath: currentState.session.sessionPath,
					processId: child.pid ?? null,
					lastAttachedAt: currentState.session.lastAttachedAt,
				}),
			}),
		)
	}

	writeFileSync(
		invocationPath,
		`${JSON.stringify(
			{
				command: "pi",
				args: payload.piArgs,
				exitCode: null,
				sessionDir: payload.sessionDir,
				sessionPath: null,
				sessionId: null,
				processId: child.pid ?? null,
				startedAt,
			},
			null,
			2,
		)}\n`,
		"utf-8",
	)

	const { exitCode, error } = await waitForChild(child)
	if (!stdoutStream.writableEnded) stdoutStream.end()
	if (!stderrStream.writableEnded) stderrStream.end()
	await Promise.all([finished(stdoutStream), finished(stderrStream)])

	const stdout = readFileSync(stdoutPath, "utf-8")
	const stderr = readFileSync(stderrPath, "utf-8")
	const latestSession = getLatestAgentSession(payload.artifactsDir, payload.agentId)
	const completionMessage =
		stdout.trim() ||
		(error?.message?.trim() ?? "") ||
		(exitCode === 0 ? `${payload.role} run completed` : `${payload.role} run exited with code ${exitCode}`)

	if (error) {
		writeFileSync(stderrPath, `${stderr}${stderr.endsWith("\n") || stderr.length === 0 ? "" : "\n"}${error.message}\n`, "utf-8")
	}

	writeFileSync(
		invocationPath,
		`${JSON.stringify(
			{
				command: "pi",
				args: payload.piArgs,
				exitCode,
				sessionDir: latestSession.sessionDir ?? payload.sessionDir,
				sessionPath: latestSession.sessionPath,
				sessionId: latestSession.sessionId,
				processId: child.pid ?? null,
				startedAt,
				endedAt: new Date().toISOString(),
			},
			null,
			2,
		)}\n`,
		"utf-8",
	)

	appendAgentMessage({
		artifactsDir: payload.artifactsDir,
		agentId: payload.agentId,
		box: "outbox",
		from: payload.agentId,
		body: completionMessage,
	})

	if (payload.taskId) {
		updateTaskRecordStatus(payload.artifactsDir, payload.taskId, exitCode === 0 ? "completed" : "blocked")
		notifyTaskDelegator({
			artifactsDir: payload.artifactsDir,
			agentId: payload.agentId,
			taskId: payload.taskId,
			completionMessage,
			outcome: exitCode === 0 ? "completed" : "blocked",
		})
		if (payload.autoResumeTarget) {
			resumeAgentTurnDetached({
				repoRoot: payload.repoRoot,
				artifactsDir: payload.artifactsDir,
				agentId: payload.autoResumeTarget.agentId,
				message: payload.autoResumeTarget.message,
				from: payload.agentId,
				appendedSystemPrompt: payload.autoResumeTarget.appendedSystemPrompt,
				extensionPath: payload.autoResumeTarget.extensionPath,
			})
		}
	}

	const finalState = readAgentState(payload.artifactsDir, payload.agentId)
	if (finalState) {
		writeAgentState(
			payload.artifactsDir,
			createAgentState({
				...finalState,
				status: exitCode === 0 ? "idle" : "blocked",
				lastMessage: completionMessage,
				waitingOn: exitCode === 0 ? null : "human-or-follow-up-run",
				blocked: exitCode !== 0,
				session: createAgentSessionRecord({
					sessionDir: latestSession.sessionDir ?? payload.sessionDir,
					sessionId: latestSession.sessionId,
					sessionPath: latestSession.sessionPath,
					processId: null,
					lastAttachedAt: finalState.session.lastAttachedAt,
				}),
			}),
		)
	}
}

async function runDetachedTurn(payload: DetachedAgentTurnPayload) {
	const startedAt = new Date().toISOString()
	const agentArtifactsDir = getAgentDir(payload.artifactsDir, payload.agentId)
	const stdoutPath = `${agentArtifactsDir}/latest-stdout.txt`
	const stderrPath = `${agentArtifactsDir}/latest-stderr.txt`
	const invocationPath = `${agentArtifactsDir}/latest-invocation.json`
	mkdirSync(agentArtifactsDir, { recursive: true })

	const stdoutStream = createWriteStream(stdoutPath, { encoding: "utf-8" })
	const stderrStream = createWriteStream(stderrPath, { encoding: "utf-8" })
	const child = spawn("pi", payload.piArgs, {
		cwd: payload.repoRoot,
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	})

	if (child.stdout) child.stdout.pipe(stdoutStream)
	if (child.stderr) child.stderr.pipe(stderrStream)

	const currentState = readAgentState(payload.artifactsDir, payload.agentId)
	if (currentState) {
		writeAgentState(
			payload.artifactsDir,
			createAgentState({
				...currentState,
				status: "running",
				lastMessage: `Responding to ${payload.from}: ${payload.message}`,
				waitingOn: null,
				blocked: false,
				session: createAgentSessionRecord({
					sessionDir: currentState.session.sessionDir,
					sessionId: currentState.session.sessionId,
					sessionPath: currentState.session.sessionPath,
					processId: child.pid ?? null,
					lastAttachedAt: currentState.session.lastAttachedAt,
				}),
			}),
		)
	}

	writeFileSync(
		invocationPath,
		`${JSON.stringify(
			{
				command: "pi",
				args: payload.piArgs,
				exitCode: null,
				sessionDir: currentState?.session.sessionDir ?? null,
				sessionPath: currentState?.session.sessionPath ?? null,
				sessionId: currentState?.session.sessionId ?? null,
				processId: child.pid ?? null,
				startedAt,
			},
			null,
			2,
		)}\n`,
		"utf-8",
	)

	const { exitCode, error } = await waitForChild(child)
	if (!stdoutStream.writableEnded) stdoutStream.end()
	if (!stderrStream.writableEnded) stderrStream.end()
	await Promise.all([finished(stdoutStream), finished(stderrStream)])

	const stdout = readFileSync(stdoutPath, "utf-8")
	const stderr = readFileSync(stderrPath, "utf-8")
	const latestSession = getLatestAgentSession(payload.artifactsDir, payload.agentId)
	const completionMessage =
		stdout.trim() ||
		(error?.message?.trim() ?? "") ||
		(exitCode === 0 ? `${payload.role} turn completed` : `${payload.role} turn exited with code ${exitCode}`)

	if (error) {
		writeFileSync(stderrPath, `${stderr}${stderr.endsWith("\n") || stderr.length === 0 ? "" : "\n"}${error.message}\n`, "utf-8")
	}

	writeFileSync(
		invocationPath,
		`${JSON.stringify(
			{
				command: "pi",
				args: payload.piArgs,
				exitCode,
				sessionDir: latestSession.sessionDir,
				sessionPath: latestSession.sessionPath,
				sessionId: latestSession.sessionId,
				processId: child.pid ?? null,
				startedAt,
				endedAt: new Date().toISOString(),
			},
			null,
			2,
		)}\n`,
		"utf-8",
	)

	appendAgentMessage({
		artifactsDir: payload.artifactsDir,
		agentId: payload.agentId,
		box: "outbox",
		from: payload.agentId,
		body: completionMessage,
	})

	const finalState = readAgentState(payload.artifactsDir, payload.agentId)
	if (finalState) {
		writeAgentState(
			payload.artifactsDir,
			createAgentState({
				...finalState,
				status: exitCode === 0 ? "idle" : "blocked",
				lastMessage: completionMessage,
				waitingOn: exitCode === 0 ? null : "human-or-follow-up-run",
				blocked: exitCode !== 0,
				session: createAgentSessionRecord({
					sessionDir: latestSession.sessionDir,
					sessionId: latestSession.sessionId,
					sessionPath: latestSession.sessionPath,
					processId: null,
					lastAttachedAt: finalState.session.lastAttachedAt,
				}),
			}),
		)
	}

	try {
		rmSync(payload.wakeLockPath, { force: true })
	} catch {
		// ignore wake lock cleanup failures
	}
}

async function main() {
	const [encodedPayload] = process.argv.slice(2)
	if (!encodedPayload) {
		throw new Error("Missing detached agent payload")
	}

	const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf-8")) as DetachedAgentRunPayload | DetachedAgentTurnPayload
	if (payload.kind === "turn") {
		await runDetachedTurn(payload)
		return
	}

	await runDetachedAgent(payload)
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : String(error))
	process.exitCode = 1
})

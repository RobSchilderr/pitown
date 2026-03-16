import { readdirSync, readFileSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import {
	appendAgentMessage,
	createAgentSessionRecord,
	createAgentState,
	listAgentStates,
	writeAgentState,
} from "./agents.js"
import { updateTaskRecordStatus } from "./tasks.js"
import type { AgentStateSnapshot } from "./types.js"

const DEFAULT_GRACE_MS = 750

interface LeaseData {
	runId: string
	repoId: string
	branch: string
	pid: number
	hostname: string
	startedAt: string
}

export interface StopManagedAgentsOptions {
	artifactsDir: string
	agentId?: string | null
	excludeAgentIds?: string[]
	actorId?: string | null
	reason?: string | null
	force?: boolean
	graceMs?: number
}

export interface StopAgentResult {
	agentId: string
	previousStatus: AgentStateSnapshot["status"]
	nextStatus: AgentStateSnapshot["status"]
	processId: number | null
	signal: "SIGTERM" | "SIGKILL" | null
	exited: boolean
}

export interface StopManagedAgentsResult {
	results: StopAgentResult[]
	stoppedAgents: number
	signaledProcesses: number
}

export interface RepoLeaseRecord extends LeaseData {
	path: string
}

export interface StopRepoLeasesOptions {
	repoId?: string | null
	force?: boolean
	graceMs?: number
}

export interface StopRepoLeaseResult {
	path: string
	runId: string
	repoId: string
	branch: string
	processId: number
	signal: "SIGTERM" | "SIGKILL" | null
	exited: boolean
}

export interface StopRepoLeasesResult {
	results: StopRepoLeaseResult[]
	signaledProcesses: number
}

function sleepMs(ms: number) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function getLocksDir(): string {
	return join(homedir(), ".pi-town", "locks")
}

function processAlive(pid: number): boolean {
	if (!Number.isFinite(pid) || pid <= 0) return false

	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

function terminateProcess(pid: number, options: { force?: boolean; graceMs?: number }): {
	signal: "SIGTERM" | "SIGKILL" | null
	exited: boolean
} {
	if (!processAlive(pid)) return { signal: null, exited: true }

	try {
		process.kill(pid, "SIGTERM")
	} catch {
		return { signal: null, exited: !processAlive(pid) }
	}

	const graceMs = options.graceMs ?? DEFAULT_GRACE_MS
	const deadline = Date.now() + graceMs
	while (Date.now() < deadline) {
		if (!processAlive(pid)) return { signal: "SIGTERM", exited: true }
		sleepMs(25)
	}

	if (!options.force) return { signal: "SIGTERM", exited: !processAlive(pid) }

	try {
		process.kill(pid, "SIGKILL")
	} catch {
		return { signal: "SIGTERM", exited: !processAlive(pid) }
	}

	return { signal: "SIGKILL", exited: !processAlive(pid) }
}

function readLease(path: string): RepoLeaseRecord | null {
	try {
		const data = JSON.parse(readFileSync(path, "utf-8")) as LeaseData
		return { ...data, path }
	} catch {
		return null
	}
}

function createStopMessage(options: { actorId?: string | null; reason?: string | null }): string {
	if (options.reason) return options.reason
	if (options.actorId) return `Stopped by ${options.actorId}`
	return "Stopped by operator"
}

function createStopMessageInput(options: StopManagedAgentsOptions): { actorId?: string | null; reason?: string | null } {
	return {
		...(options.actorId === undefined ? {} : { actorId: options.actorId }),
		...(options.reason === undefined ? {} : { reason: options.reason }),
	}
}

function createTerminateOptions(options: { force?: boolean; graceMs?: number }): { force?: boolean; graceMs?: number } {
	return {
		...(options.force === undefined ? {} : { force: options.force }),
		...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
	}
}

export function listRepoLeases(repoId?: string | null): RepoLeaseRecord[] {
	let entries: string[]
	try {
		entries = readdirSync(getLocksDir())
	} catch {
		return []
	}

	return entries
		.filter((entry) => entry.endsWith(".json"))
		.map((entry) => readLease(join(getLocksDir(), entry)))
		.filter((record): record is RepoLeaseRecord => record !== null)
		.filter((record) => repoId === undefined || repoId === null || record.repoId === repoId)
}

export function stopRepoLeases(options: StopRepoLeasesOptions): StopRepoLeasesResult {
	const results = listRepoLeases(options.repoId).map((lease) => {
		const termination = terminateProcess(lease.pid, options)
		if (termination.exited) rmSync(lease.path, { force: true })

		return {
			path: lease.path,
			runId: lease.runId,
			repoId: lease.repoId,
			branch: lease.branch,
			processId: lease.pid,
			signal: termination.signal,
			exited: termination.exited,
		}
	})

	return {
		results,
		signaledProcesses: results.filter((result) => result.signal !== null).length,
	}
}

export function stopManagedAgents(options: StopManagedAgentsOptions): StopManagedAgentsResult {
	const reason = createStopMessage(createStopMessageInput(options))
	const excluded = new Set(options.excludeAgentIds ?? [])
	const candidates = listAgentStates(options.artifactsDir).filter((agent) => {
		if (excluded.has(agent.agentId)) return false
		if (options.agentId && agent.agentId !== options.agentId) return false
		return !["completed", "failed", "stopped"].includes(agent.status)
	})

	const results = candidates.map((state) => {
		const processId = state.session.processId
		const termination =
			processId === null
				? { signal: null, exited: true }
				: terminateProcess(processId, createTerminateOptions(options))

		if (state.taskId) updateTaskRecordStatus(options.artifactsDir, state.taskId, "aborted")

		appendAgentMessage({
			artifactsDir: options.artifactsDir,
			agentId: state.agentId,
			box: "outbox",
			from: options.actorId ?? "system",
			body: reason,
		})

		writeAgentState(
			options.artifactsDir,
			createAgentState({
				...state,
				status: "stopped",
				lastMessage: reason,
				waitingOn: "stopped",
				blocked: true,
				session: createAgentSessionRecord({
					sessionDir: state.session.sessionDir,
					sessionId: state.session.sessionId,
					sessionPath: state.session.sessionPath,
					processId: null,
					lastAttachedAt: state.session.lastAttachedAt,
				}),
			}),
		)

		return {
			agentId: state.agentId,
			previousStatus: state.status,
			nextStatus: "stopped" as const,
			processId,
			signal: termination.signal,
			exited: termination.exited,
		}
	})

	return {
		results,
		stoppedAgents: results.length,
		signaledProcesses: results.filter((result) => result.signal !== null).length,
	}
}

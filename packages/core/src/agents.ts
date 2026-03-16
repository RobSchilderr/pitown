import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { appendJsonl, readJsonl } from "./events.js"
import type {
	AgentMailbox,
	AgentMessageRecord,
	AgentSessionRecord,
	AgentStateSnapshot,
	AgentStatus,
} from "./types.js"

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

function ensureMailbox(path: string) {
	mkdirSync(dirname(path), { recursive: true })
	if (!existsSync(path)) writeFileSync(path, "", "utf-8")
}

export function getAgentsDir(artifactsDir: string): string {
	return join(artifactsDir, "agents")
}

export function getAgentDir(artifactsDir: string, agentId: string): string {
	return join(getAgentsDir(artifactsDir), agentId)
}

export function getAgentStatePath(artifactsDir: string, agentId: string): string {
	return join(getAgentDir(artifactsDir, agentId), "state.json")
}

export function getAgentSessionPath(artifactsDir: string, agentId: string): string {
	return join(getAgentDir(artifactsDir, agentId), "session.json")
}

export function getAgentMailboxPath(artifactsDir: string, agentId: string, box: AgentMailbox): string {
	return join(getAgentDir(artifactsDir, agentId), `${box}.jsonl`)
}

export function getAgentSessionsDir(artifactsDir: string, agentId: string): string {
	return join(getAgentDir(artifactsDir, agentId), "sessions")
}

export function getSessionIdFromPath(sessionPath: string | null | undefined): string | null {
	if (!sessionPath) return null
	const match = /_([0-9a-f-]+)\.jsonl$/i.exec(sessionPath)
	return match?.[1] ?? null
}

export function createAgentSessionRecord(
	input?: Partial<Pick<AgentSessionRecord, "sessionDir" | "sessionId" | "sessionPath" | "lastAttachedAt">>,
): AgentSessionRecord {
	return {
		runtime: "pi",
		persisted: true,
		sessionDir: input?.sessionDir ?? null,
		sessionId: input?.sessionId ?? null,
		sessionPath: input?.sessionPath ?? null,
		lastAttachedAt: input?.lastAttachedAt ?? null,
	}
}

export function createAgentState(input: {
	agentId: string
	role: string
	status: AgentStatus
	taskId?: string | null
	task?: string | null
	branch?: string | null
	lastMessage?: string | null
	waitingOn?: string | null
	blocked?: boolean
	runId?: string | null
	session?: AgentSessionRecord
}): AgentStateSnapshot {
	return {
		agentId: input.agentId,
		role: input.role,
		status: input.status,
		taskId: input.taskId ?? null,
		task: input.task ?? null,
		branch: input.branch ?? null,
		updatedAt: new Date().toISOString(),
		lastMessage: input.lastMessage ?? null,
		waitingOn: input.waitingOn ?? null,
		blocked: input.blocked ?? false,
		runId: input.runId ?? null,
		session: input.session ?? createAgentSessionRecord(),
	}
}

export function writeAgentState(artifactsDir: string, state: AgentStateSnapshot) {
	mkdirSync(getAgentDir(artifactsDir, state.agentId), { recursive: true })
	ensureMailbox(getAgentMailboxPath(artifactsDir, state.agentId, "inbox"))
	ensureMailbox(getAgentMailboxPath(artifactsDir, state.agentId, "outbox"))
	writeJson(getAgentStatePath(artifactsDir, state.agentId), state)
	writeJson(getAgentSessionPath(artifactsDir, state.agentId), state.session)
}

export function readAgentState(artifactsDir: string, agentId: string): AgentStateSnapshot | null {
	const statePath = getAgentStatePath(artifactsDir, agentId)
	try {
		return JSON.parse(readFileSync(statePath, "utf-8")) as AgentStateSnapshot
	} catch {
		return null
	}
}

export function listAgentStates(artifactsDir: string): AgentStateSnapshot[] {
	const agentsDir = getAgentsDir(artifactsDir)
	let entries: string[]
	try {
		entries = readdirSync(agentsDir)
	} catch {
		return []
	}

	return entries
		.map((entry) => readAgentState(artifactsDir, entry))
		.filter((state): state is AgentStateSnapshot => state !== null)
		.sort((left, right) => left.agentId.localeCompare(right.agentId))
}

export function appendAgentMessage(input: {
	artifactsDir: string
	agentId: string
	box: AgentMailbox
	from: string
	body: string
}): AgentMessageRecord {
	const record: AgentMessageRecord = {
		box: input.box,
		from: input.from,
		body: input.body,
		createdAt: new Date().toISOString(),
	}
	appendJsonl(getAgentMailboxPath(input.artifactsDir, input.agentId, input.box), record)
	return record
}

export function readAgentMessages(artifactsDir: string, agentId: string, box: AgentMailbox): AgentMessageRecord[] {
	return readJsonl<AgentMessageRecord>(getAgentMailboxPath(artifactsDir, agentId, box))
}

export function getLatestAgentSession(artifactsDir: string, agentId: string): AgentSessionRecord {
	const sessionDir = getAgentSessionsDir(artifactsDir, agentId)
	let entries: string[]
	try {
		entries = readdirSync(sessionDir)
	} catch {
		return createAgentSessionRecord({ sessionDir })
	}

	const latestSessionPath =
		entries
			.filter((entry) => entry.endsWith(".jsonl"))
			.sort()
			.at(-1) ?? null

	if (latestSessionPath === null) return createAgentSessionRecord({ sessionDir })

	const sessionPath = join(sessionDir, latestSessionPath)
	return createAgentSessionRecord({
		sessionDir,
		sessionPath,
		sessionId: getSessionIdFromPath(sessionPath),
	})
}

import { Type } from "@mariozechner/pi-ai"
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent"
import {
	delegateTask,
	listAgentStates,
	queueAgentMessage,
	readAgentMessages,
	readAgentState,
	stopManagedAgents,
	updateAgentStatus,
} from "@schilderlabs/pitown-core"
import { readPiTownMayorPrompt, resolvePiTownExtensionPath } from "#pitown-package-api"

type TownToolName =
	| "pitown_board"
	| "pitown_delegate"
	| "pitown_message_agent"
	| "pitown_peek_agent"
	| "pitown_stop"
	| "pitown_update_status"

interface TownAgentContext {
	artifactsDir: string
	repoSlug: string
	agentId: string
	role: string
	sessionFile: string
}

const ROLE_STATUS = Type.Union([
	Type.Literal("queued"),
	Type.Literal("running"),
	Type.Literal("idle"),
	Type.Literal("blocked"),
	Type.Literal("completed"),
	Type.Literal("failed"),
	Type.Literal("stopped"),
])

const toolPermissions: Record<string, TownToolName[]> = {
	mayor: ["pitown_board", "pitown_delegate", "pitown_message_agent", "pitown_peek_agent", "pitown_stop", "pitown_update_status"],
	worker: ["pitown_board", "pitown_message_agent", "pitown_peek_agent", "pitown_update_status"],
	reviewer: ["pitown_board", "pitown_message_agent", "pitown_peek_agent", "pitown_update_status"],
	"docs-keeper": ["pitown_board", "pitown_message_agent", "pitown_peek_agent", "pitown_update_status"],
}

export function resolveTownAgentContext(sessionFile: string | null | undefined): TownAgentContext | null {
	if (!sessionFile) return null

	const normalizedSessionFile = sessionFile.replace(/\\/g, "/")
	const match = normalizedSessionFile.match(/^(.*\/repos\/([^/]+))\/agents\/([^/]+)\/sessions\/[^/]+\.jsonl$/)
	if (!match) return null

	const artifactsDir = match[1]
	const repoSlug = match[2]
	const agentId = match[3]
	if (!artifactsDir || !repoSlug || !agentId) return null

	const state = readAgentState(artifactsDir, agentId)
	if (state === null) return null

	return {
		artifactsDir,
		repoSlug,
		agentId,
		role: state.role,
		sessionFile: normalizedSessionFile,
	}
}

function getAllowedTools(role: string): TownToolName[] {
	return toolPermissions[role] ?? ["pitown_board"]
}

function assertPermission(context: TownAgentContext, toolName: TownToolName, targetAgentId?: string) {
	if (!getAllowedTools(context.role).includes(toolName)) {
		throw new Error(`${context.role} agents may not use ${toolName}`)
	}

	if (toolName === "pitown_delegate" && context.role !== "mayor") {
		throw new Error("Only the mayor may delegate work")
	}

	if (toolName === "pitown_message_agent" && context.role !== "mayor" && targetAgentId && targetAgentId !== "mayor") {
		throw new Error("Only the mayor may message non-mayor agents")
	}

	if (toolName === "pitown_peek_agent" && context.role !== "mayor" && targetAgentId) {
		const allowedTargets = new Set([context.agentId, "mayor"])
		if (!allowedTargets.has(targetAgentId)) {
			throw new Error("Non-mayor agents may only peek themselves or the mayor")
		}
	}
}

function formatBoard(artifactsDir: string): string {
	const agents = listAgentStates(artifactsDir)
	if (agents.length === 0) return "No agents found."

	return agents
		.map((agent) => {
			const task = agent.task ?? "no active task"
			const taskId = agent.taskId ? ` [${agent.taskId}]` : ""
			const note = agent.lastMessage ? ` | ${agent.lastMessage}` : ""
			const waitingOn = agent.waitingOn ? ` | waiting on: ${agent.waitingOn}` : ""
			return `${agent.agentId.padEnd(12)} ${agent.status.padEnd(9)} ${task}${taskId}${note}${waitingOn}`
		})
		.join("\n")
}

function formatMailbox(artifactsDir: string, agentId: string, box: "inbox" | "outbox"): string {
	const records = readAgentMessages(artifactsDir, agentId, box).slice(-3)
	if (records.length === 0) return `${box}: empty`

	return `${box}:\n${records.map((record) => `- ${record.from}: ${record.body}`).join("\n")}`
}

function buildStartupContext(context: TownAgentContext): string {
	const state = readAgentState(context.artifactsDir, context.agentId)
	if (state === null) throw new Error(`Unknown agent: ${context.agentId}`)

	const currentTask = state.task ?? "no active task"
	const board = formatBoard(context.artifactsDir)
	const tools = getAllowedTools(context.role).join(", ")

	return [
		`Pi Town agent context: ${context.agentId} (${context.role})`,
		`Repo slug: ${context.repoSlug}`,
		`Current task: ${currentTask}`,
		`Allowed Pi Town tools: ${tools}`,
		"",
		"Current board:",
		board,
	].join("\n")
}

function requireTownContext(ctx: ExtensionContext): TownAgentContext {
	const context = resolveTownAgentContext(ctx.sessionManager.getSessionFile())
	if (context === null) {
		throw new Error("This Pi session is not managed by Pi Town")
	}
	return context
}

const notifiedCompletions = new Set<string>()

export function registerTownTools(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (_event, ctx) => {
		const context = resolveTownAgentContext(ctx.sessionManager.getSessionFile())
		if (context === null) return undefined

		return {
			message: {
				customType: "pitown-context",
				content: buildStartupContext(context),
				display: false,
			},
		}
	})

	pi.on("before_agent_start", async (_event, ctx) => {
		const context = resolveTownAgentContext(ctx.sessionManager.getSessionFile())
		if (!context || context.agentId !== "mayor") return
		if (!ctx.hasUI) return

		const agents = listAgentStates(context.artifactsDir)
		const workers = agents.filter((a) => a.agentId !== "mayor")
		if (workers.length === 0) {
			ctx.ui.setStatus("pitown-workers", undefined)
			ctx.ui.setWidget("pitown-workers", undefined)
			return
		}

		for (const w of workers) {
			if ((w.status === "idle" || w.status === "completed") && !notifiedCompletions.has(w.agentId)) {
				notifiedCompletions.add(w.agentId)
				ctx.ui.notify(`✓ ${w.agentId} finished: ${w.lastMessage ?? w.task ?? "done"}`, "info")
			}
			if ((w.status === "blocked" || w.status === "failed" || w.status === "stopped") && !notifiedCompletions.has(w.agentId)) {
				notifiedCompletions.add(w.agentId)
				ctx.ui.notify(`✗ ${w.agentId} blocked: ${w.lastMessage ?? "needs attention"}`, "warning")
			}
		}

		const running = workers.filter((a) => a.status === "running" || a.status === "starting").length
		const done = workers.filter((a) => a.status === "idle" || a.status === "completed").length
		const blocked = workers.filter((a) => a.status === "blocked" || a.status === "failed" || a.status === "stopped").length

		const parts: string[] = []
		if (running > 0) parts.push(`${running} running`)
		if (done > 0) parts.push(`${done} done`)
		if (blocked > 0) parts.push(`${blocked} blocked`)

		const label = `workers: ${parts.join(", ")}`
		ctx.ui.setStatus("pitown-workers", label)
		ctx.ui.setWidget(
			"pitown-workers",
			workers.map((w) => {
				const task = w.task ? (w.task.length > 50 ? w.task.slice(0, 49) + "…" : w.task) : "—"
				return `${w.agentId}: ${w.status} — ${task}`
			}),
		)
	})

	pi.registerTool({
		name: "pitown_board",
		label: "Pi Town Board",
		description: "Show the current Pi Town board with all known agents and their statuses",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const context = requireTownContext(ctx)
			assertPermission(context, "pitown_board")

			return {
				content: [{ type: "text", text: formatBoard(context.artifactsDir) }],
				details: { agentId: context.agentId, role: context.role },
			}
		},
	})

	pi.registerTool({
		name: "pitown_delegate",
		label: "Pi Town Delegate",
		description: "Delegate a bounded task to a new Pi Town agent",
		parameters: Type.Object({
			role: Type.String({ description: "Agent role to spawn, such as worker or reviewer" }),
			task: Type.String({ description: "Bounded task description" }),
			agentId: Type.Optional(Type.String({ description: "Optional explicit agent id" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const context = requireTownContext(ctx)
			assertPermission(context, "pitown_delegate")
			const input = params as { role: string; task: string; agentId?: string }

			const result = delegateTask({
				repoRoot: ctx.cwd,
				artifactsDir: context.artifactsDir,
				fromAgentId: context.agentId,
				role: input.role,
				task: input.task,
				agentId: input.agentId ?? null,
				extensionPath: resolvePiTownExtensionPath(),
				appendedSystemPrompt: input.role === "mayor" ? readPiTownMayorPrompt() : null,
			})

			return {
				content: [
					{
						type: "text",
						text: `Delegated ${result.task.taskId} to ${result.agentId} (${input.role}). Status: ${result.task.status}.`,
					},
				],
				details: {
					taskId: result.task.taskId,
					agentId: result.agentId,
					status: result.task.status,
					processId: result.launch.processId,
					sessionPath: result.latestSession.sessionPath,
				},
			}
		},
	})

	pi.registerTool({
		name: "pitown_message_agent",
		label: "Pi Town Message Agent",
		description: "Send a durable message to another Pi Town agent",
		parameters: Type.Object({
			agentId: Type.String({ description: "Target Pi Town agent id" }),
			body: Type.String({ description: "Message body" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const context = requireTownContext(ctx)
			const input = params as { agentId: string; body: string }
			assertPermission(context, "pitown_message_agent", input.agentId)

			queueAgentMessage({
				artifactsDir: context.artifactsDir,
				agentId: input.agentId,
				from: context.agentId,
				body: input.body,
			})

			return {
				content: [{ type: "text", text: `Queued message for ${input.agentId}.` }],
				details: { agentId: input.agentId },
			}
		},
	})

	pi.registerTool({
		name: "pitown_peek_agent",
		label: "Pi Town Peek Agent",
		description: "Inspect another Pi Town agent's current state and recent mailbox activity",
		parameters: Type.Object({
			agentId: Type.String({ description: "Agent id to inspect" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const context = requireTownContext(ctx)
			const input = params as { agentId: string }
			assertPermission(context, "pitown_peek_agent", input.agentId)

			const state = readAgentState(context.artifactsDir, input.agentId)
			if (state === null) throw new Error(`Unknown agent: ${input.agentId}`)

			const summary = [
				`${state.agentId} (${state.role})`,
				`status: ${state.status}`,
				`task: ${state.task ?? "none"}`,
				`taskId: ${state.taskId ?? "none"}`,
				`last message: ${state.lastMessage ?? "none"}`,
				`waiting on: ${state.waitingOn ?? "none"}`,
				formatMailbox(context.artifactsDir, input.agentId, "inbox"),
				formatMailbox(context.artifactsDir, input.agentId, "outbox"),
			].join("\n")

			return {
				content: [{ type: "text", text: summary }],
				details: { agentId: state.agentId, status: state.status, taskId: state.taskId },
			}
		},
	})

	pi.registerTool({
		name: "pitown_stop",
		label: "Pi Town Stop",
		description: "Stop a managed Pi Town agent, or stop the other agents in this repo",
		parameters: Type.Object({
			scope: Type.Optional(Type.Union([Type.Literal("repo"), Type.Literal("agent")])),
			agentId: Type.Optional(Type.String({ description: "Required when scope is agent" })),
			force: Type.Optional(Type.Boolean({ description: "Escalate to SIGKILL if SIGTERM does not stop the process" })),
			reason: Type.Optional(Type.String({ description: "Optional stop reason recorded on the board" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const context = requireTownContext(ctx)
			assertPermission(context, "pitown_stop")
			const input = params as {
				scope?: "repo" | "agent"
				agentId?: string
				force?: boolean
				reason?: string
			}
			const scope = input.scope ?? "repo"

			if (scope === "agent" && !input.agentId) throw new Error("pitown_stop requires agentId when scope=agent")
			if (scope === "agent" && input.agentId === context.agentId) {
				throw new Error("pitown_stop may not stop the current live mayor session; use the CLI for self-stop")
			}

			const result = stopManagedAgents({
				artifactsDir: context.artifactsDir,
				agentId: scope === "agent" ? input.agentId! : null,
				excludeAgentIds: scope === "repo" ? [context.agentId] : [],
				actorId: context.agentId,
				reason: input.reason ?? `Stopped by ${context.agentId} via pitown_stop`,
				force: input.force ?? false,
			})

			return {
				content: [
					{
						type: "text",
						text:
							scope === "agent"
								? `Stopped ${input.agentId}. Agents updated: ${result.stoppedAgents}. Signaled processes: ${result.signaledProcesses}.`
								: `Stopped repo agents except ${context.agentId}. Agents updated: ${result.stoppedAgents}. Signaled processes: ${result.signaledProcesses}.`,
					},
				],
				details: {
					scope,
					agentId: input.agentId ?? null,
					stoppedAgents: result.stoppedAgents,
					signaledProcesses: result.signaledProcesses,
				},
			}
		},
	})

	pi.registerTool({
		name: "pitown_update_status",
		label: "Pi Town Update Status",
		description: "Update this Pi Town agent's durable status on the board",
		parameters: Type.Object({
			status: ROLE_STATUS,
			lastMessage: Type.Optional(Type.String({ description: "Short progress update" })),
			waitingOn: Type.Optional(Type.String({ description: "What this agent is waiting on, if anything" })),
			blocked: Type.Optional(Type.Boolean({ description: "Whether the agent is currently blocked" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const context = requireTownContext(ctx)
			assertPermission(context, "pitown_update_status")
			const input = params as {
				status: "queued" | "running" | "idle" | "blocked" | "completed" | "failed" | "stopped"
				lastMessage?: string
				waitingOn?: string
				blocked?: boolean
			}

			updateAgentStatus({
				artifactsDir: context.artifactsDir,
				agentId: context.agentId,
				status: input.status,
				lastMessage: input.lastMessage ?? null,
				waitingOn: input.waitingOn ?? null,
				...(input.blocked === undefined ? {} : { blocked: input.blocked }),
			})

			return {
				content: [{ type: "text", text: `Updated ${context.agentId} to ${input.status}.` }],
				details: { agentId: context.agentId, status: input.status },
			}
		},
	})
}

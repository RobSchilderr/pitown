import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai"
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent"
import { resolveTownAgentContext } from "#pitown-town-tools"

interface PlanTodo {
	step: number
	text: string
	completed: boolean
}

interface PersistedMayorPlanState {
	enabled?: boolean
	savedTools?: string[]
	todos?: PlanTodo[]
}

const PLAN_ALLOWED_TOOLS = new Set(["read", "grep", "find", "ls", "questionnaire", "pitown_board", "pitown_peek_agent"])
const PLAN_ENTRY_TYPE = "pitown-mayor-plan"
const PLAN_CONTEXT_TYPE = "pitown-mayor-plan-context"
const PLAN_CAPTURE_TYPE = "pitown-mayor-plan-captured"

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant" && Array.isArray(message.content)
}

function getAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n")
}

function dedupe(values: string[]): string[] {
	return [...new Set(values)]
}

function getAllToolNames(pi: ExtensionAPI): string[] {
	return pi.getAllTools().map((tool) => tool.name)
}

function resolvePlanTools(candidateTools: string[]): string[] {
	return dedupe(candidateTools.filter((tool) => PLAN_ALLOWED_TOOLS.has(tool)))
}

function isMayorSession(ctx: ExtensionContext): boolean {
	const context = resolveTownAgentContext(ctx.sessionManager.getSessionFile())
	if (context === null) return false
	return context.agentId === "leader" || context.role === "leader" || context.role === "mayor"
}

function persistPlanState(pi: ExtensionAPI, enabled: boolean, savedTools: string[], todos: PlanTodo[]) {
	pi.appendEntry<PersistedMayorPlanState>(PLAN_ENTRY_TYPE, {
		enabled,
		savedTools,
		todos,
	})
}

function extractPlanTodos(text: string): PlanTodo[] {
	const lines = text.split(/\r?\n/)
	const startIndex = lines.findIndex((line) => /^plan:\s*$/i.test(line.trim()))
	const scanFrom = startIndex === -1 ? 0 : startIndex + 1
	const todos: PlanTodo[] = []

	for (const line of lines.slice(scanFrom)) {
		const match = line.match(/^\s*(\d+)[.)]\s+(.+?)\s*$/)
		if (match) {
			todos.push({
				step: Number.parseInt(match[1] ?? "0", 10),
				text: match[2] ?? "",
				completed: false,
			})
			continue
		}

		if (todos.length > 0 && line.trim() === "") break
	}

	return todos
}

function renderTodos(todos: PlanTodo[]): string {
	if (todos.length === 0) return "No captured plan steps yet. Ask the mayor to produce a numbered Plan: block."
	return todos.map((todo) => `${todo.step}. ${todo.completed ? "✓" : "○"} ${todo.text}`).join("\n")
}

function setPlanStatus(ctx: ExtensionContext, enabled: boolean, todos: PlanTodo[]) {
	if (!ctx.hasUI) return
	if (!enabled) {
		ctx.ui.setStatus("pitown-plan", undefined)
		ctx.ui.setWidget("pitown-plan", undefined)
		return
	}

	ctx.ui.setStatus("pitown-plan", ctx.ui.theme.fg("warning", "plan"))
	ctx.ui.setWidget(
		"pitown-plan",
		todos.length === 0 ? ["Mayor plan mode is active."] : todos.map((todo) => `${todo.step}. ${todo.text}`),
	)
}

export function registerMayorPlanMode(pi: ExtensionAPI) {
	let planModeEnabled = false
	let savedTools: string[] = []
	let todos: PlanTodo[] = []

	function enablePlanMode(ctx: ExtensionContext) {
		const currentTools = pi.getActiveTools()
		const fallbackTools = currentTools.length > 0 ? currentTools : getAllToolNames(pi)
		if (savedTools.length === 0) savedTools = dedupe(fallbackTools)

		const planTools = resolvePlanTools(savedTools)
		pi.setActiveTools(planTools)
		planModeEnabled = true
		setPlanStatus(ctx, planModeEnabled, todos)
		persistPlanState(pi, planModeEnabled, savedTools, todos)

		ctx.ui.notify(
			"Mayor plan mode enabled. Planning is read-only. Use /todos to inspect captured steps and /plan again to leave plan mode.",
			"info",
		)
	}

	function disablePlanMode(ctx: ExtensionContext) {
		const restoreTools = savedTools.length > 0 ? savedTools : getAllToolNames(pi)
		pi.setActiveTools(restoreTools)
		planModeEnabled = false
		setPlanStatus(ctx, planModeEnabled, todos)
		persistPlanState(pi, planModeEnabled, savedTools, todos)

		ctx.ui.notify("Mayor plan mode disabled. Delegation and execution tools are available again.", "info")
	}

	pi.registerFlag("plan", {
		description: "Start the mayor in read-only planning mode",
		type: "boolean",
		default: false,
	})

	pi.registerCommand("plan", {
		description: "Toggle mayor planning mode",
		handler: async (_args, ctx) => {
			if (!isMayorSession(ctx)) {
				ctx.ui.notify("/plan is only available in the mayor session.", "warning")
				return
			}

			if (planModeEnabled) {
				disablePlanMode(ctx)
				return
			}

			enablePlanMode(ctx)
		},
	})

	pi.registerCommand("todos", {
		description: "Show the mayor's captured plan steps",
		handler: async (_args, ctx) => {
			if (!isMayorSession(ctx)) {
				ctx.ui.notify("/todos is only available in the mayor session.", "warning")
				return
			}

			ctx.ui.notify(renderTodos(todos), todos.length === 0 ? "info" : "success")
		},
	})

	pi.on("session_start", async (_event, ctx) => {
		if (!isMayorSession(ctx)) return

		const entry = ctx.sessionManager
			.getEntries()
			.filter((candidate: { type: string; customType?: string }) => {
				return candidate.type === "custom" && candidate.customType === PLAN_ENTRY_TYPE
			})
			.pop() as { data?: PersistedMayorPlanState } | undefined

		if (entry?.data?.savedTools) savedTools = dedupe(entry.data.savedTools)
		if (entry?.data?.todos) todos = entry.data.todos
		planModeEnabled = entry?.data?.enabled ?? false

		if (pi.getFlag("plan") === true) {
			planModeEnabled = true
			if (savedTools.length === 0) {
				const currentTools = pi.getActiveTools()
				savedTools = dedupe(currentTools.length > 0 ? currentTools : getAllToolNames(pi))
			}
		}

		if (planModeEnabled) {
			const planTools = resolvePlanTools(savedTools.length > 0 ? savedTools : getAllToolNames(pi))
			pi.setActiveTools(planTools)
		}

		setPlanStatus(ctx, planModeEnabled, todos)
	})

	pi.on("before_agent_start", async (_event, ctx) => {
		if (!planModeEnabled || !isMayorSession(ctx)) return undefined

		return {
			message: {
				customType: PLAN_CONTEXT_TYPE,
				content: [
					"[MAYOR PLAN MODE ACTIVE]",
					"You are planning only.",
					"Use read-only exploration and Pi Town inspection tools to understand the repo and the current town state.",
					"Do not delegate work, do not claim that code changes were made, and do not switch into execution.",
					"Produce a concise numbered plan under a `Plan:` header.",
					"If the plan depends on active agents, inspect the board first.",
				].join("\n"),
				display: false,
			},
		}
	})

	pi.on("tool_call", async (event, ctx) => {
		if (!planModeEnabled || !isMayorSession(ctx)) return undefined

		if (!PLAN_ALLOWED_TOOLS.has(event.toolName)) {
			return {
				block: true,
				reason: `Mayor plan mode only allows read-only tools. Disable /plan before using ${event.toolName}.`,
			}
		}

		if (event.toolName === "pitown_delegate" || event.toolName === "pitown_message_agent" || event.toolName === "pitown_update_status") {
			return {
				block: true,
				reason: `Mayor plan mode blocks orchestration side effects. Disable /plan before using ${event.toolName}.`,
			}
		}

		return undefined
	})

	pi.on("agent_end", async (event, ctx) => {
		if (!planModeEnabled || !isMayorSession(ctx)) return

		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage)
		if (!lastAssistant) return

		const extractedTodos = extractPlanTodos(getAssistantText(lastAssistant))
		if (extractedTodos.length === 0) {
			persistPlanState(pi, planModeEnabled, savedTools, todos)
			setPlanStatus(ctx, planModeEnabled, todos)
			return
		}

		todos = extractedTodos
		persistPlanState(pi, planModeEnabled, savedTools, todos)
		setPlanStatus(ctx, planModeEnabled, todos)

		pi.sendMessage(
			{
				customType: PLAN_CAPTURE_TYPE,
				content: `Plan captured.\n\n${renderTodos(todos)}\n\nStay in /plan to refine it, or run /plan again to leave planning mode and execute through the mayor.`,
				display: true,
			},
			{ triggerTurn: false },
		)
	})
}

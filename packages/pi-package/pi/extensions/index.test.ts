import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import {
	createAgentSessionRecord,
	createAgentState,
	createTaskRecord,
	readAgentState,
	readTaskRecord,
	writeAgentState,
	writeTaskRecord,
} from "@schilderlabs/pitown-core"
import { describe, expect, it, vi } from "vitest"

import piTownPackage from "#pitown-extension"

type RegisteredHandler = (...args: unknown[]) => unknown | Promise<unknown>

function createRepoArtifacts() {
	const repoRoot = mkdtempSync(join(tmpdir(), "pitown-repo-"))
	const artifactsDir = join(mkdtempSync(join(tmpdir(), "pitown-home-")), "repos", "demo-repo")

	const mayorSessionDir = join(artifactsDir, "agents", "mayor", "sessions")
	const workerSessionDir = join(artifactsDir, "agents", "worker-001", "sessions")
	const reviewerSessionDir = join(artifactsDir, "agents", "reviewer-001", "sessions")
	const mayorSessionFile = join(mayorSessionDir, "session_mayor.jsonl")
	const workerSessionFile = join(workerSessionDir, "session_worker.jsonl")

	writeAgentState(
		artifactsDir,
		createAgentState({
			agentId: "mayor",
			role: "mayor",
			status: "running",
			task: "coordinate town work",
			lastMessage: "checking board",
			session: createAgentSessionRecord({
				sessionDir: mayorSessionDir,
				sessionPath: mayorSessionFile,
				sessionId: "mayor",
			}),
		}),
	)
	writeAgentState(
		artifactsDir,
		createAgentState({
			agentId: "worker-001",
			role: "worker",
			status: "queued",
			taskId: "task-123",
			task: "fix the failing auth flow",
			session: createAgentSessionRecord({
				sessionDir: workerSessionDir,
				sessionPath: workerSessionFile,
				sessionId: "worker",
			}),
		}),
	)
	writeAgentState(
		artifactsDir,
		createAgentState({
			agentId: "reviewer-001",
			role: "reviewer",
			status: "idle",
			task: null,
			session: createAgentSessionRecord({
				sessionDir: reviewerSessionDir,
				sessionPath: join(reviewerSessionDir, "session_reviewer.jsonl"),
				sessionId: "reviewer",
			}),
		}),
	)
	writeTaskRecord(
		artifactsDir,
		createTaskRecord({
			taskId: "task-123",
			title: "fix the failing auth flow",
			status: "queued",
			role: "worker",
			assignedAgentId: "worker-001",
			createdBy: "mayor",
		}),
	)

	return { repoRoot, artifactsDir, mayorSessionFile, workerSessionFile }
}

function setup() {
	const handlers: Record<string, RegisteredHandler[]> = {}
	const tools = new Map<string, { execute: RegisteredHandler }>()
	const commands = new Map<string, unknown>()
	const flags = new Map<string, unknown>()
	const activeTools: string[] = [
		"read",
		"grep",
		"find",
		"ls",
		"pitown_board",
		"pitown_delegate",
		"pitown_message_agent",
		"pitown_peek_agent",
		"pitown_update_status",
	]
	const appendedEntries: Array<{ customType: string; data: unknown }> = []
	const pi = {
		on: vi.fn((event: string, handler: RegisteredHandler) => {
			;(handlers[event] ??= []).push(handler)
		}),
		registerTool: vi.fn((definition: { name: string; execute: RegisteredHandler }) => {
			tools.set(definition.name, definition)
		}),
		registerCommand: vi.fn((name: string, definition: unknown) => {
			commands.set(name, definition)
		}),
		registerFlag: vi.fn((name: string, definition: unknown) => {
			flags.set(name, definition)
		}),
		getFlag: vi.fn(() => undefined),
		getActiveTools: vi.fn(() => [...activeTools]),
		getAllTools: vi.fn(() => activeTools.map((name) => ({ name }))),
		setActiveTools: vi.fn((toolNames: string[]) => {
			activeTools.splice(0, activeTools.length, ...toolNames)
		}),
		appendEntry: vi.fn((customType: string, data?: unknown) => {
			appendedEntries.push({ customType, data })
		}),
		sendMessage: vi.fn(),
	} as unknown as ExtensionAPI & {
		appendEntry: ReturnType<typeof vi.fn>
		getActiveTools: ReturnType<typeof vi.fn>
		getAllTools: ReturnType<typeof vi.fn>
		getFlag: ReturnType<typeof vi.fn>
		registerFlag: ReturnType<typeof vi.fn>
		setActiveTools: ReturnType<typeof vi.fn>
		sendMessage: ReturnType<typeof vi.fn>
	}

	piTownPackage(pi)

	return { handlers, tools, commands, flags, appendedEntries, activeTools, pi }
}

function createToolContext(repoRoot: string, sessionFile: string) {
	return {
		hasUI: true,
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
			setWidget: vi.fn(),
			theme: {
				fg: vi.fn((_token: string, value: string) => value),
			},
		},
		cwd: repoRoot,
		sessionManager: {
			getSessionFile: () => sessionFile,
			getEntries: () => [],
		},
	}
}

describe("pi town extension", () => {
	it("injects hidden town context for managed mayor sessions", async () => {
		const { repoRoot, mayorSessionFile } = createRepoArtifacts()
		const { handlers } = setup()

		const result = await handlers["before_agent_start"]?.[0]?.(
			{ systemPrompt: "base", prompt: "coordinate", images: [] },
			createToolContext(repoRoot, mayorSessionFile),
		)

		expect(result).toEqual(
			expect.objectContaining({
				message: expect.objectContaining({
					customType: "pitown-context",
					display: false,
					content: expect.stringContaining("Recent inbox:\ninbox: empty"),
				}),
			}),
		)
	})

	it("renders the live board for town-managed sessions", async () => {
		const { repoRoot, mayorSessionFile } = createRepoArtifacts()
		const { tools } = setup()
		const boardTool = tools.get("pitown_board")

		const result = await boardTool?.execute("tool-call", {}, undefined, () => {}, createToolContext(repoRoot, mayorSessionFile))

		expect(result).toEqual(
			expect.objectContaining({
				content: [expect.objectContaining({ text: expect.stringContaining("worker-001") })],
			}),
		)
	})

	it("blocks workers from messaging non-mayor agents directly", async () => {
		const { repoRoot, workerSessionFile } = createRepoArtifacts()
		const { tools } = setup()
		const messageTool = tools.get("pitown_message_agent")

		await expect(
			messageTool?.execute(
				"tool-call",
				{ agentId: "reviewer-001", body: "please review now" },
				undefined,
				() => {},
				createToolContext(repoRoot, workerSessionFile),
			),
		).rejects.toThrow("Only the mayor may message non-mayor agents")
	})

	it("updates worker state and task status through the status tool", async () => {
		const { artifactsDir, repoRoot, workerSessionFile } = createRepoArtifacts()
		const { tools } = setup()
		const statusTool = tools.get("pitown_update_status")

		await statusTool?.execute(
			"tool-call",
			{ status: "completed", lastMessage: "auth flow fixed", blocked: false },
			undefined,
			() => {},
			createToolContext(repoRoot, workerSessionFile),
		)

		expect(readAgentState(artifactsDir, "worker-001")).toEqual(
			expect.objectContaining({
				status: "completed",
				lastMessage: "auth flow fixed",
			}),
		)
		expect(readTaskRecord(artifactsDir, "task-123")).toEqual(
			expect.objectContaining({
				status: "completed",
			}),
		)
	})

	it("shows queued mayor inbox updates as mayor UI notifications on the next turn", async () => {
		const { artifactsDir, repoRoot, mayorSessionFile, workerSessionFile } = createRepoArtifacts()
		const { handlers, tools } = setup()
		const ctx = createToolContext(repoRoot, mayorSessionFile)

		writeAgentState(
			artifactsDir,
			createAgentState({
				agentId: "mayor",
				role: "mayor",
				status: "queued",
				task: "coordinate town work",
				lastMessage: "worker-001 completed task-123",
				session: createAgentSessionRecord({
					sessionDir: join(artifactsDir, "agents", "mayor", "sessions"),
					sessionPath: mayorSessionFile,
					sessionId: "mayor",
				}),
			}),
		)

		await tools.get("pitown_message_agent")?.execute(
			"tool-call",
			{ agentId: "mayor", body: "worker-001 completed task-123 (fix the failing auth flow): auth flow fixed" },
			undefined,
			() => {},
			createToolContext(repoRoot, workerSessionFile),
		)

		await handlers["before_agent_start"]?.[1]?.(
			{ systemPrompt: "base", prompt: "follow up", images: [] },
			ctx,
		)

		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"worker-001 completed task-123 (fix the failing auth flow): auth flow fixed",
			"info",
		)
	})

	it("enables mayor plan mode with a read-only tool set", async () => {
		const { repoRoot, mayorSessionFile } = createRepoArtifacts()
		const { commands, activeTools, appendedEntries } = setup()
		const planCommand = commands.get("plan") as { handler: RegisteredHandler } | undefined
		const ctx = createToolContext(repoRoot, mayorSessionFile)

		await planCommand?.handler([], ctx)

		expect(activeTools).toEqual(["read", "grep", "find", "ls", "pitown_board", "pitown_peek_agent"])
		expect(appendedEntries.at(-1)).toEqual(
			expect.objectContaining({
				customType: "pitown-mayor-plan",
			}),
		)
	})

	it("captures numbered mayor plan steps after a planning turn", async () => {
		const { repoRoot, mayorSessionFile } = createRepoArtifacts()
		const { commands, handlers, pi } = setup()
		const planCommand = commands.get("plan") as { handler: RegisteredHandler } | undefined
		const ctx = createToolContext(repoRoot, mayorSessionFile)

		await planCommand?.handler([], ctx)
		await handlers["agent_end"]?.[0]?.(
			{
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "text",
								text: "Plan:\n1. Inspect the current board and open tasks.\n2. Split the work into two bounded worker tasks.",
							},
						],
					},
				],
			},
			ctx,
		)

		expect(pi.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				customType: "pitown-mayor-plan-captured",
				content: expect.stringContaining("1. ○ Inspect the current board and open tasks."),
			}),
			{ triggerTurn: false },
		)
	})
})

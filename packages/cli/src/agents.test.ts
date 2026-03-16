import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createRepoSlug, getRepoIdentity, readTaskRecord } from "../../core/src/index.js"
import { runCli } from "./index.js"
import { attachTownAgent } from "./attach.js"
import { showTownBoard } from "./board.js"
import { continueTownAgent } from "./continue.js"
import { delegateTownTask } from "./delegate.js"
import { messageTownAgent } from "./msg.js"
import { peekTownAgent } from "./peek.js"
import { spawnTownAgent } from "./spawn.js"

const originalHome = process.env["HOME"]
const originalPath = process.env["PATH"]
const originalCwd = process.cwd()

afterEach(() => {
	if (originalHome === undefined) delete process.env["HOME"]
	else process.env["HOME"] = originalHome

	if (originalPath === undefined) delete process.env["PATH"]
	else process.env["PATH"] = originalPath

	process.chdir(originalCwd)
})

function captureLogs(fn: () => void): string[] {
	const lines: string[] = []
	const originalLog = console.log
	console.log = (...args: unknown[]) => {
		lines.push(args.map((value) => String(value)).join(" "))
	}

	try {
		fn()
		return lines
	} finally {
		console.log = originalLog
	}
}

function createFakePi(binDir: string, logPath: string) {
	const piPath = join(binDir, "pi")
	mkdirSync(binDir, { recursive: true })
	writeFileSync(
		piPath,
		[
			"#!/bin/sh",
			`args=$(printf '%s' \"$*\" | tr '\\n' ' ' | tr -s ' ')`,
			`printf '%s\\n' \"$args\" >> ${JSON.stringify(logPath)}`,
			"session_dir=''",
			"prev=''",
			"for arg in \"$@\"; do",
			"  if [ \"$prev\" = '--session-dir' ]; then",
			"    session_dir=\"$arg\"",
			"  fi",
			"  prev=\"$arg\"",
			"done",
			"if [ -n \"$session_dir\" ]; then",
			"  mkdir -p \"$session_dir\"",
			"  printf '{\"id\":\"root\"}\\n' > \"$session_dir/2026-03-16T15-00-00-000Z_12345678-1234-1234-1234-123456789abc.jsonl\"",
			"fi",
			"printf 'pi worker summary\\n'",
			"exit 0",
		].join("\n"),
		"utf-8",
	)
	chmodSync(piPath, 0o755)
}

async function waitFor(assertion: () => void, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs
	let lastError: Error | null = null

	while (Date.now() < deadline) {
		try {
			assertion()
			return
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error))
			await new Promise((resolve) => setTimeout(resolve, 25))
		}
	}

	throw lastError ?? new Error("Timed out waiting for condition")
}

describe("agent control plane commands", () => {
	it("spawns agents, queues messages, and shows them on the board", async () => {
		const home = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		process.env["HOME"] = home
		const binDir = join(home, "bin")
		const logPath = join(home, "pi.log")
		createFakePi(binDir, logPath)
		process.env["PATH"] = `${binDir}:${originalPath ?? ""}`

		const repo = join(home, "repo")
		const repoSlug = createRepoSlug(getRepoIdentity(resolve(repo)), resolve(repo))
		mkdirSync(repo, { recursive: true })
		const sessionPath = join(
			home,
			".pi-town",
			"repos",
			repoSlug,
			"agents",
			"mayor",
			"sessions",
			"2026-03-16T15-00-00-000Z_12345678-1234-1234-1234-123456789abc.jsonl",
		)

		const spawnOutput = captureLogs(() =>
			spawnTownAgent(["--repo", repo, "--role", "mayor", "--agent", "mayor", "--task", "coordinate auth work"]),
		)
		expect(spawnOutput.join("\n")).toContain("- status: running")
		await waitFor(() => {
			expect(existsSync(sessionPath)).toBe(true)
		})
		const msgOutput = captureLogs(() => messageTownAgent(["--repo", repo, "mayor", "check the failing callback tests"]))
		expect(msgOutput.join("\n")).toContain(`- delivered to session: ${sessionPath}`)
		expect(msgOutput.join("\n")).toContain("- mayor response: pi worker summary")

		const boardOutput = captureLogs(() => showTownBoard(["--repo", repo]))
		expect(boardOutput.join("\n")).toContain("[pitown] board")
		expect(boardOutput.join("\n")).toContain("mayor")
		expect(boardOutput.join("\n")).toContain("pi worker summary")

		const peekOutput = captureLogs(() => peekTownAgent(["--repo", repo, "mayor"]))
		expect(peekOutput.join("\n")).toContain("- role: mayor")
		expect(peekOutput.join("\n")).toContain("- status: idle")
		expect(peekOutput.join("\n")).toContain("human: check the failing callback tests")
		expect(peekOutput.join("\n")).toContain("mayor: pi worker summary")

		expect(existsSync(join(home, ".pi-town", "repos"))).toBe(true)
		expect(
			JSON.parse(readFileSync(join(home, ".pi-town", "repos", repoSlug, "agents", "mayor", "state.json"), "utf-8")) as {
				lastMessage: string
			},
		).toEqual(
			expect.objectContaining({
				lastMessage: "pi worker summary",
			}),
		)
		const invocations = readFileSync(logPath, "utf-8").trim().split("\n")
		expect(invocations.at(-1)).toContain(`--session ${sessionPath} -p check the failing callback tests`)
		expect(invocations.at(-1)).toContain("--extension")
	})

	it("creates durable inbox state for spawned agents", async () => {
		const home = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		process.env["HOME"] = home
		const binDir = join(home, "bin")
		const logPath = join(home, "pi.log")
		createFakePi(binDir, logPath)
		process.env["PATH"] = `${binDir}:${originalPath ?? ""}`

		const repo = join(home, "repo")
		const repoSlug = createRepoSlug(getRepoIdentity(resolve(repo)), resolve(repo))
		mkdirSync(repo, { recursive: true })

		captureLogs(() => spawnTownAgent(["--repo", repo, "--role", "worker", "--agent", "worker-001", "--task", "fix auth callback regression"]))

		expect(existsSync(join(home, ".pi-town", "repos", repoSlug, "agents", "worker-001", "inbox.jsonl"))).toBe(true)
		expect(readFileSync(join(home, ".pi-town", "repos", repoSlug, "agents", "worker-001", "inbox.jsonl"), "utf-8")).toContain(
			"fix auth callback regression",
		)
		await waitFor(() => {
			expect(readFileSync(join(home, ".pi-town", "repos", repoSlug, "agents", "worker-001", "latest-stdout.txt"), "utf-8")).toContain(
				"pi worker summary",
			)
		})
	})

	it("attaches to and continues a specific persisted agent session", async () => {
		const home = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		process.env["HOME"] = home

		const binDir = join(home, "bin")
		const logPath = join(home, "pi.log")
		createFakePi(binDir, logPath)
		process.env["PATH"] = `${binDir}:${originalPath ?? ""}`

		const repo = join(home, "repo")
		const repoSlug = createRepoSlug(getRepoIdentity(resolve(repo)), resolve(repo))
		mkdirSync(repo, { recursive: true })

		captureLogs(() => spawnTownAgent(["--repo", repo, "--role", "mayor", "--agent", "mayor", "--task", "coordinate auth work"]))
		const sessionPath = join(
			home,
			".pi-town",
			"repos",
			repoSlug,
			"agents",
			"mayor",
			"sessions",
			"2026-03-16T15-00-00-000Z_12345678-1234-1234-1234-123456789abc.jsonl",
		)
		await waitFor(() => {
			expect(existsSync(sessionPath)).toBe(true)
		})

		captureLogs(() => attachTownAgent(["--repo", repo, "mayor"]))
		captureLogs(() => continueTownAgent(["--repo", repo, "mayor", "follow up on the auth test failures"]))

		const invocations = readFileSync(logPath, "utf-8")
			.trim()
			.split("\n")
			.filter((line) => line !== "--help")
		expect(invocations.at(-2)).toContain(`--session ${sessionPath}`)
		expect(invocations.at(-2)).toContain("--extension")
		expect(invocations.at(-2)).toContain("--append-system-prompt")
		expect(invocations.at(-1)).toContain(`--session ${sessionPath} follow up on the auth test failures`)
		expect(invocations.at(-1)).toContain("--extension")

		const state = JSON.parse(
			readFileSync(join(home, ".pi-town", "repos", repoSlug, "agents", "mayor", "state.json"), "utf-8"),
		) as {
			session: { sessionPath: string; sessionId: string }
		}
		expect(state.session.sessionPath).toBe(sessionPath)
		expect(state.session.sessionId).toBe("12345678-1234-1234-1234-123456789abc")
	})

	it("delegates from the mayor into a worker with a durable task record", async () => {
		const home = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		process.env["HOME"] = home

		const binDir = join(home, "bin")
		const logPath = join(home, "pi.log")
		createFakePi(binDir, logPath)
		process.env["PATH"] = `${binDir}:${originalPath ?? ""}`

		const repo = join(home, "repo")
		const repoSlug = createRepoSlug(getRepoIdentity(resolve(repo)), resolve(repo))
		mkdirSync(repo, { recursive: true })

		captureLogs(() => spawnTownAgent(["--repo", repo, "--role", "mayor", "--agent", "mayor", "--task", "coordinate auth work"]))
		await waitFor(() => {
			const mayorState = JSON.parse(readFileSync(join(home, ".pi-town", "repos", repoSlug, "agents", "mayor", "state.json"), "utf-8")) as {
				status: string
			}
			expect(mayorState.status).toBe("idle")
		})
		const delegateOutput = captureLogs(() =>
			delegateTownTask(["--repo", repo, "--from", "mayor", "--role", "worker", "--agent", "worker-001", "--task", "fix callback auth regression"]),
		)
		expect(delegateOutput.join("\n")).toContain("[pitown] delegate")
		expect(delegateOutput.join("\n")).toContain("- agent: worker-001")
		expect(delegateOutput.join("\n")).toContain("- status: running")

		await waitFor(() => {
			const workerState = JSON.parse(
				readFileSync(join(home, ".pi-town", "repos", repoSlug, "agents", "worker-001", "state.json"), "utf-8"),
			) as {
				status: string
			}
			expect(workerState.status).toBe("idle")
		})

		const workerState = JSON.parse(
			readFileSync(join(home, ".pi-town", "repos", repoSlug, "agents", "worker-001", "state.json"), "utf-8"),
		) as {
			taskId: string
			task: string
			status: string
		}
		expect(workerState.task).toBe("fix callback auth regression")
		expect(workerState.taskId).toContain("task-")
		expect(workerState.status).toBe("idle")

		const boardOutput = captureLogs(() => showTownBoard(["--repo", repo]))
		expect(boardOutput.join("\n")).toContain("worker-001")
		expect(boardOutput.join("\n")).toContain(workerState.taskId)

		const task = readTaskRecord(join(home, ".pi-town", "repos", repoSlug), workerState.taskId)
		expect(task).toEqual(
			expect.objectContaining({
				taskId: workerState.taskId,
				assignedAgentId: "worker-001",
				createdBy: "mayor",
				role: "worker",
				status: "completed",
			}),
		)

		expect(readFileSync(join(home, ".pi-town", "repos", repoSlug, "agents", "mayor", "outbox.jsonl"), "utf-8")).toContain(
			`Delegated ${workerState.taskId} to worker-001`,
		)
		expect(readFileSync(join(home, ".pi-town", "repos", repoSlug, "agents", "worker-001", "inbox.jsonl"), "utf-8")).toContain(
			`Delegated by mayor as ${workerState.taskId}`,
		)
	})

	it("opens the mayor for the current repo without requiring --repo", () => {
		const home = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		process.env["HOME"] = home

		const binDir = join(home, "bin")
		const logPath = join(home, "pi.log")
		createFakePi(binDir, logPath)
		process.env["PATH"] = `${binDir}:${originalPath ?? ""}`

		const repo = join(home, "repo")
		mkdirSync(repo, { recursive: true })
		process.chdir(repo)

		captureLogs(() => runCli(["mayor"]))
		const repoSlug = readdirSync(join(home, ".pi-town", "repos"))[0] as string

		const sessionPath = join(
			home,
			".pi-town",
			"repos",
			repoSlug,
			"agents",
			"mayor",
			"sessions",
			"2026-03-16T15-00-00-000Z_12345678-1234-1234-1234-123456789abc.jsonl",
		)
		const invocations = readFileSync(logPath, "utf-8").trim().split("\n")
		expect(invocations.at(-1)).toContain(
			`--session-dir ${join(home, ".pi-town", "repos", repoSlug, "agents", "mayor", "sessions")}`,
		)
		expect(invocations.at(-1)).toContain("--extension")
		expect(invocations.at(-1)).toContain("--append-system-prompt")
		expect(readFileSync(join(home, ".pi-town", "repos", repoSlug, "agents", "mayor", "state.json"), "utf-8")).toContain(
			'"role": "mayor"',
		)
		expect(readFileSync(join(home, ".pi-town", "repos", repoSlug, "agents", "mayor", "session.json"), "utf-8")).toContain(
			sessionPath,
		)
	})

	it("opens the mayor when running bare pitown in a repo", () => {
		const home = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		process.env["HOME"] = home

		const binDir = join(home, "bin")
		const logPath = join(home, "pi.log")
		createFakePi(binDir, logPath)
		process.env["PATH"] = `${binDir}:${originalPath ?? ""}`

		const repo = join(home, "repo")
		mkdirSync(repo, { recursive: true })
		process.chdir(repo)

		captureLogs(() => runCli([]))
		const repoSlug = readdirSync(join(home, ".pi-town", "repos"))[0] as string
		const sessionPath = join(
			home,
			".pi-town",
			"repos",
			repoSlug,
			"agents",
			"mayor",
			"sessions",
			"2026-03-16T15-00-00-000Z_12345678-1234-1234-1234-123456789abc.jsonl",
		)

		const invocations = readFileSync(logPath, "utf-8").trim().split("\n")
		expect(invocations.at(-1)).toContain(
			`--session-dir ${join(home, ".pi-town", "repos", repoSlug, "agents", "mayor", "sessions")}`,
		)
		expect(invocations.at(-1)).toContain("--extension")
		expect(invocations.at(-1)).toContain("--append-system-prompt")
		expect(readFileSync(join(home, ".pi-town", "repos", repoSlug, "agents", "mayor", "session.json"), "utf-8")).toContain(
			sessionPath,
		)
	})
})

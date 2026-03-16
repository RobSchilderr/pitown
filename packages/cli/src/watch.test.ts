import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
	createAgentSessionRecord,
	createAgentState,
	createRepoSlug,
	createTaskRecord,
	getRepoIdentity,
	writeAgentState,
	writeTaskRecord,
} from "../../core/src/index.js"
import { buildWatchSnapshot, createWatchFingerprint, renderWatchSnapshot } from "./watch.js"

const originalHome = process.env["HOME"]

afterEach(() => {
	if (originalHome === undefined) delete process.env["HOME"]
	else process.env["HOME"] = originalHome
})

describe("watch snapshot", () => {
	it("renders board state from durable control-plane files", () => {
		const home = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		process.env["HOME"] = home

		const repoRoot = join(home, "repo")
		mkdirSync(repoRoot, { recursive: true })
		const repoSlug = createRepoSlug(getRepoIdentity(resolve(repoRoot)), resolve(repoRoot))
		const artifactsDir = join(home, ".pi-town", "repos", repoSlug)

		writeAgentState(
			artifactsDir,
			createAgentState({
				agentId: "mayor",
				role: "mayor",
				status: "running",
				task: "coordinate the auth fix",
				lastMessage: "delegating worker tasks",
				session: createAgentSessionRecord(),
			}),
		)
		writeAgentState(
			artifactsDir,
			createAgentState({
				agentId: "worker-001",
				role: "worker",
				status: "running",
				taskId: "task-001",
				task: "fix callback auth regression",
				lastMessage: "investigating redirect",
				session: createAgentSessionRecord(),
			}),
		)
		writeTaskRecord(
			artifactsDir,
			createTaskRecord({
				taskId: "task-001",
				title: "fix callback auth regression",
				status: "running",
				role: "worker",
				assignedAgentId: "worker-001",
				createdBy: "mayor",
			}),
		)

		writeFileSync(
			join(artifactsDir, "latest-run.json"),
			JSON.stringify(
				{
					repoSlug,
					repoRoot,
					runId: "run-123",
					runDir: join(artifactsDir, "runs", "run-123"),
					latestDir: join(artifactsDir, "latest"),
					manifestPath: join(artifactsDir, "latest", "manifest.json"),
					metricsPath: join(artifactsDir, "latest", "metrics.json"),
					summaryPath: join(artifactsDir, "latest", "run-summary.json"),
				},
				null,
				2,
			),
		)
		mkdirSync(join(artifactsDir, "latest"), { recursive: true })
		writeFileSync(
			join(artifactsDir, "latest", "manifest.json"),
			JSON.stringify(
				{
					repoRoot,
					branch: "workspace",
					goal: "stabilize auth flow",
					stopReason: null,
				},
				null,
				2,
			),
		)
		writeFileSync(
			join(artifactsDir, "latest", "run-summary.json"),
			JSON.stringify(
				{
					runId: "run-123",
					mode: "single-pi",
					piExitCode: 0,
					message: "Pi invocation completed.",
				},
				null,
				2,
			),
		)

		const snapshot = buildWatchSnapshot(["--repo", repoRoot])
		expect(snapshot.summary.runId).toBe("run-123")
		expect(snapshot.agents).toHaveLength(2)
		expect(snapshot.tasks).toHaveLength(1)

		const rendered = renderWatchSnapshot(snapshot).join("\n")
		expect(rendered).toContain("[pitown] watch")
		expect(rendered).toContain("worker-001")
		expect(rendered).toContain("task-001")
		expect(rendered).toContain("stabilize auth flow")
	})

	it("changes fingerprint when agent/task state changes", () => {
		const home = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		process.env["HOME"] = home

		const repoRoot = join(home, "repo")
		mkdirSync(repoRoot, { recursive: true })
		const repoSlug = createRepoSlug(getRepoIdentity(resolve(repoRoot)), resolve(repoRoot))
		const artifactsDir = join(home, ".pi-town", "repos", repoSlug)

		writeAgentState(
			artifactsDir,
			createAgentState({
				agentId: "worker-001",
				role: "worker",
				status: "running",
				taskId: "task-001",
				task: "ship the fix",
				session: createAgentSessionRecord(),
			}),
		)
		writeTaskRecord(
			artifactsDir,
			createTaskRecord({
				taskId: "task-001",
				title: "ship the fix",
				status: "running",
				role: "worker",
				assignedAgentId: "worker-001",
				createdBy: "mayor",
			}),
		)

		const before = createWatchFingerprint(buildWatchSnapshot(["--repo", repoRoot]))

		writeAgentState(
			artifactsDir,
			createAgentState({
				agentId: "worker-001",
				role: "worker",
				status: "idle",
				taskId: "task-001",
				task: "ship the fix",
				lastMessage: "done",
				session: createAgentSessionRecord(),
			}),
		)
		writeTaskRecord(
			artifactsDir,
			createTaskRecord({
				taskId: "task-001",
				title: "ship the fix",
				status: "completed",
				role: "worker",
				assignedAgentId: "worker-001",
				createdBy: "mayor",
			}),
		)

		const after = createWatchFingerprint(buildWatchSnapshot(["--repo", repoRoot]))
		expect(after).not.toBe(before)
	})
})

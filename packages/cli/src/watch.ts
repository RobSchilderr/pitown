import { existsSync, readFileSync } from "node:fs"
import { basename } from "node:path"
import { getCurrentBranch, listAgentStates, listTaskRecords } from "../../core/src/index.js"
import { isDirectExecution } from "./entrypoint.js"
import { getTownHomeDir } from "./paths.js"
import { resolveRepoContext } from "./repo-context.js"
import { resolveLatestRunPointer } from "./status.js"

interface WatchSummarySnapshot {
	runId: string | null
	piExitCode: number | null
	mode: string | null
	message: string | null
	stopReason: string | null
}

interface WatchManifestSnapshot {
	branch: string | null
	goal: string | null
	planPath: string | null
	recommendedPlanDir: string | null
}

export interface WatchSnapshot {
	repoRoot: string
	repoSlug: string
	repoName: string
	branch: string | null
	summary: WatchSummarySnapshot
	manifest: WatchManifestSnapshot
	agents: ReturnType<typeof listAgentStates>
	tasks: ReturnType<typeof listTaskRecords>
}

function readJsonIfExists<T>(path: string): T | null {
	if (!existsSync(path)) return null

	try {
		return JSON.parse(readFileSync(path, "utf-8")) as T
	} catch {
		return null
	}
}

function truncate(text: string | null | undefined, max: number): string {
	if (!text) return "—"
	const single = text.replace(/\n/g, " ").trim()
	if (single.length <= max) return single
	return `${single.slice(0, max - 1)}...`
}

export function buildWatchSnapshot(argv = process.argv.slice(2)): WatchSnapshot {
	const repo = resolveRepoContext(argv)
	const latest = resolveLatestRunPointer(["--repo", repo.repoRoot])
	const summary = latest
		? (readJsonIfExists<{ runId?: string; piExitCode?: number; mode?: string; message?: string }>(latest.summaryPath) ?? null)
		: null
	const manifest = latest
		? (readJsonIfExists<{ branch?: string; goal?: string | null; planPath?: string | null; recommendedPlanDir?: string | null; stopReason?: string | null }>(
				latest.manifestPath,
			) ?? null)
		: null

	return {
		repoRoot: repo.repoRoot,
		repoSlug: repo.repoSlug,
		repoName: basename(repo.repoRoot),
		branch: getCurrentBranch(repo.repoRoot),
		summary: {
			runId: summary?.runId ?? null,
			piExitCode: summary?.piExitCode ?? null,
			mode: summary?.mode ?? null,
			message: summary?.message ?? null,
			stopReason: manifest?.stopReason ?? null,
		},
		manifest: {
			branch: manifest?.branch ?? null,
			goal: manifest?.goal ?? null,
			planPath: manifest?.planPath ?? null,
			recommendedPlanDir: manifest?.recommendedPlanDir ?? null,
		},
		agents: listAgentStates(repo.artifactsDir),
		tasks: listTaskRecords(repo.artifactsDir),
	}
}

export function createWatchFingerprint(snapshot: WatchSnapshot): string {
	return JSON.stringify({
		summary: snapshot.summary,
		manifest: snapshot.manifest,
		agents: snapshot.agents.map((agent) => ({
			agentId: agent.agentId,
			role: agent.role,
			status: agent.status,
			taskId: agent.taskId,
			task: agent.task,
			lastMessage: agent.lastMessage,
			waitingOn: agent.waitingOn,
			blocked: agent.blocked,
			updatedAt: agent.updatedAt,
		})),
		tasks: snapshot.tasks.map((task) => ({
			taskId: task.taskId,
			title: task.title,
			status: task.status,
			assignedAgentId: task.assignedAgentId,
			updatedAt: task.updatedAt,
		})),
	})
}

export function renderWatchSnapshot(snapshot: WatchSnapshot): string[] {
	const branchLabel = snapshot.branch ? ` (${snapshot.branch})` : ""
	const lines = [`[pitown] watch - ${snapshot.repoName}${branchLabel}`]

	lines.push(`- town home: ${getTownHomeDir()}`)
	lines.push(`- repo root: ${snapshot.repoRoot}`)
	if (snapshot.summary.runId) lines.push(`- latest run: ${snapshot.summary.runId}`)
	if (snapshot.summary.mode) lines.push(`- mode: ${snapshot.summary.mode}`)
	if (snapshot.summary.piExitCode !== null) lines.push(`- latest pi exit code: ${snapshot.summary.piExitCode}`)
	if (snapshot.summary.stopReason) lines.push(`- stop reason: ${snapshot.summary.stopReason}`)
	if (snapshot.manifest.goal) lines.push(`- goal: ${snapshot.manifest.goal}`)
	if (snapshot.manifest.planPath) lines.push(`- plan path: ${snapshot.manifest.planPath}`)
	if (!snapshot.manifest.planPath && snapshot.manifest.recommendedPlanDir) {
		lines.push(`- recommended plans: ${snapshot.manifest.recommendedPlanDir}`)
	}
	if (snapshot.summary.message) lines.push(`- note: ${snapshot.summary.message}`)

	lines.push("")
	lines.push("Agents:")
	if (snapshot.agents.length === 0) {
		lines.push("  (no agents)")
	} else {
		for (const agent of snapshot.agents) {
			const id = agent.agentId.padEnd(14)
			const role = agent.role.padEnd(10)
			const status = agent.status.padEnd(10)
			const task = truncate(agent.task, 56)
			const msg = agent.lastMessage ? ` | ${truncate(agent.lastMessage, 36)}` : ""
			const waiting = agent.waitingOn ? ` | waiting on: ${agent.waitingOn}` : ""
			lines.push(`  ${id}${role}${status}${task}${msg}${waiting}`)
		}
	}

	lines.push("")
	lines.push("Tasks:")
	if (snapshot.tasks.length === 0) {
		lines.push("  (no tasks)")
	} else {
		for (const task of snapshot.tasks) {
			const id = task.taskId.padEnd(14)
			const status = task.status.padEnd(12)
			const assignee = task.assignedAgentId.padEnd(14)
			lines.push(`  ${id}${status}${assignee}${truncate(task.title, 56)}`)
		}
	}

	return lines
}

function printSnapshot(snapshot: WatchSnapshot) {
	console.log(renderWatchSnapshot(snapshot).join("\n"))
}

export function watchTown(argv = process.argv.slice(2)) {
	const initialSnapshot = buildWatchSnapshot(argv)
	let previousFingerprint = createWatchFingerprint(initialSnapshot)

	printSnapshot(initialSnapshot)
	console.log("- press Ctrl+C to stop")

	const interval = setInterval(() => {
		const nextSnapshot = buildWatchSnapshot(argv)
		const nextFingerprint = createWatchFingerprint(nextSnapshot)
		if (nextFingerprint === previousFingerprint) return

		previousFingerprint = nextFingerprint
		console.log("")
		console.log(`[pitown] watch update - ${new Date().toISOString()}`)
		printSnapshot(nextSnapshot)
	}, 1000)

	const stopWatching = () => {
		clearInterval(interval)
	}

	process.once("SIGINT", stopWatching)
	process.once("SIGTERM", stopWatching)
}

if (isDirectExecution(import.meta.url)) {
	watchTown()
}

import { existsSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { getCurrentBranch, listAgentStates, listTaskRecords } from "../../core/src/index.js"
import type { MetricsSnapshot } from "../../core/src/index.js"
import { resolveRepoContext } from "./repo-context.js"

function truncate(text: string | null | undefined, max: number): string {
	if (!text) return "—"
	const single = text.replace(/\n/g, " ").trim()
	if (single.length <= max) return single
	return `${single.slice(0, max - 1)}…`
}

export function showTownBoard(argv = process.argv.slice(2)) {
	const repo = resolveRepoContext(argv)
	const agents = listAgentStates(repo.artifactsDir)
	const tasks = listTaskRecords(repo.artifactsDir)

	const repoName = basename(repo.repoRoot)
	const branch = getCurrentBranch(repo.repoRoot)
	const branchLabel = branch ? ` (${branch})` : ""

	console.log(`[pitown] board — ${repoName}${branchLabel}`)

	// --- Agents section ---
	console.log("")
	console.log("Agents:")
	if (agents.length === 0) {
		console.log("  (no agents)")
	} else {
		for (const agent of agents) {
			const id = agent.agentId.padEnd(14)
			const role = agent.role.padEnd(10)
			const status = agent.status.padEnd(10)
			const task = truncate(agent.task, 60)
			const msg = agent.lastMessage ? ` | ${truncate(agent.lastMessage, 40)}` : ""
			const waiting = agent.waitingOn ? ` | waiting on: ${agent.waitingOn}` : ""
			console.log(`  ${id}${role}${status}${task}${msg}${waiting}`)
		}
	}

	// --- Tasks section ---
	console.log("")
	console.log("Tasks:")
	if (tasks.length === 0) {
		console.log("  (no tasks)")
	} else {
		for (const task of tasks) {
			const id = task.taskId.padEnd(14)
			const status = task.status.padEnd(12)
			const assignee = (task.assignedAgentId ?? "—").padEnd(14)
			const title = truncate(task.title, 60)
			console.log(`  ${id}${status}${assignee}${title}`)
		}
	}

	// --- Metrics section ---
	const metricsPath = join(repo.artifactsDir, "latest", "metrics.json")
	if (existsSync(metricsPath)) {
		try {
			const metrics = JSON.parse(readFileSync(metricsPath, "utf-8")) as MetricsSnapshot
			console.log("")
			console.log("Metrics (latest run):")
			console.log(`  Interrupt Rate:              ${fmt(metrics.interruptRate)}`)
			console.log(`  Autonomous Completion Rate:  ${fmt(metrics.autonomousCompletionRate)}`)
			console.log(`  Context Coverage Score:      ${fmt(metrics.contextCoverageScore)}`)
			console.log(`  MTTC:                        ${metrics.meanTimeToCorrectHours != null ? `${metrics.meanTimeToCorrectHours}h` : "—"}`)
			console.log(`  Feedback-to-Demo:            ${metrics.feedbackToDemoCycleTimeHours != null ? `${metrics.feedbackToDemoCycleTimeHours}h` : "—"}`)
		} catch {
			// skip metrics if unreadable
		}
	}
}

function fmt(value: number | null | undefined): string {
	if (value == null) return "—"
	return String(value)
}

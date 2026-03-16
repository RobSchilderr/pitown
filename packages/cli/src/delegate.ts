import {
	delegateTask,
	readAgentState,
} from "../../core/src/index.js"
import { resolvePiTownExtensionPath } from "@schilderlabs/pitown-package"
import { normalizeAgentId } from "./agent-id.js"
import { resolveRepoContext } from "./repo-context.js"

interface DelegateFlags {
	from: string
	role: string
	agentId: string | null
	task: string | null
}

function parseDelegateFlags(argv: string[]): DelegateFlags {
	let from = "leader"
	let role = "worker"
	let agentId: string | null = null
	let task: string | null = null

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]

		if (arg.startsWith("--from=")) {
			from = arg.slice("--from=".length)
			continue
		}
		if (arg === "--from") {
			from = argv[index + 1] ?? from
			index += 1
			continue
		}
		if (arg.startsWith("--role=")) {
			role = arg.slice("--role=".length)
			continue
		}
		if (arg === "--role") {
			role = argv[index + 1] ?? role
			index += 1
			continue
		}
		if (arg.startsWith("--agent=")) {
			agentId = arg.slice("--agent=".length)
			continue
		}
		if (arg === "--agent") {
			agentId = argv[index + 1] ?? null
			index += 1
			continue
		}
		if (arg.startsWith("--task=")) {
			task = arg.slice("--task=".length)
			continue
		}
		if (arg === "--task") {
			task = argv[index + 1] ?? null
			index += 1
			continue
		}

		throw new Error(`Unknown argument: ${arg}`)
	}

	if (!task) {
		throw new Error("Usage: pitown delegate [--repo <path>] [--from <agent>] [--role <role>] [--agent <id>] --task <text>")
	}

	return { from, role, agentId, task }
}

export function delegateTownTask(argv = process.argv.slice(2)) {
	const repo = resolveRepoContext(argv)
	const flags = parseDelegateFlags(repo.rest)
	const fromAgentId = normalizeAgentId(flags.from)
	const fromState = readAgentState(repo.artifactsDir, fromAgentId)
	if (fromState === null) throw new Error(`Unknown delegating agent: ${fromAgentId}`)

	const { agentId, latestSession, piResult, task } = delegateTask({
		repoRoot: repo.repoRoot,
		artifactsDir: repo.artifactsDir,
		fromAgentId: fromAgentId,
		role: flags.role,
		agentId: flags.agentId,
		task: flags.task,
		extensionPath: resolvePiTownExtensionPath(),
	})

	console.log("[pitown] delegate")
	console.log(`- repo root: ${repo.repoRoot}`)
	console.log(`- from: ${fromAgentId}`)
	console.log(`- task id: ${task.taskId}`)
	console.log(`- agent: ${agentId}`)
	console.log(`- role: ${flags.role}`)
	console.log(`- pi exit code: ${piResult.exitCode}`)
	if (latestSession.sessionPath) console.log(`- session: ${latestSession.sessionPath}`)
}

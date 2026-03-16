import { spawnAgentRun } from "../../core/src/index.js"
import { resolvePiTownExtensionPath } from "@schilderlabs/pitown-package"
import { resolveRepoContext } from "./repo-context.js"

interface SpawnFlags {
	role: string
	agentId: string | null
	task: string | null
}

export interface SpawnAgentOptions {
	repoRoot: string
	artifactsDir: string
	role: string
	agentId: string
	task: string | null
	taskId?: string | null
	appendedSystemPrompt?: string | null
	extensionPath?: string | null
}

function parseSpawnFlags(argv: string[]): SpawnFlags {
	let role: string | null = null
	let agentId: string | null = null
	let task: string | null = null

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]
		if (arg === undefined) continue

		if (arg.startsWith("--role=")) {
			role = arg.slice("--role=".length)
			continue
		}

		if (arg === "--role") {
			role = argv[index + 1] ?? null
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

	if (!role) throw new Error("Usage: pitown spawn [--repo <path>] --role <role> [--agent <id>] [--task <text>]")
	return { role, agentId, task }
}

export function spawnAgent(options: SpawnAgentOptions) {
	return spawnAgentRun(options)
}

export function spawnTownAgent(argv = process.argv.slice(2)) {
	const repo = resolveRepoContext(argv)
	const flags = parseSpawnFlags(repo.rest)
	const agentId = flags.agentId ?? `${flags.role}-${Date.now()}`
	const task = flags.task
	const { launch, latestSession } = spawnAgent({
		repoRoot: repo.repoRoot,
		artifactsDir: repo.artifactsDir,
		role: flags.role,
		agentId,
		task,
		extensionPath: resolvePiTownExtensionPath(),
	})

	console.log("[pitown] spawn")
	console.log(`- repo root: ${repo.repoRoot}`)
	console.log(`- agent: ${agentId}`)
	console.log(`- role: ${flags.role}`)
	console.log(`- status: running`)
	console.log(`- launch pid: ${launch.processId}`)
	if (task) console.log(`- task: ${task}`)
	if (latestSession.sessionPath) console.log(`- session: ${latestSession.sessionPath}`)
	else if (latestSession.sessionDir) console.log(`- session dir: ${latestSession.sessionDir}`)
}

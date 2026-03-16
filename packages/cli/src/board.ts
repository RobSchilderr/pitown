import { listAgentStates } from "../../core/src/index.js"
import { getRepoAgentsDir } from "./paths.js"
import { resolveRepoContext } from "./repo-context.js"

export function showTownBoard(argv = process.argv.slice(2)) {
	const repo = resolveRepoContext(argv)
	const agents = listAgentStates(repo.artifactsDir)

	console.log("[pitown] board")
	console.log(`- repo root: ${repo.repoRoot}`)
	console.log(`- agents dir: ${getRepoAgentsDir(repo.repoSlug)}`)

	if (agents.length === 0) {
		console.log("- no agents found yet")
		return
	}

	for (const agent of agents) {
		const task = agent.task ?? "no active task"
		const note = agent.lastMessage ? ` | ${agent.lastMessage}` : ""
		const waitingOn = agent.waitingOn ? ` | waiting on: ${agent.waitingOn}` : ""
		const taskId = agent.taskId ? ` [${agent.taskId}]` : ""
		console.log(`${agent.agentId.padEnd(12)} ${agent.status.padEnd(8)} ${task}${taskId}${note}${waitingOn}`)
	}
}

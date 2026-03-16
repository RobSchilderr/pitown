import { readAgentMessages, readAgentState } from "../../core/src/index.js"
import { normalizeAgentId } from "./agent-id.js"
import { resolveRepoContext } from "./repo-context.js"

function printMessages(label: string, lines: { from: string; body: string; createdAt: string }[]) {
	console.log(`- ${label}:`)
	if (lines.length === 0) {
		console.log("  (empty)")
		return
	}

	for (const line of lines) {
		console.log(`  ${line.createdAt} ${line.from}: ${line.body}`)
	}
}

export function peekTownAgent(argv = process.argv.slice(2)) {
	const repo = resolveRepoContext(argv)
	const [agentArg] = repo.rest
	const agentId = normalizeAgentId(agentArg ?? "mayor")

	const state = readAgentState(repo.artifactsDir, agentId)
	if (state === null) throw new Error(`Unknown agent: ${agentId}`)

	console.log("[pitown] peek")
	console.log(`- repo root: ${repo.repoRoot}`)
	console.log(`- agent: ${state.agentId}`)
	console.log(`- role: ${state.role}`)
	console.log(`- status: ${state.status}`)
	if (state.taskId) console.log(`- task id: ${state.taskId}`)
	if (state.task) console.log(`- task: ${state.task}`)
	if (state.branch) console.log(`- branch: ${state.branch}`)
	console.log(`- blocked: ${state.blocked}`)
	if (state.waitingOn) console.log(`- waiting on: ${state.waitingOn}`)
	if (state.lastMessage) console.log(`- last message: ${state.lastMessage}`)
	if (state.session.sessionId) console.log(`- session id: ${state.session.sessionId}`)
	if (state.session.sessionPath) console.log(`- session path: ${state.session.sessionPath}`)
	console.log(`- updated at: ${state.updatedAt}`)

	printMessages("recent inbox", readAgentMessages(repo.artifactsDir, agentId, "inbox").slice(-5))
	printMessages("recent outbox", readAgentMessages(repo.artifactsDir, agentId, "outbox").slice(-5))
}

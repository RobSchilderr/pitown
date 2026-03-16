import {
	queueAgentMessage,
	readAgentState,
	runAgentTurn,
} from "../../core/src/index.js"
import { normalizeAgentId } from "./agent-id.js"
import { createPiTownRuntimeArgs } from "./pi-runtime.js"
import { resolveRepoContext } from "./repo-context.js"

export function messageTownAgent(argv = process.argv.slice(2)) {
	const repo = resolveRepoContext(argv)
	const [agentArg, ...messageParts] = repo.rest
	if (!agentArg || messageParts.length === 0) throw new Error('Usage: pitown msg [--repo <path>] <agent> "message"')
	const agentId = normalizeAgentId(agentArg)

	const state = readAgentState(repo.artifactsDir, agentId)
	if (state === null) throw new Error(`Unknown agent: ${agentId}`)

	const body = messageParts.join(" ").trim()
	queueAgentMessage({ artifactsDir: repo.artifactsDir, agentId, from: "human", body })

	const deliveredResult =
		state.role === "leader"
			? runAgentTurn({
					repoRoot: repo.repoRoot,
					artifactsDir: repo.artifactsDir,
					agentId,
					message: body,
					from: "human",
					runtimeArgs: createPiTownRuntimeArgs({
						agentId,
						sessionPath: state.session.sessionPath,
						prompt: body,
					}),
				})
			: null

	console.log("[pitown] msg")
	console.log(`- repo root: ${repo.repoRoot}`)
	console.log(`- agent: ${agentId}`)
	console.log(`- queued message: ${body}`)
	if (deliveredResult) {
		console.log(`- delivered to session: ${deliveredResult.latestSession.sessionPath}`)
		console.log(`- leader response: ${deliveredResult.completionMessage}`)
	}
}

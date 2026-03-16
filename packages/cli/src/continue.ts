import {
	assertCommandAvailable,
	resolveAgentSession,
	runCommandInteractive,
	writeAgentState,
} from "../../core/src/index.js"
import { normalizeAgentId } from "./agent-id.js"
import { createPiTownRuntimeArgs } from "./pi-runtime.js"
import { resolveRepoContext } from "./repo-context.js"

export function continueTownAgent(argv = process.argv.slice(2)) {
	const repo = resolveRepoContext(argv)
	const [agentArg, ...messageParts] = repo.rest
	if (!agentArg) throw new Error('Usage: pitown continue [--repo <path>] <agent> ["message"]')
	const agentId = normalizeAgentId(agentArg)

	assertCommandAvailable("pi")
	const resolved = resolveAgentSession(agentId, repo.artifactsDir)
	writeAgentState(repo.artifactsDir, { ...resolved.state, session: resolved.session })

	const message = messageParts.join(" ").trim()
	const args = createPiTownRuntimeArgs({
		agentId,
		sessionPath: resolved.session.sessionPath,
		message: message || null,
	})

	console.log("[pitown] continue")
	console.log(`- repo root: ${repo.repoRoot}`)
	console.log(`- agent: ${agentId}`)
	console.log(`- session: ${resolved.session.sessionPath}`)
	if (message) console.log(`- message: ${message}`)

	const exitCode = runCommandInteractive("pi", args, {
		cwd: repo.repoRoot,
		env: process.env,
	})
	if (exitCode !== 0) process.exitCode = exitCode
}

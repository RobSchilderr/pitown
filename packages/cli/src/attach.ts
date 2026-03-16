import {
	assertCommandAvailable,
	resolveAgentSession,
	runCommandInteractive,
	writeAgentState,
} from "../../core/src/index.js"
import { normalizeAgentId } from "./agent-id.js"
import { createPiTownRuntimeArgs } from "./pi-runtime.js"
import { resolveRepoContext } from "./repo-context.js"

export function attachTownAgent(argv = process.argv.slice(2)) {
	const repo = resolveRepoContext(argv)
	const [agentArg] = repo.rest
	if (!agentArg) throw new Error("Usage: pitown attach [--repo <path>] <agent>")
	const agentId = normalizeAgentId(agentArg)

	assertCommandAvailable("pi")
	const resolved = resolveAgentSession(agentId, repo.artifactsDir)
	writeAgentState(repo.artifactsDir, { ...resolved.state, session: resolved.session })

	console.log("[pitown] attach")
	console.log(`- repo root: ${repo.repoRoot}`)
	console.log(`- agent: ${agentId}`)
	console.log(`- session: ${resolved.session.sessionPath}`)

	const exitCode = runCommandInteractive(
		"pi",
		createPiTownRuntimeArgs({
			agentId,
			sessionPath: resolved.session.sessionPath,
		}),
		{
			cwd: repo.repoRoot,
			env: process.env,
		},
	)
	if (exitCode !== 0) process.exitCode = exitCode
}

import {
	assertCommandAvailable,
	createAgentSessionRecord,
	createAgentState,
	getAgentSessionsDir,
	getLatestAgentSession,
	readAgentState,
	runCommandInteractive,
	writeAgentState,
} from "../../core/src/index.js"
import { attachTownAgent } from "./attach.js"
import { continueTownAgent } from "./continue.js"
import { createPiTownRuntimeArgs } from "./pi-runtime.js"
import { resolveRepoContext } from "./repo-context.js"
import { runTown } from "./run.js"

function startFreshMayorSession(repoRoot: string, artifactsDir: string) {
	const sessionDir = getAgentSessionsDir(artifactsDir, "leader")
	writeAgentState(
		artifactsDir,
		createAgentState({
			agentId: "leader",
			role: "leader",
			status: "running",
			task: "open the mayor session and plan the next steps for this repository",
			lastMessage: "Mayor session opened",
			session: createAgentSessionRecord({
				sessionDir,
			}),
		}),
	)

	console.log("[pitown] mayor")
	console.log(`- repo root: ${repoRoot}`)
	console.log("- starting a new mayor session")

	const exitCode = runCommandInteractive(
		"pi",
		createPiTownRuntimeArgs({
			agentId: "leader",
			sessionDir,
		}),
		{
			cwd: repoRoot,
			env: process.env,
		},
	)
	const latestSession = getLatestAgentSession(artifactsDir, "leader")
	const previousState = readAgentState(artifactsDir, "leader")
	if (previousState !== null) {
		writeAgentState(
			artifactsDir,
			createAgentState({
				...previousState,
				status: exitCode === 0 ? "idle" : "blocked",
				lastMessage: exitCode === 0 ? "Mayor session closed" : `Mayor session exited with code ${exitCode}`,
				blocked: exitCode !== 0,
				waitingOn: exitCode === 0 ? null : "human-or-follow-up-run",
				session: createAgentSessionRecord({
					sessionDir: latestSession.sessionDir,
					sessionId: latestSession.sessionId,
					sessionPath: latestSession.sessionPath,
				}),
			}),
		)
	}

	if (exitCode !== 0) process.exitCode = exitCode
}

export function openTownMayor(argv = process.argv.slice(2)) {
	const repo = resolveRepoContext(argv)
	const message = repo.rest.join(" ").trim()
	const mayorState = readAgentState(repo.artifactsDir, "leader")

	if (mayorState === null) {
		assertCommandAvailable("pi")
		if (message) {
			runTown(["--repo", repo.repoRoot, "--goal", message])
			return
		}
		startFreshMayorSession(repo.repoRoot, repo.artifactsDir)
		return
	}

	if (message) {
		continueTownAgent(["--repo", repo.repoRoot, "mayor", message])
		return
	}

	attachTownAgent(["--repo", repo.repoRoot, "mayor"])
}

import { readPiTownMayorPrompt, resolvePiTownExtensionPath } from "@schilderlabs/pitown-package"

export interface PiTownRuntimeArgsOptions {
	agentId: string
	sessionPath?: string | null
	sessionDir?: string | null
	prompt?: string | null
	message?: string | null
}

export function isMayorAgent(agentId: string) {
	return agentId === "leader" || agentId === "mayor"
}

export function createPiTownRuntimeArgs(options: PiTownRuntimeArgsOptions): string[] {
	const args = ["--extension", resolvePiTownExtensionPath()]

	if (isMayorAgent(options.agentId)) {
		args.push("--append-system-prompt", readPiTownMayorPrompt())
	}

	if (options.sessionPath) args.push("--session", options.sessionPath)
	else if (options.sessionDir) args.push("--session-dir", options.sessionDir)
	else throw new Error("Pi Town runtime requires either a session path or a session directory")

	if (options.prompt) args.push("-p", options.prompt)
	if (options.message) args.push(options.message)

	return args
}

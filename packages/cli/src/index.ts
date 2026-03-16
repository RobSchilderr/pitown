#!/usr/bin/env node

import { attachTownAgent } from "./attach.js"
import { showTownBoard } from "./board.js"
import { continueTownAgent } from "./continue.js"
import { delegateTownTask } from "./delegate.js"
import { runDoctor } from "./doctor.js"
import { isDirectExecution } from "./entrypoint.js"
import { loopTown } from "./loop.js"
import { openTownMayor } from "./mayor.js"
import { messageTownAgent } from "./msg.js"
import { peekTownAgent } from "./peek.js"
import { runTown } from "./run.js"
import { spawnTownAgent } from "./spawn.js"
import { showTownStatus } from "./status.js"
import { CLI_VERSION } from "./version.js"
import { watchTown } from "./watch.js"

export function printHelp(showAdvanced = false) {
	console.log(
		[
			"pitown",
			"",
			"Usage:",
			'  pitown [--repo <path>] ["message"]',
			"  pitown board [--repo <path>]",
			"  pitown peek [--repo <path>] [agent]",
			'  pitown msg [--repo <path>] <agent> "message"',
			"  pitown status [--repo <path>]",
			"  pitown doctor",
			"  pitown --version",
			"",
			"Mayor workflow:",
			"  pitown",
			'  pitown "plan the next milestones"',
			"  /plan",
			"  /todos",
			"",
			"Inside the mayor session, `/plan` toggles read-only planning mode and `/todos` shows the captured plan.",
			"Aliases still work: `pitown mayor`, `pitown help`, `pitown --help`, `pitown -v`.",
			"",
			"If --repo is omitted, Pi Town uses the repo for the current working directory when possible.",
			...(showAdvanced
				? [
						"",
						"Advanced commands:",
						"  pitown run [--repo <path>] [--plan <path>] [--goal <text>]",
						"  pitown loop [--repo <path>] [--plan <path>] [--goal <text>] [--max-iterations N] [--max-time M] [--no-stop-on-failure]",
						"  pitown attach [--repo <path>] <agent>",
						'  pitown continue [--repo <path>] <agent> ["message"]',
						"  pitown delegate [--repo <path>] [--from <agent>] [--role <role>] [--agent <id>] --task <text>",
						"  pitown spawn [--repo <path>] --role <role> [--agent <id>] [--task <text>]",
						"  pitown watch [--repo <path>]",
					]
				: []),
		].join("\n"),
	)
}

export function runCli(argv = process.argv.slice(2)) {
	const [command, ...args] = argv
	const showAdvancedHelp = args.includes("--all")

	switch (command) {
		case undefined:
			openTownMayor([])
			break
		case "help":
		case "--help":
		case "-h":
			printHelp(showAdvancedHelp)
			break
		case "-v":
		case "--version":
		case "version":
			console.log(CLI_VERSION)
			break
		case "run": {
			const result = runTown(args)
			const latestIteration = result.iterations[result.iterations.length - 1]
			if (latestIteration && latestIteration.controllerResult.piInvocation.exitCode !== 0) {
				process.exitCode = latestIteration.controllerResult.piInvocation.exitCode
			}
			break
		}
		case "loop": {
			const result = loopTown(args)
			const lastIteration = result.iterations[result.iterations.length - 1]
			if (lastIteration && lastIteration.controllerResult.piInvocation.exitCode !== 0) {
				process.exitCode = lastIteration.controllerResult.piInvocation.exitCode
			}
			break
		}
		case "attach":
			attachTownAgent(args)
			break
		case "board":
			showTownBoard(args)
			break
		case "continue":
			continueTownAgent(args)
			break
		case "delegate":
			delegateTownTask(args)
			break
		case "mayor":
			openTownMayor(args)
			break
		case "msg":
			messageTownAgent(args)
			break
		case "peek":
			peekTownAgent(args)
			break
		case "spawn":
			spawnTownAgent(args)
			break
		case "status":
			showTownStatus(args)
			break
		case "watch":
			watchTown(args)
			break
		case "doctor": {
			const result = runDoctor()
			if (!result.ok) process.exitCode = 1
			break
		}
		default:
			console.log(`Unknown command: ${command}`)
			printHelp()
			process.exitCode = 1
			break
	}
}

if (isDirectExecution(import.meta.url)) {
	runCli()
}

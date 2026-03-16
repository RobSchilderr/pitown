import { describe, expect, it } from "vitest"
import { runCli } from "./index.js"
import { CLI_VERSION } from "./version.js"

function captureLogs(fn: () => void): string[] {
	const lines: string[] = []
	const originalLog = console.log
	console.log = (...args: unknown[]) => {
		lines.push(args.map((value) => String(value)).join(" "))
	}

	try {
		fn()
		return lines
	} finally {
		console.log = originalLog
	}
}

describe("runCli", () => {
	it("prints help for pitown --help and pitown help", () => {
		const longHelp = captureLogs(() => runCli(["--help"]))
		const subcommandHelp = captureLogs(() => runCli(["help"]))
		const advancedHelp = captureLogs(() => runCli(["help", "--all"]))

		expect(longHelp.join("\n")).toContain("pitown")
		expect(longHelp.join("\n")).toContain('pitown [--repo <path>] ["message"]')
		expect(longHelp.join("\n")).toContain('pitown msg [--repo <path>] <agent> "message"')
		expect(longHelp.join("\n")).toContain("pitown peek [--repo <path>] [agent]")
		expect(longHelp.join("\n")).toContain("Mayor workflow:")
		expect(longHelp.join("\n")).toContain("Aliases still work:")
		expect(longHelp.join("\n")).toContain("If --repo is omitted, Pi Town uses the repo for the current working directory when possible.")
		expect(longHelp.join("\n")).not.toContain("pitown delegate [--repo <path>] [--from <agent>] [--role <role>] [--agent <id>] --task <text>")
		expect(longHelp.join("\n")).toContain("pitown doctor")
		expect(subcommandHelp.join("\n")).toContain("pitown status [--repo <path>]")
		expect(advancedHelp.join("\n")).toContain("Advanced commands:")
		expect(advancedHelp.join("\n")).toContain("pitown delegate [--repo <path>] [--from <agent>] [--role <role>] [--agent <id>] --task <text>")
	})

	it("prints the CLI version for -v and --version", () => {
		const shortVersion = captureLogs(() => runCli(["-v"]))
		const longVersion = captureLogs(() => runCli(["--version"]))

		expect(shortVersion).toEqual([CLI_VERSION])
		expect(longVersion).toEqual([CLI_VERSION])
	})
})

import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { runController } from "./controller.js"
import { readJsonl } from "./events.js"

const originalHome = process.env.HOME

afterEach(() => {
	if (originalHome === undefined) delete process.env.HOME
	else process.env.HOME = originalHome
})

describe("runController", () => {
	it("fails with a clear message when the pi command is missing", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-town-cwd-"))
		process.env.HOME = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		const artifactsDir = join(cwd, "state")
		const missingCommand = join(cwd, "missing-pi")

		expect(() =>
			runController({
				artifactsDir,
				cwd,
				goal: "continue from current scaffold state",
				mode: "single-pi",
				piCommand: missingCommand,
			}),
		).toThrowError(`Pi Town could not execute the configured Pi command: ${missingCommand}`)
	})

	it("surfaces a clear auth hint when pi is installed but not authenticated", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-town-cwd-"))
		process.env.HOME = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		const artifactsDir = join(cwd, "state")
		const fakePiPath = join(cwd, "fake-pi-auth.sh")
		writeFileSync(
			fakePiPath,
			[
				"#!/bin/sh",
				'printf "No models available.\\n" >&2',
				"exit 1",
			].join("\n"),
			"utf-8",
		)
		chmodSync(fakePiPath, 0o755)

		const result = runController({
			artifactsDir,
			cwd,
			goal: "continue from current scaffold state",
			mode: "single-pi",
			piCommand: fakePiPath,
		})

		expect(result.summary.success).toBe(false)
		expect(result.summary.message).toContain("Pi appears to be installed but not authenticated or configured")
		expect(result.summary.message).toContain('pi -p "hello"')
		expect(result.summary.message).toContain("run `pi` and use `/login`")
	})

	it("performs one pi invocation and writes durable run artifacts", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-town-cwd-"))
		process.env.HOME = mkdtempSync(join(tmpdir(), "pi-town-home-"))
		const artifactsDir = join(cwd, "state")
		const planPath = join(cwd, "plans")
		mkdirSync(planPath, { recursive: true })
		writeFileSync(join(planPath, "roadmap.md"), "phase 3\n", "utf-8")

		const fakePiPath = join(cwd, "fake-pi.sh")
		writeFileSync(
			fakePiPath,
			[
				"#!/bin/sh",
				'printf "pi stdout\\n"',
				'printf "pi stderr\\n" >&2',
				"exit 0",
			].join("\n"),
			"utf-8",
		)
		chmodSync(fakePiPath, 0o755)

		const result = runController({
			artifactsDir,
			cwd,
			goal: "continue from current scaffold state",
			mode: "single-pi",
			planPath,
			piCommand: fakePiPath,
			recommendedPlanDir: join(cwd, ".pi-town", "plans", "repo"),
		})

		expect(result.manifest.runId).toBe(result.runId)
		expect(result.manifest.mode).toBe("single-pi")
		expect(result.manifest.planPath).toBe(planPath)
		expect(result.manifest.piExitCode).toBe(0)
		expect(result.summary.success).toBe(true)
		expect(result.piInvocation.exitCode).toBe(0)

		expect(readFileSync(join(result.runDir, "stdout.txt"), "utf-8")).toBe("pi stdout\n")
		expect(readFileSync(join(result.runDir, "stderr.txt"), "utf-8")).toBe("pi stderr\n")
		expect(readFileSync(join(result.runDir, "questions.jsonl"), "utf-8")).toBe("")
		expect(readFileSync(join(result.runDir, "interventions.jsonl"), "utf-8")).toBe("")

		const invocation = JSON.parse(readFileSync(join(result.runDir, "pi-invocation.json"), "utf-8")) as {
			command: string
			exitCode: number
			planPath: string | null
		}
		expect(invocation.command).toBe(fakePiPath)
		expect(invocation.exitCode).toBe(0)
		expect(invocation.planPath).toBe(planPath)

		const events = readJsonl<{ type: string }>(join(result.runDir, "events.jsonl"))
		expect(events.map((event) => event.type)).toEqual([
			"run_started",
			"pi_invocation_started",
			"pi_invocation_finished",
			"run_finished",
		])
	})
})

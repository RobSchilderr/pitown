import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { runDoctor } from "./doctor.js"

const originalPath = process.env["PATH"]

function createFakePi(binDir: string, options?: { stdout?: string; stderr?: string; exitCode?: number }) {
	const piPath = join(binDir, "pi")
	mkdirSync(binDir, { recursive: true })
	const stdout = options?.stdout ?? "pi ok\n"
	const stderr = options?.stderr ?? ""
	const exitCode = options?.exitCode ?? 0
	writeFileSync(
		piPath,
		[
			"#!/bin/sh",
			'if [ "$1" = "--help" ]; then exit 0; fi',
			`printf ${JSON.stringify(stdout)}`,
			`printf ${JSON.stringify(stderr)} >&2`,
			`exit ${exitCode}`,
		].join("\n"),
		"utf-8",
	)
	chmodSync(piPath, 0o755)
}

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

afterEach(() => {
	if (originalPath === undefined) delete process.env["PATH"]
	else process.env["PATH"] = originalPath
})

describe("runDoctor", () => {
	it("reports when the pi cli is missing", () => {
		process.env["PATH"] = ""
		const output = captureLogs(() => {
			expect(runDoctor().ok).toBe(false)
		})

		expect(output.join("\n")).toContain("[pitown] doctor")
		expect(output.join("\n")).toContain("- pi cli: missing")
		expect(output.join("\n")).toContain("npm install -g @mariozechner/pi-coding-agent")
	})

	it("reports when pi is installed but not authenticated", () => {
		const home = mkdtempSync(join(tmpdir(), "pitown-doctor-"))
		const binDir = join(home, "bin")
		createFakePi(binDir, { stderr: "No models available.\n", exitCode: 1 })
		process.env["PATH"] = `${binDir}:${originalPath ?? ""}`

		const output = captureLogs(() => {
			expect(runDoctor().ok).toBe(false)
		})

		expect(output.join("\n")).toContain("- pi auth: not ready")
		expect(output.join("\n")).toContain('pi -p "hello"')
		expect(output.join("\n")).toContain("/login")
	})

	it("reports success when pi is ready", () => {
		const home = mkdtempSync(join(tmpdir(), "pitown-doctor-"))
		const binDir = join(home, "bin")
		createFakePi(binDir)
		process.env["PATH"] = `${binDir}:${originalPath ?? ""}`

		const output = captureLogs(() => {
			expect(runDoctor().ok).toBe(true)
		})

		expect(output.join("\n")).toContain("- pi auth: ready")
		expect(output.join("\n")).toContain("- status: ok")
	})
})

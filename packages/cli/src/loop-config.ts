import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import { homedir } from "node:os"
import { getUserConfigPath } from "./paths.js"

const DEFAULT_GOAL = "continue from current scaffold state"
const DEFAULT_MAX_ITERATIONS = 10
const DEFAULT_MAX_TIME_MINUTES = 60

interface UserConfig {
	repo?: string
	plan?: string
	goal?: string
}

export interface ResolvedLoopConfig {
	repo: string
	plan: string | null
	goal: string
	maxIterations: number
	maxTimeMinutes: number
	stopOnPiFailure: boolean
}

interface LoopCliFlags {
	repo?: string
	plan?: string
	goal?: string
	maxIterations?: number
	maxTime?: number
	noStopOnFailure: boolean
}

function expandHome(value: string): string {
	if (value === "~") return homedir()
	if (value.startsWith("~/")) return resolve(homedir(), value.slice(2))
	return value
}

function resolvePathValue(value: string | undefined, baseDir: string): string | undefined {
	if (!value) return undefined
	const expanded = expandHome(value)
	return isAbsolute(expanded) ? resolve(expanded) : resolve(baseDir, expanded)
}

function parseLoopCliFlags(argv: string[]): LoopCliFlags {
	const flags: LoopCliFlags = { noStopOnFailure: false }

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]
		if (arg === undefined) continue

		if (arg.startsWith("--repo=")) {
			flags.repo = arg.slice("--repo=".length)
			continue
		}
		if (arg === "--repo") {
			const value = argv[index + 1]
			if (!value) throw new Error("Missing value for --repo")
			flags.repo = value
			index += 1
			continue
		}

		if (arg.startsWith("--plan=")) {
			flags.plan = arg.slice("--plan=".length)
			continue
		}
		if (arg === "--plan") {
			const value = argv[index + 1]
			if (!value) throw new Error("Missing value for --plan")
			flags.plan = value
			index += 1
			continue
		}

		if (arg.startsWith("--goal=")) {
			flags.goal = arg.slice("--goal=".length)
			continue
		}
		if (arg === "--goal") {
			const value = argv[index + 1]
			if (!value) throw new Error("Missing value for --goal")
			flags.goal = value
			index += 1
			continue
		}

		if (arg.startsWith("--max-iterations=")) {
			flags.maxIterations = Number.parseInt(arg.slice("--max-iterations=".length), 10)
			continue
		}
		if (arg === "--max-iterations") {
			const value = argv[index + 1]
			if (!value) throw new Error("Missing value for --max-iterations")
			flags.maxIterations = Number.parseInt(value, 10)
			index += 1
			continue
		}

		if (arg.startsWith("--max-time=")) {
			flags.maxTime = Number.parseInt(arg.slice("--max-time=".length), 10)
			continue
		}
		if (arg === "--max-time") {
			const value = argv[index + 1]
			if (!value) throw new Error("Missing value for --max-time")
			flags.maxTime = Number.parseInt(value, 10)
			index += 1
			continue
		}

		if (arg === "--no-stop-on-failure") {
			flags.noStopOnFailure = true
			continue
		}

		throw new Error(`Unknown argument: ${arg}`)
	}

	return flags
}

function loadUserConfig(): UserConfig {
	const configPath = getUserConfigPath()
	if (!existsSync(configPath)) return {}
	return JSON.parse(readFileSync(configPath, "utf-8")) as UserConfig
}

export function resolveLoopConfig(argv: string[]): ResolvedLoopConfig {
	const flags = parseLoopCliFlags(argv)
	const configPath = getUserConfigPath()
	const userConfig = loadUserConfig()
	const configDir = dirname(configPath)

	const repo =
		resolvePathValue(flags.repo, process.cwd()) ??
		resolvePathValue(userConfig.repo, configDir) ??
		resolve(process.cwd())
	const plan = resolvePathValue(flags.plan, process.cwd()) ?? resolvePathValue(userConfig.plan, configDir) ?? null
	const goal = flags.goal ?? userConfig.goal ?? DEFAULT_GOAL

	return {
		repo,
		plan,
		goal,
		maxIterations: flags.maxIterations ?? DEFAULT_MAX_ITERATIONS,
		maxTimeMinutes: flags.maxTime ?? DEFAULT_MAX_TIME_MINUTES,
		stopOnPiFailure: !flags.noStopOnFailure,
	}
}

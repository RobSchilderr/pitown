import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import { homedir } from "node:os"
import { getUserConfigPath } from "./paths.js"

const DEFAULT_GOAL = "continue from current scaffold state"

export interface CliFlags {
	repo?: string
	plan?: string
	goal?: string
	help: boolean
}

export interface OptionalRepoFlagResult {
	repo?: string
	rest: string[]
}

interface UserConfig {
	repo?: string
	plan?: string
	goal?: string
}

export interface ResolvedRunConfig {
	repo: string
	plan: string | null
	goal: string
	configPath: string
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

export function parseCliFlags(argv: string[]): CliFlags {
	const flags: CliFlags = { help: false }

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]
		if (arg === undefined) continue

		if (arg === "--help" || arg === "-h") {
			flags.help = true
			continue
		}

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

		throw new Error(`Unknown argument: ${arg}`)
	}

	return flags
}

export function parseOptionalRepoFlag(argv: string[]): OptionalRepoFlagResult {
	const rest: string[] = []
	let repo: string | undefined

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]
		if (arg === undefined) continue

		if (arg.startsWith("--repo=")) {
			repo = arg.slice("--repo=".length)
			continue
		}

		if (arg === "--repo") {
			const value = argv[index + 1]
			if (!value) throw new Error("Missing value for --repo")
			repo = value
			index += 1
			continue
		}

		rest.push(arg)
	}

	return repo === undefined ? { rest } : { repo, rest }
}

export function loadUserConfig(): UserConfig {
	const configPath = getUserConfigPath()
	if (!existsSync(configPath)) return {}
	return JSON.parse(readFileSync(configPath, "utf-8")) as UserConfig
}

export function resolveRunConfig(argv: string[]): ResolvedRunConfig {
	const flags = parseCliFlags(argv)
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
		configPath,
	}
}

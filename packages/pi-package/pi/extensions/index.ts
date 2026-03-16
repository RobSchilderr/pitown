import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { listAgentStates } from "@schilderlabs/pitown-core"
import { registerMayorPlanMode } from "#pitown-mayor-plan"
import { registerTownTools, resolveTownAgentContext } from "#pitown-town-tools"

const extensionDir = dirname(fileURLToPath(import.meta.url))
const agentsDir = join(extensionDir, "..", "agents")

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
	if (!match) return { frontmatter: {}, body: content.trim() }

	const frontmatter: Record<string, string> = {}
	for (const rawLine of match[1]!.split(/\r?\n/)) {
		const index = rawLine.indexOf(":")
		if (index === -1) continue
		frontmatter[rawLine.slice(0, index).trim()] = rawLine.slice(index + 1).trim()
	}

	return { frontmatter, body: match[2]!.trim() }
}

function listBundledAgents(): Array<{ name: string; description: string }> {
	if (!existsSync(agentsDir)) return []

	return readdirSync(agentsDir)
		.filter((file) => file.endsWith(".md"))
		.map((file) => {
			const content = readFileSync(join(agentsDir, file), "utf-8")
			const { frontmatter } = parseFrontmatter(content)
			return {
				name: frontmatter["name"] ?? file.replace(/\.md$/, ""),
				description: frontmatter["description"] ?? "",
			}
		})
}

export default function piTownPackage(pi: ExtensionAPI) {
	registerTownTools(pi)
	registerMayorPlanMode(pi)

	pi.registerCommand("town-status", {
		description: "Show Pi Town package status",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Pi Town package loaded. Use /town-agents to inspect bundled roles.", "info")
		},
	})

	pi.registerCommand("town-agents", {
		description: "List bundled Pi Town agents",
		handler: async (_args, ctx) => {
			const agents = listBundledAgents()
			if (agents.length === 0) {
				ctx.ui.notify("No bundled Pi Town agents were found.", "warning")
				return
			}

			const lines = ["Bundled Pi Town agents:", ...agents.map((agent) => `- ${agent.name}: ${agent.description}`)]
			ctx.ui.notify(lines.join("\n"), "info")
		},
	})

	pi.registerCommand("workers", {
		description: "Show current worker status",
		handler: async (_args, ctx) => {
			const context = resolveTownAgentContext(ctx.sessionManager.getSessionFile())
			if (!context) {
				ctx.ui.notify("Not in a Pi Town session.", "warning")
				return
			}
			const agents = listAgentStates(context.artifactsDir)
			const workers = agents.filter((a) => a.agentId !== "mayor")
			if (workers.length === 0) {
				ctx.ui.notify("No workers spawned yet.", "info")
				return
			}
			const lines = workers.map((w) => {
				const task = w.task ? (w.task.length > 60 ? w.task.slice(0, 59) + "…" : w.task) : "—"
				return `${w.agentId.padEnd(16)} ${w.status.padEnd(10)} ${task}`
			})
			ctx.ui.notify(["Workers:", ...lines].join("\n"), "info")
		},
	})
}

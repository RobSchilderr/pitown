import { existsSync, readFileSync } from "node:fs"
import { createRepoSlug, getRepoIdentity, getRepoRoot, isGitRepo } from "../../core/src/index.js"
import { parseOptionalRepoFlag } from "./config.js"
import { getLatestRunPointerPath, getRepoArtifactsDir } from "./paths.js"

interface LatestRunPointer {
	repoSlug: string
	repoRoot: string
}

export interface ResolvedRepoContext {
	repoRoot: string
	repoSlug: string
	artifactsDir: string
	rest: string[]
}

export function resolveRepoContext(argv: string[]): ResolvedRepoContext {
	const { repo, rest } = parseOptionalRepoFlag(argv)

	if (repo) {
		const repoRoot = getRepoRoot(repo)
		const repoSlug = createRepoSlug(getRepoIdentity(repoRoot), repoRoot)
		return {
			repoRoot,
			repoSlug,
			artifactsDir: getRepoArtifactsDir(repoSlug),
			rest,
		}
	}

	const cwd = process.cwd()
	const repoRoot = getRepoRoot(cwd)
	const repoSlug = createRepoSlug(getRepoIdentity(repoRoot), repoRoot)
	const artifactsDir = getRepoArtifactsDir(repoSlug)
	if (isGitRepo(cwd) || existsSync(artifactsDir)) {
		return {
			repoRoot,
			repoSlug,
			artifactsDir,
			rest,
		}
	}

	const latestPointerPath = getLatestRunPointerPath()
	if (!existsSync(latestPointerPath)) {
		return {
			repoRoot,
			repoSlug,
			artifactsDir,
			rest,
		}
	}

	const latest = JSON.parse(readFileSync(latestPointerPath, "utf-8")) as LatestRunPointer
	return {
		repoRoot: latest.repoRoot,
		repoSlug: latest.repoSlug,
		artifactsDir: getRepoArtifactsDir(latest.repoSlug),
		rest,
	}
}

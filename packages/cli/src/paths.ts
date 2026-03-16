import { homedir } from "node:os"
import { join } from "node:path"

export function getTownHomeDir(): string {
	return join(homedir(), ".pi-town")
}

export function getUserConfigPath(): string {
	return join(getTownHomeDir(), "config.json")
}

export function getPlansRootDir(): string {
	return join(getTownHomeDir(), "plans")
}

export function getReposRootDir(): string {
	return join(getTownHomeDir(), "repos")
}

export function getRepoArtifactsDir(repoSlug: string): string {
	return join(getReposRootDir(), repoSlug)
}

export function getRepoAgentsDir(repoSlug: string): string {
	return join(getRepoArtifactsDir(repoSlug), "agents")
}

export function getLatestRunPointerPath(): string {
	return join(getTownHomeDir(), "latest-run.json")
}

export function getRepoLatestRunPointerPath(repoSlug: string): string {
	return join(getRepoArtifactsDir(repoSlug), "latest-run.json")
}

export function getRecommendedPlanDir(repoSlug: string): string {
	return join(getPlansRootDir(), repoSlug)
}

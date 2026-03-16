export function normalizeAgentId(agentId: string): string {
	return agentId === "mayor" ? "leader" : agentId
}

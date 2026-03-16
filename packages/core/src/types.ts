export type InterruptCategory =
	| "missing-context"
	| "spec-gap"
	| "policy-gap"
	| "validation-gap"
	| "tooling-failure"
	| "external-blocker"

export type FixType =
	| "adr"
	| "docs"
	| "policy"
	| "prompt"
	| "skill"
	| "tooling"
	| "validation"

export type RunMode = "single-pi"

export type AgentStatus = "queued" | "starting" | "running" | "idle" | "blocked" | "completed" | "failed"

export type AgentMailbox = "inbox" | "outbox"
export type TaskStatus = "queued" | "running" | "blocked" | "completed"

export interface AgentSessionRecord {
	runtime: "pi"
	persisted: boolean
	sessionDir: string | null
	sessionId: string | null
	sessionPath: string | null
	processId: number | null
	lastAttachedAt: string | null
}

export interface AgentStateSnapshot {
	agentId: string
	role: string
	status: AgentStatus
	taskId: string | null
	task: string | null
	branch: string | null
	updatedAt: string
	lastMessage: string | null
	waitingOn: string | null
	blocked: boolean
	runId: string | null
	session: AgentSessionRecord
}

export interface AgentMessageRecord {
	box: AgentMailbox
	from: string
	body: string
	createdAt: string
}

export interface TaskRecord {
	taskId: string
	title: string
	status: TaskStatus
	role: string
	assignedAgentId: string
	createdBy: string
	createdAt: string
	updatedAt: string
}

export interface InterruptRecord {
	id: string
	runId: string
	taskId?: string
	category: InterruptCategory
	subtype?: string
	summary: string
	requiresHuman: boolean
	createdAt: string
	resolvedAt?: string
	fixType?: FixType
}

export interface TaskAttempt {
	taskId: string
	status: "completed" | "blocked" | "skipped"
	interrupted: boolean
	startedAt: string
	endedAt: string
}

export interface FeedbackCycle {
	feedbackAt: string
	demoReadyAt: string
}

export interface MetricsSnapshot {
	interruptRate: number
	autonomousCompletionRate: number
	contextCoverageScore: number
	meanTimeToCorrectHours: number | null
	feedbackToDemoCycleTimeHours: number | null
	totals: {
		taskAttempts: number
		completedTasks: number
		interrupts: number
		observedInterruptCategories: number
		coveredInterruptCategories: number
	}
}

export interface RunOptions {
	cwd?: string
	artifactsDir: string
	branch?: string | null
	goal?: string | null
	mode?: RunMode
	planPath?: string | null
	recommendedPlanDir?: string | null
	appendedSystemPrompt?: string | null
	extensionPath?: string | null
	piCommand?: string
}

export interface RunManifest {
	runId: string
	repoId: string
	repoSlug: string
	repoRoot: string
	branch: string
	goal: string | null
	planPath: string | null
	recommendedPlanDir: string | null
	mode: RunMode
	startedAt: string
	endedAt: string | null
	stopReason: string | null
	leasePath: string
	piExitCode: number | null
	completedTaskCount: number
	blockedTaskCount: number
	skippedTaskCount: number
	totalCostUsd: number
}

export interface PiInvocationRecord {
	command: string
	cwd: string
	repoRoot: string
	planPath: string | null
	goal: string | null
	sessionDir: string | null
	sessionId: string | null
	sessionPath: string | null
	startedAt: string
	endedAt: string
	exitCode: number
	stdoutPath: string
	stderrPath: string
	promptSummary: string
}

export interface RunSummary {
	runId: string
	mode: RunMode
	createdAt: string
	success: boolean
	message: string
	piExitCode: number
	recommendedPlanDir: string | null
}

export interface ControllerRunResult {
	runId: string
	runDir: string
	latestDir: string
	manifest: RunManifest
	metrics: MetricsSnapshot
	summary: RunSummary
	piInvocation: PiInvocationRecord
}

// --- Loop types ---

export type LoopStopReason =
	| "all-tasks-completed"
	| "all-remaining-tasks-blocked"
	| "mayor-blocked"
	| "mayor-idle-no-work"
	| "max-iterations-reached"
	| "max-wall-time-reached"
	| "pi-exit-nonzero"
	| "high-interrupt-rate"

export interface LoopOptions {
	runOptions: RunOptions
	maxIterations?: number
	maxWallTimeMs?: number
	stopOnPiFailure?: boolean
	stopOnMayorIdleNoWork?: boolean
	interruptRateThreshold?: number | null
	onIterationComplete?: (iteration: LoopIterationResult) => void
}

export interface BoardSnapshot {
	tasks: Array<{ taskId: string; status: TaskStatus }>
	agents: Array<{ agentId: string; status: AgentStatus; blocked: boolean }>
	allTasksCompleted: boolean
	allRemainingTasksBlocked: boolean
	mayorBlocked: boolean
	hasQueuedOrRunningWork: boolean
}

export interface LoopIterationResult {
	iteration: number
	controllerResult: ControllerRunResult
	boardSnapshot: BoardSnapshot
	metrics: MetricsSnapshot
	elapsedMs: number
	continueReason: string | null
	stopReason: LoopStopReason | null
}

export interface LoopRunResult {
	loopId: string
	iterations: LoopIterationResult[]
	stopReason: LoopStopReason
	totalIterations: number
	totalElapsedMs: number
	finalBoardSnapshot: BoardSnapshot
	aggregateMetrics: MetricsSnapshot
}

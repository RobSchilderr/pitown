import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { TaskRecord, TaskStatus } from "./types.js"

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

export function getTasksDir(artifactsDir: string): string {
	return join(artifactsDir, "tasks")
}

export function getTaskPath(artifactsDir: string, taskId: string): string {
	return join(getTasksDir(artifactsDir), `${taskId}.json`)
}

export function createTaskRecord(input: {
	taskId: string
	title: string
	status: TaskStatus
	role: string
	assignedAgentId: string
	createdBy: string
}): TaskRecord {
	const now = new Date().toISOString()
	return {
		taskId: input.taskId,
		title: input.title,
		status: input.status,
		role: input.role,
		assignedAgentId: input.assignedAgentId,
		createdBy: input.createdBy,
		createdAt: now,
		updatedAt: now,
	}
}

export function writeTaskRecord(artifactsDir: string, task: TaskRecord) {
	writeJson(getTaskPath(artifactsDir, task.taskId), task)
}

export function updateTaskRecordStatus(artifactsDir: string, taskId: string, status: TaskStatus): TaskRecord | null {
	const task = readTaskRecord(artifactsDir, taskId)
	if (task === null) return null

	const updatedTask: TaskRecord = {
		...task,
		status,
		updatedAt: new Date().toISOString(),
	}
	writeTaskRecord(artifactsDir, updatedTask)
	return updatedTask
}

export function readTaskRecord(artifactsDir: string, taskId: string): TaskRecord | null {
	const path = getTaskPath(artifactsDir, taskId)
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as TaskRecord
	} catch {
		return null
	}
}

export function listTaskRecords(artifactsDir: string): TaskRecord[] {
	const tasksDir = getTasksDir(artifactsDir)
	let entries: string[]
	try {
		entries = readdirSync(tasksDir)
	} catch {
		return []
	}

	return entries
		.filter((entry) => entry.endsWith(".json"))
		.map((entry) => readTaskRecord(artifactsDir, entry.replace(/\.json$/, "")))
		.filter((task): task is TaskRecord => task !== null)
		.sort((left, right) => left.taskId.localeCompare(right.taskId))
}

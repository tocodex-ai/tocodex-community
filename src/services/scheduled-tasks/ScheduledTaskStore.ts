/**
 * ScheduledTaskStore
 *
 * 负责定时任务定义的持久化（workspace + global 两个 scope）。
 * - workspace scope -> <workspace>/.tocodex/scheduled-tasks.json
 * - global scope    -> <globalStorage>/scheduled-tasks.json
 *
 * 同时维护每个任务的运行历史（独立的 JSONL 文件）。
 *
 * 设计参考: .tocodex/plans/scheduled-tasks-system-design.md
 */

import { EventEmitter } from "events"
import * as fs from "fs/promises"
import * as path from "path"
import * as crypto from "crypto"
import type * as vscode from "vscode"

import {
	type ScheduledTask,
	type ScheduledTaskStoreFile,
	type CreateScheduledTaskInput,
	type UpdateScheduledTaskInput,
	type ScheduledTaskScope,
	type ScheduledTaskRun,
	scheduledTaskStoreFileSchema,
	scheduledTaskSchema,
	SCHEDULED_TASK_LIMITS,
} from "@roo-code/types"

const STORE_FILE = "scheduled-tasks.json"
const RUN_HISTORY_DIR = "scheduled-task-runs"
const STORE_VERSION = 1 as const

type StoreChangeReason = "create" | "update" | "delete" | "run" | "load"

export interface StoreChangeEvent {
	reason: StoreChangeReason
	taskId?: string
	scope: ScheduledTaskScope
}

export interface ScheduledTaskStoreEvents {
	change: (event: StoreChangeEvent) => void
}

export interface ScheduledTaskStoreOptions {
	getWorkspacePath: () => string | undefined
	context: Pick<vscode.ExtensionContext, "globalStorageUri">
	log?: (message: string) => void
}

/**
 * 持久化 + CRUD + 变更事件
 */
export class ScheduledTaskStore extends EventEmitter {
	private workspaceTasks: ScheduledTask[] = []
	private globalTasks: ScheduledTask[] = []
	private loaded = false
	private readonly log: (message: string) => void

	constructor(private readonly options: ScheduledTaskStoreOptions) {
		super()
		this.log = options.log ?? (() => {})
	}

	// ─── lifecycle ────────────────────────────────────────────────────────

	async load(): Promise<void> {
		await Promise.all([this.loadScope("workspace"), this.loadScope("global")])
		this.loaded = true
		this.emit("change", { reason: "load", scope: "workspace" })
		this.emit("change", { reason: "load", scope: "global" })
	}

	isLoaded(): boolean {
		return this.loaded
	}

	// ─── queries ──────────────────────────────────────────────────────────

	getAll(): ScheduledTask[] {
		return [...this.workspaceTasks, ...this.globalTasks]
	}

	getByScope(scope: ScheduledTaskScope): ScheduledTask[] {
		return scope === "workspace" ? [...this.workspaceTasks] : [...this.globalTasks]
	}

	getById(id: string): ScheduledTask | undefined {
		return this.getAll().find((t) => t.id === id)
	}

	getScopeOf(id: string): ScheduledTaskScope | undefined {
		if (this.workspaceTasks.some((t) => t.id === id)) return "workspace"
		if (this.globalTasks.some((t) => t.id === id)) return "global"
		return undefined
	}

	// ─── mutations ───────────────────────────────────────────────────────

	async create(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
		const scope: ScheduledTaskScope = input.scope ?? "workspace"
		const list = this.listFor(scope)

		// Enforce limit on ENABLED tasks per scope
		const enabledCount = list.filter((t) => t.enabled).length
		if ((input.enabled ?? true) && enabledCount >= SCHEDULED_TASK_LIMITS.maxEnabledPerScope) {
			throw new Error(
				`Cannot create more than ${SCHEDULED_TASK_LIMITS.maxEnabledPerScope} enabled scheduled tasks in scope "${scope}".`,
			)
		}

		// Min interval guard
		if (input.trigger.kind === "interval" && input.trigger.intervalMs < SCHEDULED_TASK_LIMITS.minIntervalMs) {
			throw new Error(
				`Interval trigger must be at least ${SCHEDULED_TASK_LIMITS.minIntervalMs}ms (got ${input.trigger.intervalMs}).`,
			)
		}

		const now = Date.now()
		const task: ScheduledTask = scheduledTaskSchema.parse({
			id: crypto.randomUUID(),
			name: input.name,
			description: input.description,
			trigger: input.trigger,
			mode: input.mode,
			prompt: input.prompt,
			apiConfigName: input.apiConfigName,
			scope,
			enabled: input.enabled ?? true,
			maxRuntimeMs: input.maxRuntimeMs ?? SCHEDULED_TASK_LIMITS.defaultMaxRuntimeMs,
			concurrency: input.concurrency ?? "skip",
			notifyOn: input.notifyOn ?? ["failure"],
			catchUpPolicy: input.catchUpPolicy ?? "skip",
			createdAt: now,
			updatedAt: now,
			createdBy: input.createdBy ?? "user",
		})

		list.push(task)
		await this.persistScope(scope)
		this.emit("change", { reason: "create", taskId: task.id, scope })
		return task
	}

	async update(id: string, patch: UpdateScheduledTaskInput): Promise<ScheduledTask> {
		const scope = this.getScopeOf(id)
		if (!scope) throw new Error(`Scheduled task not found: ${id}`)

		const list = this.listFor(scope)
		const idx = list.findIndex((t) => t.id === id)
		const existing = list[idx]

		// Min interval guard
		if (patch.trigger?.kind === "interval" && patch.trigger.intervalMs < SCHEDULED_TASK_LIMITS.minIntervalMs) {
			throw new Error(
				`Interval trigger must be at least ${SCHEDULED_TASK_LIMITS.minIntervalMs}ms (got ${patch.trigger.intervalMs}).`,
			)
		}

		// Enabled limit guard - only when toggling OFF -> ON
		if (patch.enabled === true && !existing.enabled) {
			const enabledCount = list.filter((t) => t.enabled).length
			if (enabledCount >= SCHEDULED_TASK_LIMITS.maxEnabledPerScope) {
				throw new Error(
					`Cannot enable: max ${SCHEDULED_TASK_LIMITS.maxEnabledPerScope} enabled tasks in scope "${scope}".`,
				)
			}
		}

		const merged: ScheduledTask = scheduledTaskSchema.parse({
			...existing,
			...patch,
			id: existing.id,
			scope: existing.scope,
			createdAt: existing.createdAt,
			updatedAt: Date.now(),
		})
		list[idx] = merged

		await this.persistScope(scope)
		this.emit("change", { reason: "update", taskId: id, scope })
		return merged
	}

	async delete(id: string): Promise<boolean> {
		const scope = this.getScopeOf(id)
		if (!scope) return false

		const list = this.listFor(scope)
		const idx = list.findIndex((t) => t.id === id)
		list.splice(idx, 1)

		await this.persistScope(scope)
		// 删除其运行历史
		try {
			const historyPath = await this.runHistoryPath(id, scope)
			await fs.rm(historyPath, { force: true })
		} catch {
			// best-effort
		}

		this.emit("change", { reason: "delete", taskId: id, scope })
		return true
	}

	/**
	 * 更新 nextRunAt / lastRun（调度器/执行器调用）
	 */
	async updateRuntimeState(
		id: string,
		state: { nextRunAt?: number; lastRun?: ScheduledTaskRun },
	): Promise<ScheduledTask | undefined> {
		const scope = this.getScopeOf(id)
		if (!scope) return undefined

		const list = this.listFor(scope)
		const idx = list.findIndex((t) => t.id === id)
		const existing = list[idx]
		const merged: ScheduledTask = {
			...existing,
			nextRunAt: state.nextRunAt ?? existing.nextRunAt,
			lastRun: state.lastRun ?? existing.lastRun,
			updatedAt: Date.now(),
		}
		list[idx] = merged
		await this.persistScope(scope)
		this.emit("change", { reason: "run", taskId: id, scope })
		return merged
	}

	// ─── run history ─────────────────────────────────────────────────────

	async appendRun(id: string, run: ScheduledTaskRun): Promise<void> {
		const scope = this.getScopeOf(id)
		if (!scope) return
		const historyPath = await this.runHistoryPath(id, scope)
		try {
			await fs.mkdir(path.dirname(historyPath), { recursive: true })
			const line = JSON.stringify(run) + "\n"
			await fs.appendFile(historyPath, line, "utf-8")
			await this.truncateRunHistory(historyPath)
		} catch (error) {
			this.log(
				`[ScheduledTaskStore] Failed to append run for ${id}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	async listRuns(id: string, limit = 50): Promise<ScheduledTaskRun[]> {
		const scope = this.getScopeOf(id)
		if (!scope) return []
		const historyPath = await this.runHistoryPath(id, scope)
		try {
			const content = await fs.readFile(historyPath, "utf-8")
			const lines = content.split("\n").filter((l) => l.trim().length > 0)
			const runs: ScheduledTaskRun[] = []
			for (const line of lines.slice(-limit)) {
				try {
					runs.push(JSON.parse(line))
				} catch {
					// skip malformed
				}
			}
			return runs.reverse() // newest first
		} catch {
			return []
		}
	}

	// ─── internal helpers ────────────────────────────────────────────────

	private listFor(scope: ScheduledTaskScope): ScheduledTask[] {
		return scope === "workspace" ? this.workspaceTasks : this.globalTasks
	}

	private async storePath(scope: ScheduledTaskScope): Promise<string | undefined> {
		if (scope === "workspace") {
			const ws = this.options.getWorkspacePath()
			if (!ws) return undefined
			return path.join(ws, ".tocodex", STORE_FILE)
		}
		const globalDir = this.options.context.globalStorageUri.fsPath
		return path.join(globalDir, STORE_FILE)
	}

	private async runHistoryPath(taskId: string, scope: ScheduledTaskScope): Promise<string> {
		if (scope === "workspace") {
			const ws = this.options.getWorkspacePath() ?? ""
			return path.join(ws, ".tocodex", RUN_HISTORY_DIR, `${taskId}.jsonl`)
		}
		const globalDir = this.options.context.globalStorageUri.fsPath
		return path.join(globalDir, RUN_HISTORY_DIR, `${taskId}.jsonl`)
	}

	private async loadScope(scope: ScheduledTaskScope): Promise<void> {
		const file = await this.storePath(scope)
		if (!file) {
			this.setList(scope, [])
			return
		}
		try {
			const content = await fs.readFile(file, "utf-8")
			const parsed = JSON.parse(content)
			const result = scheduledTaskStoreFileSchema.safeParse(parsed)
			if (!result.success) {
				this.log(`[ScheduledTaskStore] ${scope} file invalid; resetting. ${result.error.message}`)
				this.setList(scope, [])
				return
			}
			this.setList(scope, result.data.tasks)
		} catch (error) {
			const code = (error as NodeJS.ErrnoException)?.code
			if (code === "ENOENT") {
				this.setList(scope, [])
				return
			}
			this.log(
				`[ScheduledTaskStore] Failed to load ${scope}: ${error instanceof Error ? error.message : String(error)}`,
			)
			this.setList(scope, [])
		}
	}

	private setList(scope: ScheduledTaskScope, tasks: ScheduledTask[]): void {
		if (scope === "workspace") this.workspaceTasks = tasks
		else this.globalTasks = tasks
	}

	private async persistScope(scope: ScheduledTaskScope): Promise<void> {
		const file = await this.storePath(scope)
		if (!file) return
		const dir = path.dirname(file)
		await fs.mkdir(dir, { recursive: true })
		const envelope: ScheduledTaskStoreFile = {
			version: STORE_VERSION,
			tasks: this.listFor(scope),
		}
		await fs.writeFile(file, JSON.stringify(envelope, null, "\t"), "utf-8")
	}

	private async truncateRunHistory(file: string): Promise<void> {
		try {
			const content = await fs.readFile(file, "utf-8")
			const lines = content.split("\n").filter((l) => l.trim().length > 0)
			const cap = SCHEDULED_TASK_LIMITS.maxRunHistoryPerTask
			if (lines.length > cap) {
				const trimmed = lines.slice(-cap).join("\n") + "\n"
				await fs.writeFile(file, trimmed, "utf-8")
			}
		} catch {
			// best-effort
		}
	}
}

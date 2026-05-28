/**
 * ScheduledTaskTools - 6 个定时任务管理工具
 *
 * 工具列表：
 * - schedule_task           创建定时任务
 * - list_scheduled_tasks    列出定时任务
 * - update_scheduled_task   更新定时任务
 * - cancel_scheduled_task   删除定时任务
 * - run_scheduled_task_now  立即触发一次
 * - get_scheduled_task_runs 查询运行历史
 *
 * 所有定时任务工具均无需用户审批 —— 因为：
 *  1. 定时任务本身在执行时仍受全局自动审批策略约束
 *  2. 创建/修改/删除/触发是元数据操作，UI 中可一目了然审计
 *  3. 用户已通过对话明确表达意图，无需再次确认
 */

import type {
	CreateScheduledTaskInput,
	ScheduledTaskScope,
	ScheduleTrigger,
	UpdateScheduledTaskInput,
} from "@roo-code/types"

import { Task } from "../task/Task"
import { BaseTool, ToolCallbacks } from "./BaseTool"

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderWithScheduler {
	getScheduledTaskStore?: () => SchedulerStoreAPI | undefined
	getScheduledTaskScheduler?: () => SchedulerControlAPI | undefined
}

interface SchedulerStoreAPI {
	create(input: CreateScheduledTaskInput): Promise<unknown>
	update(id: string, patch: UpdateScheduledTaskInput): Promise<unknown>
	delete(id: string): Promise<boolean>
	getAll(): unknown[]
	getByScope(scope: ScheduledTaskScope): unknown[]
	getById(id: string): unknown | undefined
	listRuns(id: string, limit?: number): Promise<unknown[]>
}

interface SchedulerControlAPI {
	triggerNow(taskId: string): boolean
}

interface SchedulerAccess {
	store: SchedulerStoreAPI
	scheduler: SchedulerControlAPI
}

function getSchedulerAccess(task: Task): SchedulerAccess | { error: string } {
	const provider = task.providerRef.deref() as unknown as ProviderWithScheduler | undefined
	if (!provider) return { error: "ClineProvider not available" }
	const store = provider.getScheduledTaskStore?.()
	const scheduler = provider.getScheduledTaskScheduler?.()
	if (!store || !scheduler) {
		return { error: "Scheduled tasks subsystem is not initialized in this VS Code session" }
	}
	return { store, scheduler }
}

function jsonResult(value: unknown): string {
	return "```json\n" + JSON.stringify(value, null, 2) + "\n```"
}

// ─────────────────────────────────────────────────────────────────────────────
// schedule_task
// ─────────────────────────────────────────────────────────────────────────────

export interface ScheduleTaskParams {
	name: string
	description?: string | null
	trigger: ScheduleTrigger
	mode: string
	prompt: string
	apiConfigName?: string | null
	scope?: ScheduledTaskScope | null
	maxRuntimeMs?: number | null
	concurrency?: "skip" | "queue" | "cancel-previous" | null
	notifyOn?: ("success" | "failure")[] | null
}

export class ScheduleTaskTool extends BaseTool<"schedule_task"> {
	readonly name = "schedule_task" as const

	async execute(params: ScheduleTaskParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult } = callbacks
		const access = getSchedulerAccess(task)
		if ("error" in access) {
			pushToolResult(`Error: ${access.error}`)
			return
		}

		try {
			// 默认写入 global 作用域：大模型创建的定时任务通常希望跨工作区可见，
			// 且全局存储位置（globalStorageUri）不会因切换项目而消失。
			// 用户在调用时仍可显式传入 scope: "workspace" 把任务绑定到当前项目。
			const created = await access.store.create({
				name: params.name,
				description: params.description ?? undefined,
				trigger: params.trigger,
				mode: params.mode,
				prompt: params.prompt,
				apiConfigName: params.apiConfigName ?? undefined,
				scope: (params.scope ?? "global") as ScheduledTaskScope,
				maxRuntimeMs: params.maxRuntimeMs ?? undefined,
				concurrency: params.concurrency ?? undefined,
				notifyOn: params.notifyOn ?? undefined,
				createdBy: "model",
			})
			pushToolResult(`Scheduled task created.\n${jsonResult(created)}`)
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error)
			pushToolResult(`Error creating scheduled task: ${msg}`)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// list_scheduled_tasks
// ─────────────────────────────────────────────────────────────────────────────

export interface ListScheduledTasksParams {
	scope?: "workspace" | "global" | "all" | null
	enabled_only?: boolean | null
}

export class ListScheduledTasksTool extends BaseTool<"list_scheduled_tasks"> {
	readonly name = "list_scheduled_tasks" as const

	async execute(params: ListScheduledTasksParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const access = getSchedulerAccess(task)
		if ("error" in access) {
			callbacks.pushToolResult(`Error: ${access.error}`)
			return
		}

		const scope = params.scope ?? "all"
		const all =
			scope === "all" ? access.store.getAll() : access.store.getByScope(scope as ScheduledTaskScope)

		const filtered = params.enabled_only ? all.filter((t: any) => t?.enabled === true) : all
		callbacks.pushToolResult(
			`Found ${filtered.length} scheduled task(s).\n${jsonResult(filtered)}`,
		)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// update_scheduled_task
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateScheduledTaskParams {
	id: string
	name?: string | null
	description?: string | null
	trigger?: ScheduleTrigger | null
	mode?: string | null
	prompt?: string | null
	apiConfigName?: string | null
	enabled?: boolean | null
	maxRuntimeMs?: number | null
	concurrency?: "skip" | "queue" | "cancel-previous" | null
	notifyOn?: ("success" | "failure")[] | null
}

export class UpdateScheduledTaskTool extends BaseTool<"update_scheduled_task"> {
	readonly name = "update_scheduled_task" as const

	async execute(params: UpdateScheduledTaskParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult } = callbacks
		const access = getSchedulerAccess(task)
		if ("error" in access) {
			pushToolResult(`Error: ${access.error}`)
			return
		}

		if (!params.id) {
			pushToolResult("Error: id is required")
			return
		}

		const patch: UpdateScheduledTaskInput = {}
		if (params.name != null) patch.name = params.name
		if (params.description != null) patch.description = params.description
		if (params.trigger != null) patch.trigger = params.trigger
		if (params.mode != null) patch.mode = params.mode
		if (params.prompt != null) patch.prompt = params.prompt
		if (params.apiConfigName != null) patch.apiConfigName = params.apiConfigName
		if (params.enabled != null) patch.enabled = params.enabled
		if (params.maxRuntimeMs != null) patch.maxRuntimeMs = params.maxRuntimeMs
		if (params.concurrency != null) patch.concurrency = params.concurrency
		if (params.notifyOn != null) patch.notifyOn = params.notifyOn

		try {
			const updated = await access.store.update(params.id, patch)
			pushToolResult(`Scheduled task updated.\n${jsonResult(updated)}`)
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error)
			pushToolResult(`Error updating scheduled task: ${msg}`)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// cancel_scheduled_task
// ─────────────────────────────────────────────────────────────────────────────

export interface CancelScheduledTaskParams {
	id: string
}

export class CancelScheduledTaskTool extends BaseTool<"cancel_scheduled_task"> {
	readonly name = "cancel_scheduled_task" as const

	async execute(params: CancelScheduledTaskParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult } = callbacks
		const access = getSchedulerAccess(task)
		if ("error" in access) {
			pushToolResult(`Error: ${access.error}`)
			return
		}

		if (!params.id) {
			pushToolResult("Error: id is required")
			return
		}

		const target = access.store.getById(params.id)
		if (!target) {
			pushToolResult(`Error: scheduled task not found: ${params.id}`)
			return
		}

		try {
			const ok = await access.store.delete(params.id)
			pushToolResult(ok ? `Scheduled task ${params.id} deleted.` : `Scheduled task not found: ${params.id}`)
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error)
			pushToolResult(`Error deleting scheduled task: ${msg}`)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// run_scheduled_task_now
// ─────────────────────────────────────────────────────────────────────────────

export interface RunScheduledTaskNowParams {
	id: string
}

export class RunScheduledTaskNowTool extends BaseTool<"run_scheduled_task_now"> {
	readonly name = "run_scheduled_task_now" as const

	async execute(params: RunScheduledTaskNowParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult } = callbacks
		const access = getSchedulerAccess(task)
		if ("error" in access) {
			pushToolResult(`Error: ${access.error}`)
			return
		}

		if (!params.id) {
			pushToolResult("Error: id is required")
			return
		}

		const target = access.store.getById(params.id)
		if (!target) {
			pushToolResult(`Error: scheduled task not found: ${params.id}`)
			return
		}

		const fired = access.scheduler.triggerNow(params.id)
		pushToolResult(fired ? `Scheduled task ${params.id} triggered.` : `Failed to trigger task ${params.id}.`)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// get_scheduled_task_runs
// ─────────────────────────────────────────────────────────────────────────────

export interface GetScheduledTaskRunsParams {
	id: string
	limit?: number | null
}

export class GetScheduledTaskRunsTool extends BaseTool<"get_scheduled_task_runs"> {
	readonly name = "get_scheduled_task_runs" as const

	async execute(params: GetScheduledTaskRunsParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult } = callbacks
		const access = getSchedulerAccess(task)
		if ("error" in access) {
			pushToolResult(`Error: ${access.error}`)
			return
		}

		if (!params.id) {
			pushToolResult("Error: id is required")
			return
		}

		const limit = params.limit ?? 20
		try {
			const runs = await access.store.listRuns(params.id, limit)
			pushToolResult(
				`Found ${runs.length} run record(s) for ${params.id}.\n${jsonResult(runs)}`,
			)
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error)
			pushToolResult(`Error fetching runs: ${msg}`)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons
// ─────────────────────────────────────────────────────────────────────────────

export const scheduleTaskTool = new ScheduleTaskTool()
export const listScheduledTasksTool = new ListScheduledTasksTool()
export const updateScheduledTaskTool = new UpdateScheduledTaskTool()
export const cancelScheduledTaskTool = new CancelScheduledTaskTool()
export const runScheduledTaskNowTool = new RunScheduledTaskNowTool()
export const getScheduledTaskRunsTool = new GetScheduledTaskRunsTool()

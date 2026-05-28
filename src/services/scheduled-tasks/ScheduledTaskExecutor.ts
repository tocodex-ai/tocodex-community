/**
 * ScheduledTaskExecutor
 *
 * 监听调度器的 trigger 事件，调用 ClineProvider.createTask 创建一个新的 Task，
 * 监听 Task 完成 / 失败事件并把结果写入 run history。
 *
 * 设计参考: .tocodex/plans/scheduled-tasks-system-design.md
 */

import * as vscode from "vscode"
import * as crypto from "crypto"

import type {
	ScheduledTask,
	ScheduledTaskRun,
	ScheduledTaskRunStatus,
	ConcurrencyPolicy,
	NotifyEvent,
} from "@roo-code/types"

import type { ScheduledTaskStore } from "./ScheduledTaskStore"
import type { ScheduledTaskScheduler, SchedulerTriggerEvent } from "./ScheduledTaskScheduler"

/**
 * Provider 适配器：定时任务执行器只依赖这个最小接口，避免循环引用 ClineProvider 全量。
 */
export interface SchedulerProviderAdapter {
	/** 切换到指定模式（触发 ensureBrowserWorkerMcpConfig 等副作用） */
	handleModeSwitch(mode: string): Promise<void>
	/** 创建一个新顶层任务并返回 Task 句柄（必须支持事件订阅） */
	createTask(
		text: string,
		images: string[] | undefined,
		parentTask: undefined,
		options: Record<string, unknown>,
		configuration: Record<string, unknown>,
	): Promise<SchedulerTaskHandle>
	/** 取消当前正在运行的顶层任务 */
	cancelTask(): Promise<void>
	log(message: string): void
}

/**
 * Task 句柄（执行器只需要这些事件 + taskId）
 */
export interface SchedulerTaskHandle {
	taskId: string
	on(event: "taskCompleted", listener: (taskId: string, usage?: TaskTokenUsage, tools?: unknown) => void): void
	on(event: "taskAborted", listener: () => void): void
	on(event: string, listener: (...args: unknown[]) => void): void
	off?(event: string, listener: (...args: unknown[]) => void): void
}

export interface TaskTokenUsage {
	totalTokensIn?: number
	totalTokensOut?: number
	totalCost?: number
}

interface RunningExecution {
	runId: string
	taskHandle?: SchedulerTaskHandle
	timeoutTimer?: ReturnType<typeof setTimeout>
	idleFinalizeTimer?: ReturnType<typeof setTimeout>
	startedAt: number
}

export interface ScheduledTaskExecutorOptions {
	store: ScheduledTaskStore
	scheduler: ScheduledTaskScheduler
	getProvider: () => SchedulerProviderAdapter | undefined
	log?: (message: string) => void
	/** 通知通道（VS Code 通知 / 输出面板） */
	notify?: (level: "info" | "error", message: string) => void
}

/**
 * 执行器：trigger -> createTask -> monitor -> record
 */
export class ScheduledTaskExecutor {
	private running = new Map<string, RunningExecution>()
	private queues = new Map<string, ScheduledTask[]>()
	private started = false
	private readonly log: (message: string) => void
	private readonly notify: (level: "info" | "error", message: string) => void

	constructor(private readonly options: ScheduledTaskExecutorOptions) {
		this.log = options.log ?? (() => {})
		this.notify =
			options.notify ??
			((level, message) => {
				if (level === "error") void vscode.window.showErrorMessage(message)
				else void vscode.window.showInformationMessage(message)
			})
	}

	start(): void {
		if (this.started) return
		this.started = true
		this.options.scheduler.on("trigger", this.onTrigger)
		this.log("[ScheduledTaskExecutor] started")
	}

	stop(): void {
		if (!this.started) return
		this.started = false
		this.options.scheduler.off("trigger", this.onTrigger)
		for (const exec of this.running.values()) {
			if (exec.timeoutTimer) clearTimeout(exec.timeoutTimer)
		}
		this.running.clear()
		this.queues.clear()
		this.log("[ScheduledTaskExecutor] stopped")
	}

	private onTrigger = (event: SchedulerTriggerEvent): void => {
		void this.handleTrigger(event.task)
	}

	private async handleTrigger(task: ScheduledTask): Promise<void> {
		const existing = this.running.get(task.id)
		if (existing) {
			const policy: ConcurrencyPolicy = task.concurrency
			if (policy === "skip") {
				this.log(`[Executor] task ${task.id} still running, skipping new trigger`)
				await this.recordRun(task, {
					runId: this.makeRunId(),
					startedAt: Date.now(),
					finishedAt: Date.now(),
					status: "skipped",
				})
				return
			}
			if (policy === "queue") {
				this.log(`[Executor] task ${task.id} still running, queuing new trigger`)
				const queue = this.queues.get(task.id) ?? []
				queue.push(task)
				this.queues.set(task.id, queue)
				return
			}
			if (policy === "cancel-previous") {
				this.log(`[Executor] task ${task.id} cancelling previous run`)
				await this.cancelRunning(task.id)
			}
		}

		await this.execute(task)
	}

	private async execute(task: ScheduledTask): Promise<void> {
		const provider = this.options.getProvider()
		if (!provider) {
			this.log(`[Executor] no provider available, skipping task ${task.id}`)
			await this.recordRun(task, {
				runId: this.makeRunId(),
				startedAt: Date.now(),
				finishedAt: Date.now(),
				status: "failed",
				error: "ClineProvider not available",
			})
			return
		}

		const runId = this.makeRunId()
		const startedAt = Date.now()
		const initialRun: ScheduledTaskRun = { runId, startedAt, status: "running" }
		await this.recordRun(task, initialRun)

		// 切换模式（确保 MCP 配置就位）
		try {
			await provider.handleModeSwitch(task.mode)
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error)
			this.log(`[Executor] mode switch failed for task ${task.id}: ${msg}`)
			await this.finalize(task, runId, "failed", { error: `Mode switch failed: ${msg}`, startedAt })
			return
		}

		// 创建 Task
		let handle: SchedulerTaskHandle
		try {
			const configuration: Record<string, unknown> = {}
			if (task.apiConfigName) configuration.currentApiConfigName = task.apiConfigName
			handle = await provider.createTask(task.prompt, undefined, undefined, {}, configuration)
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error)
			this.log(`[Executor] createTask failed for ${task.id}: ${msg}`)
			await this.finalize(task, runId, "failed", { error: msg, startedAt })
			return
		}

		// 注册到 running
		const exec: RunningExecution = { runId, taskHandle: handle, startedAt }

		// 设置超时
		const timeoutMs = task.maxRuntimeMs
		exec.timeoutTimer = setTimeout(() => {
			this.log(`[Executor] task ${task.id} run ${runId} timed out after ${timeoutMs}ms`)
			provider.cancelTask().catch(() => {})
			void this.finalize(task, runId, "timeout", { error: `Timed out after ${timeoutMs}ms`, startedAt })
		}, timeoutMs)

		this.running.set(task.id, exec)

		// finalize 串行化保护：一旦走过任意一条路径（completed/aborted/idle/timeout），
		// 后续事件都视为 noop，避免 idle-finalize 之后 abort/completed 又走一次 recordRun。
		let finalized = false
		const callFinalize = (
			status: ScheduledTaskRunStatus,
			extra: Parameters<ScheduledTaskExecutor["finalize"]>[3],
		) => {
			if (finalized) return
			finalized = true
			cleanup()
			void this.finalize(task, runId, status, extra)
		}

		// 监听完成
		const onCompleted = (_taskId: string, usage?: TaskTokenUsage) => {
			callFinalize("completed", {
				startedAt,
				taskId: handle.taskId,
				totalCost: usage?.totalCost,
				totalTokensIn: usage?.totalTokensIn,
				totalTokensOut: usage?.totalTokensOut,
			})
		}
		const onAborted = () => {
			callFinalize("cancelled", {
				startedAt,
				taskId: handle.taskId,
				error: "Task aborted",
			})
		}
		// 兜底：模型没调用 attempt_completion 时（例如 "你好" 这种简单回复），
		// Task 会停留在 idle/interactive 等用户输入，permanently 占住 running 槽。
		// 触发 idle-finalize 时主动调 cancelTask 释放 Task，避免下次 trigger 创建新 Task
		// 时旧 Task 因 removeClineFromStack 抛 taskAborted —— 那时 listener 虽已 off 但
		// 也许仍有竞态。串行化 finalized 标志 + 主动 cancel 双保险。
		const armIdleFinalize = (reason: string) => {
			if (exec.idleFinalizeTimer) clearTimeout(exec.idleFinalizeTimer)
			exec.idleFinalizeTimer = setTimeout(() => {
				if (finalized) return
				if (!this.running.has(task.id)) return
				this.log(`[Executor] task ${task.id} idle-finalize fired (${reason})`)
				// 先标记 + cleanup（off listener），再 cancelTask（避免 onAborted 抢跑）
				callFinalize("completed", {
					startedAt,
					taskId: handle.taskId,
				})
				// 主动释放 Task 资源（异步、忽略错误）
				const p = this.options.getProvider()
				if (p) {
					p.cancelTask().catch((err) => {
						this.log(
							`[Executor] idle-finalize cancelTask failed for ${task.id}: ${err instanceof Error ? err.message : String(err)}`,
						)
					})
				}
			}, 10_000)
		}
		const cancelIdleFinalize = () => {
			if (exec.idleFinalizeTimer) {
				clearTimeout(exec.idleFinalizeTimer)
				exec.idleFinalizeTimer = undefined
			}
		}
		// 任何 Message/Active 都意味着任务还在跑，取消 idle 兜底
		const onActivity = () => {
			cancelIdleFinalize()
		}
		// taskIdle / taskInteractive / taskResumable = 模型回 ask 后等用户输入 → 触发兜底定时器
		const onIdle = () => {
			armIdleFinalize("taskIdle")
		}
		const cleanup = () => {
			if (exec.timeoutTimer) clearTimeout(exec.timeoutTimer)
			cancelIdleFinalize()
			if (handle.off) {
				handle.off("taskCompleted", onCompleted as unknown as (...a: unknown[]) => void)
				handle.off("taskAborted", onAborted as unknown as (...a: unknown[]) => void)
				handle.off("taskIdle", onIdle as unknown as (...a: unknown[]) => void)
				handle.off("taskInteractive", onIdle as unknown as (...a: unknown[]) => void)
				handle.off("taskResumable", onIdle as unknown as (...a: unknown[]) => void)
				handle.off("taskActive", onActivity as unknown as (...a: unknown[]) => void)
				handle.off("message", onActivity as unknown as (...a: unknown[]) => void)
			}
			this.running.delete(task.id)
			// 处理队列
			const queue = this.queues.get(task.id)
			if (queue && queue.length > 0) {
				const next = queue.shift()!
				if (queue.length === 0) this.queues.delete(task.id)
				else this.queues.set(task.id, queue)
				void this.execute(next)
			}
		}

		handle.on("taskCompleted", onCompleted as (...a: unknown[]) => void)
		handle.on("taskAborted", onAborted as (...a: unknown[]) => void)
		handle.on("taskIdle", onIdle as (...a: unknown[]) => void)
		handle.on("taskInteractive", onIdle as (...a: unknown[]) => void)
		handle.on("taskResumable", onIdle as (...a: unknown[]) => void)
		handle.on("taskActive", onActivity as (...a: unknown[]) => void)
		handle.on("message", onActivity as (...a: unknown[]) => void)
	}

	private async cancelRunning(taskId: string): Promise<void> {
		const exec = this.running.get(taskId)
		if (!exec) return
		const provider = this.options.getProvider()
		if (provider) await provider.cancelTask().catch(() => {})
		if (exec.timeoutTimer) clearTimeout(exec.timeoutTimer)
		if (exec.idleFinalizeTimer) clearTimeout(exec.idleFinalizeTimer)
		this.running.delete(taskId)
	}

	private async finalize(
		task: ScheduledTask,
		runId: string,
		status: ScheduledTaskRunStatus,
		extra: { startedAt: number; error?: string; taskId?: string; totalCost?: number; totalTokensIn?: number; totalTokensOut?: number },
	): Promise<void> {
		const finishedAt = Date.now()
		const run: ScheduledTaskRun = {
			runId,
			startedAt: extra.startedAt,
			finishedAt,
			status,
			taskId: extra.taskId,
			error: extra.error,
			totalCost: extra.totalCost,
			totalTokensIn: extra.totalTokensIn,
			totalTokensOut: extra.totalTokensOut,
		}
		await this.recordRun(task, run)
		this.notifyIfNeeded(task, run)
	}

	private async recordRun(task: ScheduledTask, run: ScheduledTaskRun): Promise<void> {
		await this.options.store.appendRun(task.id, run)
		await this.options.store.updateRuntimeState(task.id, { lastRun: run })
	}

	private notifyIfNeeded(task: ScheduledTask, run: ScheduledTaskRun): void {
		const wantedEvents = new Set<NotifyEvent>(task.notifyOn)
		const shouldNotify =
			(run.status === "completed" && wantedEvents.has("success")) ||
			(["failed", "timeout", "cancelled"].includes(run.status) && wantedEvents.has("failure"))
		if (!shouldNotify) return

		const msg = `Scheduled task "${task.name}" ${run.status}${run.error ? `: ${run.error}` : ""}`
		const level: "info" | "error" = run.status === "completed" ? "info" : "error"
		this.notify(level, msg)
	}

	private makeRunId(): string {
		return crypto.randomUUID()
	}
}

/**
 * ScheduledTaskScheduler
 *
 * 解析 trigger（cron / interval / once），注册 setTimeout/setInterval，
 * 到点时 emit "trigger" 事件供 Executor 消费。
 *
 * 设计参考: .tocodex/plans/scheduled-tasks-system-design.md
 */

import { EventEmitter } from "events"
import * as cronParser from "cron-parser"

import type { ScheduledTask, ScheduleTrigger, ScheduledTaskScope } from "@roo-code/types"
import type { ScheduledTaskStore, StoreChangeEvent } from "./ScheduledTaskStore"

export interface SchedulerTriggerEvent {
	taskId: string
	task: ScheduledTask
}

export interface ScheduledTaskSchedulerEvents {
	trigger: (event: SchedulerTriggerEvent) => void
}

interface TimerEntry {
	taskId: string
	timerId: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>
	kind: "timeout" | "interval"
}

export interface ScheduledTaskSchedulerOptions {
	store: ScheduledTaskStore
	log?: (message: string) => void
}

/**
 * 调度器：监听 store 变化，维护 timer 映射，到点 emit trigger
 */
export class ScheduledTaskScheduler extends EventEmitter {
	private timers = new Map<string, TimerEntry>()
	private running = false
	private readonly log: (message: string) => void

	constructor(private readonly options: ScheduledTaskSchedulerOptions) {
		super()
		this.log = options.log ?? (() => {})
	}

	// ─── lifecycle ────────────────────────────────────────────────────────

	start(): void {
		if (this.running) return
		this.running = true
		this.options.store.on("change", this.onStoreChange)
		// 初始化所有已有任务
		for (const task of this.options.store.getAll()) {
			this.scheduleTask(task)
		}
		this.log("[ScheduledTaskScheduler] started")
	}

	stop(): void {
		if (!this.running) return
		this.running = false
		this.options.store.off("change", this.onStoreChange)
		for (const entry of this.timers.values()) {
			this.clearTimer(entry)
		}
		this.timers.clear()
		this.log("[ScheduledTaskScheduler] stopped")
	}

	// ─── public helpers ──────────────────────────────────────────────────

	/**
	 * 手动触发一次（不影响周期）
	 */
	triggerNow(taskId: string): boolean {
		const task = this.options.store.getById(taskId)
		if (!task) return false
		this.emit("trigger", { taskId, task } satisfies SchedulerTriggerEvent)
		return true
	}

	/**
	 * 计算某个 trigger 的下一次触发时间（用于 UI 预览）
	 */
	static computeNextRunAt(trigger: ScheduleTrigger, now = Date.now()): number | undefined {
		switch (trigger.kind) {
			case "cron": {
				try {
					const interval = cronParser.parseExpression(trigger.expression, {
						currentDate: new Date(now),
						tz: trigger.timezone,
					})
					return interval.next().getTime()
				} catch {
					return undefined
				}
			}
			case "interval": {
				const start = trigger.startAt ?? now
				if (start > now) return start
				const elapsed = now - start
				const periods = Math.floor(elapsed / trigger.intervalMs)
				return start + (periods + 1) * trigger.intervalMs
			}
			case "once": {
				return trigger.runAt > now ? trigger.runAt : undefined
			}
		}
	}

	/**
	 * 预览 cron 表达式的未来 N 次触发时间
	 */
	static previewCron(expression: string, count = 5, timezone?: string): number[] {
		try {
			const interval = cronParser.parseExpression(expression, { tz: timezone })
			const results: number[] = []
			for (let i = 0; i < count; i++) {
				results.push(interval.next().getTime())
			}
			return results
		} catch {
			return []
		}
	}

	// ─── internal ────────────────────────────────────────────────────────

	private onStoreChange = (event: StoreChangeEvent): void => {
		if (!this.running) return
		const { reason, taskId, scope } = event

		if (reason === "load") {
			// 重新调度该 scope 的所有任务
			for (const task of this.options.store.getByScope(scope)) {
				this.scheduleTask(task)
			}
			return
		}

		if (reason === "delete" && taskId) {
			this.cancelTask(taskId)
			return
		}

		if ((reason === "create" || reason === "update") && taskId) {
			const task = this.options.store.getById(taskId)
			if (task) this.scheduleTask(task)
			return
		}

		// "run" 事件不需要重新调度（nextRunAt 已由 executor 更新）
	}

	private scheduleTask(task: ScheduledTask): void {
		// 先取消旧的
		this.cancelTask(task.id)

		if (!task.enabled) {
			this.log(`[Scheduler] task ${task.id} disabled, skipping`)
			return
		}

		const now = Date.now()
		const nextRunAt = ScheduledTaskScheduler.computeNextRunAt(task.trigger, now)

		if (nextRunAt === undefined) {
			this.log(`[Scheduler] task ${task.id} has no future run time`)
			// 对于 once 任务，如果已过期，自动禁用
			if (task.trigger.kind === "once") {
				this.options.store.update(task.id, { enabled: false }).catch(() => {})
			}
			return
		}

		// 更新 store 中的 nextRunAt
		this.options.store.updateRuntimeState(task.id, { nextRunAt }).catch(() => {})

		const delay = Math.max(0, nextRunAt - now)

		if (task.trigger.kind === "interval") {
			// 先 setTimeout 到首次触发，然后 setInterval
			const intervalMs = task.trigger.intervalMs
			const timerId = setTimeout(() => {
				this.fireTrigger(task.id)
				this.advanceNextRunAt(task.id, intervalMs)
				// 启动 interval
				const intervalId = setInterval(() => {
					this.fireTrigger(task.id)
					this.advanceNextRunAt(task.id, intervalMs)
				}, intervalMs)
				this.timers.set(task.id, { taskId: task.id, timerId: intervalId, kind: "interval" })
			}, delay)
			this.timers.set(task.id, { taskId: task.id, timerId, kind: "timeout" })
		} else {
			// cron / once 都用 setTimeout，cron 触发后再重新调度
			const timerId = setTimeout(() => {
				this.fireTrigger(task.id)
				// cron 需要重新调度下一次
				if (task.trigger.kind === "cron") {
					const refreshed = this.options.store.getById(task.id)
					if (refreshed) this.scheduleTask(refreshed)
				} else if (task.trigger.kind === "once") {
					// 单次任务触发后自动禁用
					this.options.store.update(task.id, { enabled: false }).catch(() => {})
				}
			}, delay)
			this.timers.set(task.id, { taskId: task.id, timerId, kind: "timeout" })
		}

		this.log(`[Scheduler] task ${task.id} scheduled, next run in ${Math.round(delay / 1000)}s`)
	}

	/**
		* interval 任务每 tick 把 nextRunAt 向前推进一个周期，确保 UI 与 tick 同步。
		*/
	private advanceNextRunAt(taskId: string, intervalMs: number): void {
		const task = this.options.store.getById(taskId)
		if (!task || !task.enabled) return
		const next = Date.now() + intervalMs
		this.options.store.updateRuntimeState(taskId, { nextRunAt: next }).catch(() => {})
	}

	private fireTrigger(taskId: string): void {
		const task = this.options.store.getById(taskId)
		if (!task || !task.enabled) return
		this.log(`[Scheduler] firing trigger for task ${taskId}`)
		this.emit("trigger", { taskId, task } satisfies SchedulerTriggerEvent)
	}

	private cancelTask(taskId: string): void {
		const entry = this.timers.get(taskId)
		if (!entry) return
		this.clearTimer(entry)
		this.timers.delete(taskId)
	}

	private clearTimer(entry: TimerEntry): void {
		if (entry.kind === "interval") {
			clearInterval(entry.timerId)
		} else {
			clearTimeout(entry.timerId)
		}
	}
}

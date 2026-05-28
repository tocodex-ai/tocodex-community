import { z } from "zod"

/**
 * Scheduled Task System Types
 *
 * 定时任务数据模型 - 由 ToCodex 内置调度器在 VS Code 运行时定期执行预设的 Task。
 * 详细设计参考 .tocodex/plans/scheduled-tasks-system-design.md
 */

// ─── Triggers ─────────────────────────────────────────────────────────────────

export const cronTriggerSchema = z.object({
	kind: z.literal("cron"),
	expression: z.string().min(1),
	timezone: z.string().optional(),
})

export const intervalTriggerSchema = z.object({
	kind: z.literal("interval"),
	intervalMs: z.number().int().positive(),
	startAt: z.number().int().optional(),
})

export const onceTriggerSchema = z.object({
	kind: z.literal("once"),
	runAt: z.number().int().positive(),
})

export const scheduleTriggerSchema = z.discriminatedUnion("kind", [
	cronTriggerSchema,
	intervalTriggerSchema,
	onceTriggerSchema,
])

export type CronTrigger = z.infer<typeof cronTriggerSchema>
export type IntervalTrigger = z.infer<typeof intervalTriggerSchema>
export type OnceTrigger = z.infer<typeof onceTriggerSchema>
export type ScheduleTrigger = z.infer<typeof scheduleTriggerSchema>

// ─── Concurrency / Notification policy ────────────────────────────────────────

export const concurrencyPolicySchema = z.enum(["skip", "queue", "cancel-previous"])
export type ConcurrencyPolicy = z.infer<typeof concurrencyPolicySchema>

export const notifyEventSchema = z.enum(["success", "failure"])
export type NotifyEvent = z.infer<typeof notifyEventSchema>

export const catchUpPolicySchema = z.enum(["skip", "run-once"])
export type CatchUpPolicy = z.infer<typeof catchUpPolicySchema>

export const scheduledTaskScopeSchema = z.enum(["workspace", "global"])
export type ScheduledTaskScope = z.infer<typeof scheduledTaskScopeSchema>

export const scheduledTaskRunStatusSchema = z.enum([
	"running",
	"completed",
	"failed",
	"skipped",
	"cancelled",
	"timeout",
])
export type ScheduledTaskRunStatus = z.infer<typeof scheduledTaskRunStatusSchema>

// ─── Run record (single execution) ────────────────────────────────────────────

export const scheduledTaskRunSchema = z.object({
	runId: z.string(),
	startedAt: z.number(),
	finishedAt: z.number().optional(),
	status: scheduledTaskRunStatusSchema,
	taskId: z.string().optional(),
	error: z.string().optional(),
	totalCost: z.number().optional(),
	totalTokensIn: z.number().optional(),
	totalTokensOut: z.number().optional(),
})

export type ScheduledTaskRun = z.infer<typeof scheduledTaskRunSchema>

// ─── ScheduledTask (the persisted definition) ─────────────────────────────────

export const scheduledTaskSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1).max(200),
	description: z.string().max(1000).optional(),
	trigger: scheduleTriggerSchema,
	mode: z.string().min(1),
	prompt: z.string().min(1).max(50000),
	apiConfigName: z.string().optional(),
	scope: scheduledTaskScopeSchema.default("workspace"),
	enabled: z.boolean().default(true),
	maxRuntimeMs: z.number().int().positive().default(30 * 60 * 1000),
	concurrency: concurrencyPolicySchema.default("skip"),
	notifyOn: z.array(notifyEventSchema).default(["failure"]),
	catchUpPolicy: catchUpPolicySchema.default("skip"),
	createdAt: z.number(),
	updatedAt: z.number(),
	createdBy: z.enum(["user", "model"]).default("user"),
	lastRun: scheduledTaskRunSchema.optional(),
	nextRunAt: z.number().optional(),
})

export type ScheduledTask = z.infer<typeof scheduledTaskSchema>

// ─── Input types for CRUD (creation may omit auto fields) ────────────────────

/**
 * Fields the model / user provides when creating a new scheduled task.
 * Auto-fields (id, createdAt, updatedAt, lastRun, nextRunAt) are filled by the store.
 */
export interface CreateScheduledTaskInput {
	name: string
	description?: string
	trigger: ScheduleTrigger
	mode: string
	prompt: string
	apiConfigName?: string
	scope?: ScheduledTaskScope
	enabled?: boolean
	maxRuntimeMs?: number
	concurrency?: ConcurrencyPolicy
	notifyOn?: NotifyEvent[]
	catchUpPolicy?: CatchUpPolicy
	createdBy?: "user" | "model"
}

/**
 * Fields allowed for partial update.
 */
export interface UpdateScheduledTaskInput {
	name?: string
	description?: string
	trigger?: ScheduleTrigger
	mode?: string
	prompt?: string
	apiConfigName?: string
	enabled?: boolean
	maxRuntimeMs?: number
	concurrency?: ConcurrencyPolicy
	notifyOn?: NotifyEvent[]
	catchUpPolicy?: CatchUpPolicy
}

// ─── Storage envelope (the json file shape) ──────────────────────────────────

export const scheduledTaskStoreFileSchema = z.object({
	version: z.literal(1),
	tasks: z.array(scheduledTaskSchema).default([]),
})

export type ScheduledTaskStoreFile = z.infer<typeof scheduledTaskStoreFileSchema>

// ─── Hard limits (mirrored by Store implementation) ──────────────────────────

export const SCHEDULED_TASK_LIMITS = {
	/** Maximum enabled tasks per scope. */
	maxEnabledPerScope: 50,
	/** Default per-run timeout (ms) when not specified. */
	defaultMaxRuntimeMs: 30 * 60 * 1000,
	/** Maximum number of run history entries kept per task (older entries are dropped). */
	maxRunHistoryPerTask: 100,
	/** Minimum allowed interval for `interval` trigger (ms). 10s lower bound. */
	minIntervalMs: 10 * 1000,
} as const

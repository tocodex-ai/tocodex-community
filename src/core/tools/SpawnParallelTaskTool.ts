import { Task } from "../task/Task"
import { getModeBySlug } from "../../shared/modes"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { fileLockRegistry } from "../../services/file-lock/FileLockRegistry"

/**
 * 单个并行子任务的规格定义
 */
export interface ParallelTaskSpec {
	description: string
	prompt: string
	mode?: string // 默认 "code"
	files?: string[] // 该子任务操作的文件范围（用于文件锁）
	acceptance?: string // 验收标准
}

// 子任务默认超时时间（毫秒）
const PARALLEL_CHILD_TIMEOUT_MS = 8 * 60 * 1000 // 8 分钟（给子任务充足的执行时间）

/**
 * 单个并行子任务的执行结果
 */
export interface ParallelTaskResult {
	taskId: string
	description: string
	status: "completed" | "failed"
	result?: string
	error?: string
}

interface SpawnParallelTaskParams {
	tasks: string // JSON 字符串，解析为 ParallelTaskSpec[]
}

export class SpawnParallelTaskTool extends BaseTool<"spawn_parallel_task"> {
	readonly name = "spawn_parallel_task" as const

	async execute(params: SpawnParallelTaskParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { tasks: tasksJson } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			// 验证必填参数
			if (!tasksJson) {
				task.consecutiveMistakeCount++
				task.recordToolError("spawn_parallel_task")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("spawn_parallel_task", "tasks"))
				return
			}

			// 解析 JSON 子任务列表
			let taskSpecs: ParallelTaskSpec[]
			try {
				taskSpecs = JSON.parse(tasksJson)
			} catch {
				task.consecutiveMistakeCount++
				task.recordToolError("spawn_parallel_task")
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						"Invalid tasks parameter: must be a valid JSON array of task specifications.",
					),
				)
				return
			}

			// 验证是数组且非空
			if (!Array.isArray(taskSpecs) || taskSpecs.length === 0) {
				task.consecutiveMistakeCount++
				task.recordToolError("spawn_parallel_task")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError("Tasks must be a non-empty array of task specifications."))
				return
			}

			// 验证每个子任务的必填字段
			for (let i = 0; i < taskSpecs.length; i++) {
				const spec = taskSpecs[i]
				if (!spec.description || !spec.prompt) {
					task.consecutiveMistakeCount++
					task.recordToolError("spawn_parallel_task")
					task.didToolFailInCurrentTurn = true
					pushToolResult(
						formatResponse.toolError(
							`Task at index ${i} is missing required fields: "description" and "prompt" are required.`,
						),
					)
					return
				}
			}

			// 使用 Task 级别的并行子任务限制（Requirements: 13.4）
			// 从用户设置中读取上限值（动态更新，不依赖 Task 构造时的默认值）
			const taskProvider = task.providerRef.deref()
			if (taskProvider) {
				const userMaxParallel = taskProvider.contextProxy.getValue("maxParallelChildren")
				if (typeof userMaxParallel === "number" && userMaxParallel > 0) {
					task.maxParallelChildren = userMaxParallel
				}
			}
			// 计算当前正在运行的子任务数 + 本次请求的子任务数是否超过上限
			const runningCount = task.getRunningParallelChildrenCount()
			const maxParallel = task.maxParallelChildren
			const availableSlots = maxParallel - runningCount
			if (taskSpecs.length > availableSlots) {
				task.consecutiveMistakeCount++
				task.recordToolError("spawn_parallel_task")
				task.didToolFailInCurrentTurn = true
				const msg =
					runningCount > 0
						? `Too many parallel tasks: ${taskSpecs.length} requested, but only ${availableSlots} slots available (${runningCount} already running, maximum is ${maxParallel}).`
						: `Too many parallel tasks: ${taskSpecs.length} requested, maximum is ${maxParallel}.`
				pushToolResult(formatResponse.toolError(msg))
				return
			}

			// 获取 provider
			const provider = task.providerRef.deref()
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			const state = await provider.getState()

			// 验证所有子任务的 mode 是否有效
			for (let i = 0; i < taskSpecs.length; i++) {
				const spec = taskSpecs[i]
				const modeSlug = spec.mode || "code"
				const targetMode = getModeBySlug(modeSlug, state?.customModes)
				if (!targetMode) {
					pushToolResult(formatResponse.toolError(`Invalid mode "${modeSlug}" for task at index ${i}.`))
					return
				}
			}

			task.consecutiveMistakeCount = 0

			// 前置条件检查：并行任务需要「子任务」和「执行全部命令」两个自动批准都开启
			// 因为并行子任务没有 webview 交互，所有工具调用和命令执行都需要自动批准
			const subtasksEnabled = state?.alwaysAllowSubtasks === true
			const allCommandsEnabled = state?.alwaysAllowAllCommands === true

			if (!subtasksEnabled || !allCommandsEnabled) {
				const missing: string[] = []
				if (!subtasksEnabled) missing.push('"子任务 (Subtasks)"')
				if (!allCommandsEnabled) missing.push('"执行全部命令 (All Commands)"')
				pushToolResult(
					formatResponse.toolError(
						`Parallel tasks require the following auto-approve settings to be enabled: ${missing.join(" and ")}. ` +
							`Parallel child tasks run without user interaction, so they need automatic approval for all operations. ` +
							`Please enable these settings in Auto-Approve and try again. ` +
							`Falling back to sequential execution.`,
					),
				)
				return
			}

			// 构建审批消息
			const taskSummaries = taskSpecs.map((spec, i) => {
				const modeSlug = spec.mode || "code"
				return `${i + 1}. [${modeSlug}] ${spec.description}`
			})

			const toolMessage = JSON.stringify({
				tool: "spawnParallelTask",
				tasks: taskSpecs.map((spec) => ({
					description: spec.description,
					mode: spec.mode || "code",
					files: spec.files,
				})),
				summary: taskSummaries.join("\n"),
			})

			const didApprove = await askApproval("tool", toolMessage)
			if (!didApprove) {
				return
			}

			// P1: 文件锁冲突检测 — 检查子任务之间是否有文件重叠
			const allFiles = new Map<string, number>() // filePath → taskIndex
			for (let i = 0; i < taskSpecs.length; i++) {
				const spec = taskSpecs[i]
				if (spec.files) {
					for (const file of spec.files) {
						const normalized = file.replace(/\\/g, "/").toLowerCase()
						if (allFiles.has(normalized)) {
							const conflictIdx = allFiles.get(normalized)!
							pushToolResult(
								formatResponse.toolError(
									`File conflict: task ${i} ("${spec.description}") and task ${conflictIdx} ("${taskSpecs[conflictIdx].description}") both operate on "${file}". Parallel tasks must not modify the same files.`,
								),
							)
							return
						}
						allFiles.set(normalized, i)
					}
				}
			}

			// 通过 ClineProvider.spawnParallelChild 创建独立的子 Task 实例
			// 子任务不入 clineStack，在 parallelTasks Map 中并行运行
			// 清理上一批并行子任务的旧状态
			task.parallelChildren.clear()

			const spawnResults: ParallelTaskResult[] = []

			for (const spec of taskSpecs) {
				const modeSlug = spec.mode || "code"

				try {
					const child = await (provider as any).spawnParallelChild({
						parentTask: task,
						message: spec.prompt,
						mode: modeSlug,
						description: spec.description,
						files: spec.files,
					})

					spawnResults.push({
						taskId: child.taskId,
						description: spec.description,
						status: "completed",
						result: `已派发子任务 ${child.taskId}`,
					})
				} catch (error) {
					spawnResults.push({
						taskId: "",
						description: spec.description,
						status: "failed",
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}

			// 如果所有子任务都派发失败，直接返回错误
			const allFailed = spawnResults.every((r) => r.status === "failed")
			if (allFailed) {
				pushToolResult(this.formatResults(spawnResults, task))
				return
			}

			// 等待所有并行子任务完成
			// 父任务在此挂起，直到 ClineProvider.onAllParallelChildrenDone 调用 parallelResolve
			const parallelResult = await new Promise<string>((resolve) => {
				task.parallelResolve = resolve

				// P1: 超时保护
				// 保存当前 resolve 引用，避免上一次的超时 timer 清除本次的 parallelResolve
				const currentResolve = resolve
				setTimeout(() => {
					if (task.parallelResolve === currentResolve) {
						task.parallelResolve = undefined
						// 超时后清理文件锁
						for (const r of spawnResults) {
							if (r.taskId) {
								fileLockRegistry.release(r.taskId)
							}
						}
						resolve(this.formatResults(spawnResults, task) + "\n\n⚠️ 部分子任务超时未完成")
					}
				}, PARALLEL_CHILD_TIMEOUT_MS)
			})

			pushToolResult(parallelResult)
		} catch (error) {
			await handleError("spawning parallel tasks", error)
		}
	}

	/**
	 * 格式化并行任务结果为可读文本，包含并行子任务状态概览
	 */
	private formatResults(results: ParallelTaskResult[], task: Task): string {
		const lines = ["Parallel task delegation results:", ""]

		for (const r of results) {
			const statusIcon = r.status === "completed" ? "✓" : "✗"
			lines.push(`${statusIcon} ${r.description} (${r.status})`)
			if (r.taskId) {
				lines.push(`  Task ID: ${r.taskId}`)
			}
			if (r.error) {
				lines.push(`  Error: ${r.error}`)
			}
			if (r.result) {
				lines.push(`  ${r.result}`)
			}
		}

		// 附加并行子任务状态概览
		const snapshot = task.getParallelChildrenSnapshot()
		if (snapshot.length > 0) {
			lines.push("")
			lines.push(
				`Parallel children status (${task.getRunningParallelChildrenCount()}/${task.maxParallelChildren} running):`,
			)
			for (const child of snapshot) {
				const icon = child.status === "completed" ? "✓" : child.status === "failed" ? "✗" : "⟳"
				lines.push(`  ${icon} ${child.description} [${child.status}]`)
			}
		}

		return lines.join("\n")
	}

	override async handlePartial(task: Task, block: ToolUse<"spawn_parallel_task">): Promise<void> {
		const tasks: string | undefined = block.params.tasks

		const partialMessage = JSON.stringify({
			tool: "spawnParallelTask",
			tasks: tasks ?? "[]",
			summary: "",
		})

		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const spawnParallelTaskTool = new SpawnParallelTaskTool()

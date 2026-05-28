import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"

import { RooCodeEventName, type HistoryItem } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { Package } from "../../shared/package"
import type { ToolUse } from "../../shared/tools"
import { t } from "../../i18n"

import { BaseTool, ToolCallbacks } from "./BaseTool"
import { TaskProgressPersistence } from "./TaskProgressPersistence"
import { markPlanCompleted } from "../../services/plan-storage/PlanStorage"

interface AttemptCompletionParams {
	result: string
	command?: string
}

export interface AttemptCompletionCallbacks extends ToolCallbacks {
	askFinishSubTaskApproval: () => Promise<boolean>
	toolDescription: () => string
}

/**
 * Interface for provider methods needed by AttemptCompletionTool for delegation handling.
 */
interface DelegationProvider {
	getTaskWithId(id: string): Promise<{ historyItem: HistoryItem }>
	reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<void>
}

export class AttemptCompletionTool extends BaseTool<"attempt_completion"> {
	readonly name = "attempt_completion" as const

	async execute(params: AttemptCompletionParams, task: Task, callbacks: AttemptCompletionCallbacks): Promise<void> {
		const { result } = params
		const { handleError, pushToolResult, askFinishSubTaskApproval } = callbacks

		// Prevent attempt_completion if any tool failed in the current turn
		if (task.didToolFailInCurrentTurn) {
			const errorMsg = t("common:errors.attempt_completion_tool_failed")

			await task.say("error", errorMsg)
			pushToolResult(formatResponse.toolError(errorMsg))
			return
		}

		const preventCompletionWithOpenTodos = vscode.workspace
			.getConfiguration(Package.name)
			.get<boolean>("preventCompletionWithOpenTodos", false)

		const hasIncompleteTodos = task.todoList && task.todoList.some((todo) => todo.status !== "completed")

		if (preventCompletionWithOpenTodos && hasIncompleteTodos) {
			task.consecutiveMistakeCount++
			task.recordToolError("attempt_completion")

			pushToolResult(
				formatResponse.toolError(
					"Cannot complete task while there are incomplete todos. Please finish all todos before attempting completion.",
				),
			)

			return
		}

		try {
			if (!result) {
				task.consecutiveMistakeCount++
				task.recordToolError("attempt_completion")
				pushToolResult(await task.sayAndCreateMissingParamError("attempt_completion", "result"))
				return
			}

			task.consecutiveMistakeCount = 0

			await task.say("completion_result", result, undefined, false)

			// Check for subtask using parentTaskId (metadata-driven delegation)
			// 并行子任务不走 delegation 流程，直接走正常的 completion_result ask
			if (task.parentTaskId && !task.isParallelChild) {
				// Check if this subtask has already completed and returned to parent
				// to prevent duplicate tool_results when user revisits from history
				const provider = task.providerRef.deref() as DelegationProvider | undefined
				if (provider) {
					try {
						const { historyItem } = await provider.getTaskWithId(task.taskId)
						const status = historyItem?.status

						if (status === "completed") {
							// Subtask already completed - skip delegation flow entirely
							// Fall through to normal completion ask flow below (outside this if block)
							// This shows the user the completion result and waits for acceptance
							// without injecting another tool_result to the parent
						} else if (status === "active") {
							// Normal subtask completion - do delegation
							const delegation = await this.delegateToParent(
								task,
								result,
								provider,
								askFinishSubTaskApproval,
								pushToolResult,
							)
							if (delegation === "delegated") {
								this.emitTaskCompleted(task)
							}
							if (delegation !== "continue") return
						} else {
							// Unexpected status (undefined or "delegated") - log error and skip delegation
							// undefined indicates a bug in status persistence during child creation
							// "delegated" would mean this child has its own grandchild pending (shouldn't reach attempt_completion)
							console.error(
								`[AttemptCompletionTool] Unexpected child task status "${status}" for task ${task.taskId}. ` +
									`Expected "active" or "completed". Skipping delegation to prevent data corruption.`,
							)
							// Fall through to normal completion ask flow
						}
					} catch (err) {
						// If we can't get the history, log error and skip delegation
						console.error(
							`[AttemptCompletionTool] Failed to get history for task ${task.taskId}: ${(err as Error)?.message ?? String(err)}. ` +
								`Skipping delegation.`,
						)
						// Fall through to normal completion ask flow
					}
				}
			}

			const { response, text, images } = await task.ask("completion_result", "", false)

			if (response === "yesButtonClicked") {
				this.emitTaskCompleted(task)
				return
			}

			// User provided feedback - push tool result to continue the conversation
			await task.say("user_feedback", text ?? "", images)

			const feedbackText = `<user_message>\n${text}\n</user_message>`
			pushToolResult(formatResponse.toolResult(feedbackText, images))
		} catch (error) {
			await handleError("inspecting site", error as Error)
		}
	}

	/**
	 * Handles the common delegation flow when a subtask completes.
	 * Returns:
	 * - "delegated" when completion was approved and parent resumed
	 * - "denied" when user denied finishing the subtask
	 * - "continue" when caller should fall through to normal completion ask flow
	 */
	private async delegateToParent(
		task: Task,
		result: string,
		provider: DelegationProvider,
		askFinishSubTaskApproval: () => Promise<boolean>,
		pushToolResult: (result: string) => void,
	): Promise<"delegated" | "denied" | "continue"> {
		const didApprove = await askFinishSubTaskApproval()

		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return "denied"
		}

		pushToolResult("")

		await provider.reopenParentFromDelegation({
			parentTaskId: task.parentTaskId!,
			childTaskId: task.taskId,
			completionResultSummary: result,
		})

		return "delegated"
	}

	override async handlePartial(task: Task, block: ToolUse<"attempt_completion">): Promise<void> {
		const result: string | undefined = block.params.result
		const command: string | undefined = block.params.command

		const lastMessage = task.clineMessages.at(-1)

		if (command) {
			if (lastMessage && lastMessage.ask === "command") {
				await task.ask("command", command ?? "", block.partial).catch(() => {})
			} else {
				await task.say("completion_result", result ?? "", undefined, false)
				await task.ask("command", command ?? "", block.partial).catch(() => {})
			}
		} else {
			await task.say("completion_result", result ?? "", undefined, block.partial)
		}
	}

	private emitTaskCompleted(task: Task): void {
		// Force final token usage update before emitting TaskCompleted.
		// This ensures the latest stats are captured regardless of throttle timer.
		task.emitFinalTokenUsageUpdate()

		// 标记关联的计划为已完成，避免后续任务重复加载
		if (task.activePlanFilename) {
			markPlanCompleted(task.cwd, task.activePlanFilename).catch((error) => {
				console.warn(`[AttemptCompletionTool] 标记计划完成失败 (${task.activePlanFilename}):`, error)
			})
		}

		// 归档任务进度到 .tocodex/progress/archive/ (Requirements: 7.3)
		try {
			const persistence = new TaskProgressPersistence(task.cwd)
			persistence.archive(task.taskId).catch((error) => {
				console.warn(`[AttemptCompletionTool] archive async failed (taskId=${task.taskId}):`, error)
			})
		} catch (error) {
			console.warn(`[AttemptCompletionTool] archive failed (taskId=${task.taskId}):`, error)
		}

		// 自动生成任务备忘录到 tocodex-docs/
		this.generateTaskMemo(task).catch((error) => {
			console.warn(`[AttemptCompletionTool] 自动生成备忘录失败 (taskId=${task.taskId}):`, error)
		})

		// 执行 Stop hooks (Requirements: 15.3)
		if (task.hooksRunner) {
			task.hooksRunner.runStop(task.taskId).catch(() => {})
		}

		TelemetryService.instance.captureTaskCompleted(task.taskId)
		task.emit(RooCodeEventName.TaskCompleted, task.taskId, task.getTokenUsage(), task.toolUsage)
	}

	/**
	 * 自动生成任务备忘录到 tocodex-docs/ 目录。
	 * 仅在用户设置 autoGenerateTaskMemo=true 时生成。
	 */
	private async generateTaskMemo(task: Task): Promise<void> {
		// 检查用户设置
		const provider = task.providerRef.deref()
		if (!provider) return

		const state = await (provider as any).getState()
		const autoGenerateTaskMemo = state?.autoGenerateTaskMemo ?? true
		if (!autoGenerateTaskMemo) return

		// 从任务消息中提取信息
		const messages = task.clineMessages || []
		if (messages.length === 0) return

		// 获取任务描述（第一条用户消息）
		const firstUserMsg = messages.find((m) => m.type === "say" && m.say === "user_feedback")
		const taskDescription = firstUserMsg?.text?.slice(0, 200) || "未知任务"

		// 获取 completion_result
		const completionMsg = [...messages].reverse().find((m) => m.type === "say" && m.say === "completion_result")
		const completionResult = completionMsg?.text?.slice(0, 500) || ""

		// 收集修改的文件（从 tool 消息中提取）
		const changedFiles = new Set<string>()
		for (const msg of messages) {
			if (msg.type === "say" && msg.say === "tool") {
				try {
					const toolData = JSON.parse(msg.text || "{}")
					if (
						["editedExistingFile", "appliedDiff", "newFileCreated"].includes(toolData.tool) &&
						toolData.path
					) {
						changedFiles.add(toolData.path)
					}
				} catch {
					// 忽略解析失败
				}
			}
		}

		// 如果没有文件变更（纯 Q&A），跳过
		if (changedFiles.size === 0) return

		// 生成文件名
		const now = new Date()
		const pad = (n: number) => String(n).padStart(2, "0")
		const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

		// 从任务描述中提取简短标题
		const shortDesc = taskDescription
			.replace(/[<>:"/\\|?*\n\r]/g, "")
			.trim()
			.slice(0, 50)
			.trim()
			.replace(/\s+/g, "-")

		const filename = `${dateStr}_${shortDesc || "task-memo"}.md`

		// 构建备忘录内容
		const fileList = [...changedFiles].map((f) => `- \`${f}\``).join("\n")
		const content = [
			`# 任务备忘录`,
			``,
			`> 自动生成于 ${now.toISOString()}`,
			``,
			`## 任务描述`,
			``,
			taskDescription,
			``,
			`## 完成结果`,
			``,
			completionResult || "（无）",
			``,
			`## 变更文件`,
			``,
			fileList || "（无文件变更）",
			``,
		].join("\n")

		// 写入文件
		const docsDir = path.join(task.cwd, "tocodex-docs")
		const filePath = path.join(docsDir, filename)

		try {
			await fs.mkdir(docsDir, { recursive: true })
			// 检查是否已存在同名文件，避免覆盖
			try {
				await fs.access(filePath)
				// 文件已存在，添加 taskId 后缀避免冲突
				const uniqueFilename = `${dateStr}_${shortDesc || "task-memo"}_${task.taskId.slice(0, 8)}.md`
				await fs.writeFile(path.join(docsDir, uniqueFilename), content, "utf-8")
			} catch {
				// 文件不存在，正常写入
				await fs.writeFile(filePath, content, "utf-8")
			}
		} catch (error) {
			console.warn(`[AttemptCompletionTool] 写入备忘录失败:`, error)
		}
	}
}

export const attemptCompletionTool = new AttemptCompletionTool()

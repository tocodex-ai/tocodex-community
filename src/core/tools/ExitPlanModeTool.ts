import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { savePlan } from "../../services/plan-storage/PlanStorage"
import type { ToolUse } from "../../shared/tools"

interface ExitPlanModeParams {
	result: string
}

/**
 * 规划模式退出工具。
 * AI 完成规划后调用此工具，展示结构化计划等待用户确认，
 * 确认后切回执行模式。
 *
 * Requirements: 8.4, 8.5
 */
export class ExitPlanModeTool extends BaseTool<"exit_plan_mode"> {
	readonly name = "exit_plan_mode" as const

	async execute(params: ExitPlanModeParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { result } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			if (!result) {
				task.consecutiveMistakeCount++
				task.recordToolError("exit_plan_mode")
				pushToolResult(await task.sayAndCreateMissingParamError("exit_plan_mode", "result"))
				return
			}

			// 不在规划模式中
			if (!task.planMode) {
				task.recordToolError("exit_plan_mode")
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError("Not in plan mode. Use enter_plan_mode to enter plan mode first."),
				)
				return
			}

			task.consecutiveMistakeCount = 0

			const completeMessage = JSON.stringify({
				tool: "exitPlanMode",
				result,
			})

			const didApprove = await askApproval("tool", completeMessage)

			if (!didApprove) {
				// 用户拒绝，保持规划模式，允许修改计划
				pushToolResult(
					"Plan was rejected by the user. You are still in plan mode. " +
						"Please revise your plan based on user feedback and call exit_plan_mode again.",
				)
				return
			}

			// 用户确认，退出规划模式
			task.planMode = false

			// 持久化保存计划到 .tocodex/plans/
			let savedPath = ""
			try {
				savedPath = await savePlan(task.cwd, result)
				// 记录活跃计划文件名，供 attempt_completion 时标记为 completed
				if (savedPath) {
					const parts = savedPath.replace(/\\/g, "/").split("/")
					task.activePlanFilename = parts[parts.length - 1]
				}
			} catch {
				// 保存失败不影响主流程
			}

			pushToolResult(
				`Plan approved. Exited plan mode. You can now execute the plan using write and execute tools.` +
					(savedPath ? `\nPlan saved to: ${savedPath}` : ""),
			)
		} catch (error) {
			await handleError("exiting plan mode", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"exit_plan_mode">): Promise<void> {
		const result: string | undefined = block.params.result

		const partialMessage = JSON.stringify({
			tool: "exitPlanMode",
			result: result ?? "",
		})

		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const exitPlanModeTool = new ExitPlanModeTool()

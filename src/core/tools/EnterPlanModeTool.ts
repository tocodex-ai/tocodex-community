import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { loadPlans } from "../../services/plan-storage/PlanStorage"
import type { ToolUse } from "../../shared/tools"

interface EnterPlanModeParams {
	reason: string
}

/**
 * 规划模式入口工具。
 * AI 判断任务复杂度高时可调用此工具切换到规划模式，
 * 规划模式下只允许只读工具（read_file/search_files/list_files 等），
 * 禁止写入和执行类工具。
 *
 * Requirements: 8.1, 8.4
 */
export class EnterPlanModeTool extends BaseTool<"enter_plan_mode"> {
	readonly name = "enter_plan_mode" as const

	async execute(params: EnterPlanModeParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { reason } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			if (!reason) {
				task.consecutiveMistakeCount++
				task.recordToolError("enter_plan_mode")
				pushToolResult(await task.sayAndCreateMissingParamError("enter_plan_mode", "reason"))
				return
			}

			// 已经在规划模式中
			if (task.planMode) {
				task.recordToolError("enter_plan_mode")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError("Already in plan mode. Use exit_plan_mode to exit."))
				return
			}

			task.consecutiveMistakeCount = 0

			const completeMessage = JSON.stringify({
				tool: "enterPlanMode",
				reason,
			})

			const didApprove = await askApproval("tool", completeMessage)

			if (!didApprove) {
				return
			}

			// 切换到规划模式
			task.planMode = true

			// 加载已有计划作为上下文参考
			let existingPlansContext = ""
			try {
				const plans = await loadPlans(task.cwd)
				if (plans.length > 0) {
					const recent = plans.slice(0, 3)
					existingPlansContext =
						`\n\nExisting plans in .tocodex/plans/ (${plans.length} total, showing latest ${recent.length}):\n` +
						recent.map((p) => `--- ${p.filename} ---\n${p.content}`).join("\n\n")
				}
			} catch {
				// 读取失败不影响主流程
			}

			pushToolResult(
				`Successfully entered plan mode. Reason: ${reason}\n\n` +
					`In plan mode, only read-only tools are allowed (read_file, search_files, list_files, ` +
					`codebase_search, lsp_code_intelligence, web_fetch). ` +
					`Write and execute tools are blocked.\n` +
					`Use exit_plan_mode when your plan is ready for user review.` +
					existingPlansContext,
			)
		} catch (error) {
			await handleError("entering plan mode", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"enter_plan_mode">): Promise<void> {
		const reason: string | undefined = block.params.reason

		const partialMessage = JSON.stringify({
			tool: "enterPlanMode",
			reason: reason ?? "",
		})

		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const enterPlanModeTool = new EnterPlanModeTool()

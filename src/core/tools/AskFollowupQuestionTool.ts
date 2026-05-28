import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import type { ToolUse } from "../../shared/tools"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface Suggestion {
	text: string
	mode?: string
}

interface AskFollowupQuestionParams {
	question: string
	follow_up: Suggestion[]
}

export class AskFollowupQuestionTool extends BaseTool<"ask_followup_question"> {
	readonly name = "ask_followup_question" as const

	async execute(params: AskFollowupQuestionParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { question, follow_up } = params
		const { handleError, pushToolResult } = callbacks

		const recordMissingParamError = async (paramName: string): Promise<void> => {
			task.consecutiveMistakeCount++
			task.recordToolError("ask_followup_question")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("ask_followup_question", paramName))
		}

		try {
			if (!question) {
				await recordMissingParamError("question")
				return
			}

			if (!follow_up || !Array.isArray(follow_up)) {
				// follow_up 缺失时，自动生成默认选项，避免模型反复重试陷入循环
				const defaultSuggestions = [{ answer: "Yes / 是" }, { answer: "No / 否" }]
				const follow_up_json = {
					question,
					suggest: defaultSuggestions,
				}
				task.consecutiveMistakeCount = 0
				const { text, images } = await task.ask("followup", JSON.stringify(follow_up_json), false)
				await task.say("user_feedback", text ?? "", images)
				pushToolResult(formatResponse.toolResult(`<user_message>\n${text}\n</user_message>`, images))
				return
			}

			// Transform follow_up suggestions to the format expected by task.ask
			// 过滤掉空文本的建议，防止按钮显示空白
			const validSuggestions = follow_up.filter((s) => s.text && s.text.trim())
			if (validSuggestions.length === 0) {
				// 所有选项文本为空时，同样使用默认选项
				const defaultSuggestions = [{ answer: "Yes / 是" }, { answer: "No / 否" }]
				const follow_up_json = {
					question,
					suggest: defaultSuggestions,
				}
				task.consecutiveMistakeCount = 0
				const { text, images } = await task.ask("followup", JSON.stringify(follow_up_json), false)
				await task.say("user_feedback", text ?? "", images)
				pushToolResult(formatResponse.toolResult(`<user_message>\n${text}\n</user_message>`, images))
				return
			}
			const follow_up_json = {
				question,
				suggest: validSuggestions.map((s) => ({ answer: s.text, mode: s.mode })),
			}

			task.consecutiveMistakeCount = 0
			const { text, images } = await task.ask("followup", JSON.stringify(follow_up_json), false)
			await task.say("user_feedback", text ?? "", images)
			pushToolResult(formatResponse.toolResult(`<user_message>\n${text}\n</user_message>`, images))
		} catch (error) {
			await handleError("asking question", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"ask_followup_question">): Promise<void> {
		const question: string | undefined = block.nativeArgs?.question ?? block.params.question

		// During partial streaming, only show the question to avoid displaying raw JSON
		// The full JSON with suggestions will be sent when the tool call is complete (!block.partial)
		await task.ask("followup", question ?? "", block.partial).catch(() => {})
	}
}

export const askFollowupQuestionTool = new AskFollowupQuestionTool()

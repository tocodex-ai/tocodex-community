import type OpenAI from "openai"

const ENTER_PLAN_MODE_DESCRIPTION = `Request to enter plan mode. Use this tool when you determine that a task is complex and requires careful planning before execution. In plan mode, only read-only tools (read_file, search_files, list_files, codebase_search, lsp_code_intelligence, web_fetch) are allowed. Write and execute tools are blocked until you exit plan mode with user approval.`

const REASON_PARAMETER_DESCRIPTION = `Explanation for why plan mode is needed, describing the complexity of the task and what you intend to plan`

export default {
	type: "function",
	function: {
		name: "enter_plan_mode",
		description: ENTER_PLAN_MODE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				reason: {
					type: "string",
					description: REASON_PARAMETER_DESCRIPTION,
				},
			},
			required: ["reason"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

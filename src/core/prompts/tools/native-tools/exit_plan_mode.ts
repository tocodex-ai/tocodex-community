import type OpenAI from "openai"

const EXIT_PLAN_MODE_DESCRIPTION = `Request to exit plan mode and present your plan for user approval. Use this tool after you have finished exploring the codebase and designing your approach in plan mode. Present a structured plan with steps and expected file changes. If the user approves, you will exit plan mode and can begin executing the plan. If the user rejects, you remain in plan mode to revise the plan.`

const RESULT_PARAMETER_DESCRIPTION = `The structured plan to present to the user for approval. Should include numbered steps, expected file changes, and any important considerations.`

export default {
	type: "function",
	function: {
		name: "exit_plan_mode",
		description: EXIT_PLAN_MODE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				result: {
					type: "string",
					description: RESULT_PARAMETER_DESCRIPTION,
				},
			},
			required: ["result"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

import type OpenAI from "openai"

const SPAWN_PARALLEL_TASK_DESCRIPTION = `Create multiple parallel sub-tasks that execute concurrently. Use this tool when a task can be decomposed into independent sub-tasks that do not depend on each other's results. Each sub-task runs in its own task context and results are collected and returned to the parent task when all sub-tasks complete.

CRITICAL: This tool MUST be called alone. Do NOT call this tool alongside other tools in the same message turn. Gather all necessary information before calling this tool.

Each sub-task should be independent — avoid creating parallel tasks that modify the same files or depend on each other's output.

IMPORTANT SUB-TASK GUIDELINES:
- Each sub-task should create or modify only ONE file. Do NOT assign multiple files to a single sub-task.
- Keep each sub-task's prompt focused and concise — describe exactly what one file should contain.
- If a feature requires multiple files, split them into separate sub-tasks (one file per sub-task).
- This ensures reliability: if one sub-task fails, others still complete successfully.`

const TASKS_PARAMETER_DESCRIPTION = `A JSON array of sub-task specifications. Each element is an object with:
- "description": A short label for the sub-task (used in UI and logs)
- "prompt": The full instructions for the sub-task agent
- "mode": (optional) The mode slug for the sub-task (e.g., "code", "architect"). Defaults to "code".
- "files": (optional) Array of file paths this sub-task will modify. Used to prevent file conflicts between parallel tasks. Sub-tasks MUST NOT have overlapping files.
- "acceptance": (optional) A brief description of the acceptance criteria for this sub-task. The parent agent will use this to verify the sub-task's result.`

export default {
	type: "function",
	function: {
		name: "spawn_parallel_task",
		description: SPAWN_PARALLEL_TASK_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				tasks: {
					type: "string",
					description: TASKS_PARAMETER_DESCRIPTION,
				},
			},
			required: ["tasks"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

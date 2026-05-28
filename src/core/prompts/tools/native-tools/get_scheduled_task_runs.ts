import type OpenAI from "openai"

const GET_SCHEDULED_TASK_RUNS_DESCRIPTION = `Request to query the run history of a scheduled task. Use this tool to inspect when a scheduled task has executed, whether each run succeeded or failed, and how much it cost.

Parameters:
- id: (required) The scheduled task ID to query
- limit: (optional) Maximum number of recent run records to return. Defaults to 20.

Notes:
- Returns the most recent run records for the specified scheduled task
- Each record includes fields such as runId, startedAt, finishedAt, status, error, and cost
- Records are sorted in reverse chronological order (most recent first)

Example: Query the last 20 runs of a scheduled task
{ "id": "task-abc123", "limit": null }

Example: Query only the last 5 runs
{ "id": "task-abc123", "limit": 5 }`

export default {
	type: "function",
	function: {
		name: "get_scheduled_task_runs",
		description: GET_SCHEDULED_TASK_RUNS_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The scheduled task ID to query",
				},
				limit: {
					type: ["number", "null"],
					description: "Maximum number of recent run records to return. Defaults to 20",
				},
			},
			required: ["id", "limit"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

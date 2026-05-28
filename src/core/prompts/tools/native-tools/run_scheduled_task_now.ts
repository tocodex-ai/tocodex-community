import type OpenAI from "openai"

const RUN_SCHEDULED_TASK_NOW_DESCRIPTION = `Request to immediately trigger a one-time execution of a scheduled task. Use this tool when you need to manually run a scheduled task right now without waiting for its next scheduled time.

Parameters:
- id: (required) The unique identifier of the scheduled task to trigger

Notes:
- This performs a manual, one-shot execution of the scheduled task
- The task's normal scheduling cycle is NOT affected; subsequent scheduled runs continue as configured
- If the task is currently running, the trigger will be handled according to the task's concurrency policy (e.g. skip, queue, or run in parallel)
- The task must already exist; this tool does not create new scheduled tasks

Example: Manually triggering a scheduled task
{ "id": "task-1234" }`

export default {
	type: "function",
	function: {
		name: "run_scheduled_task_now",
		description: RUN_SCHEDULED_TASK_NOW_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The unique identifier of the scheduled task to trigger immediately",
				},
			},
			required: ["id"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

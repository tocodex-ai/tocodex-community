import type OpenAI from "openai"

const CANCEL_SCHEDULED_TASK_DESCRIPTION = `Permanently delete a scheduled task. This will also remove the task's run history. This operation cannot be undone.

Parameters:
- id: (required) The ID of the scheduled task to delete

Notes:
- Permanently deletes the scheduled task with the given ID
- Also deletes all run history associated with this task
- This operation is irreversible — deleted tasks and their histories cannot be recovered

Example: Deleting a scheduled task
{ "id": "task-abc123" }`

export default {
	type: "function",
	function: {
		name: "cancel_scheduled_task",
		description: CANCEL_SCHEDULED_TASK_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The ID of the scheduled task to delete",
				},
			},
			required: ["id"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

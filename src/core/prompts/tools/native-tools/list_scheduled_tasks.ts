import type OpenAI from "openai"

const LIST_SCHEDULED_TASKS_DESCRIPTION = `Request to list all scheduled tasks currently configured. Use this tool when you need to inspect, audit, or report on scheduled automation tasks.

Parameters:
- scope: (optional) Filter tasks by scope. One of "workspace" (only workspace-level tasks), "global" (only user/global-level tasks), "all" (both). Defaults to "all".
- enabled_only: (optional) When true, only return tasks whose enabled flag is true. Defaults to false (returns enabled and disabled tasks).

Notes:
- Returns a list of scheduled tasks, each containing fields such as id, name, trigger (cron expression or interval definition), mode (the mode/agent the task runs in), enabled (boolean), nextRunAt (ISO timestamp of the next scheduled execution, may be null when disabled), and lastRun (information about the most recent execution, may be null when never run).
- The scope filter helps narrow results when both workspace-specific and global tasks exist.
- The enabled_only filter is useful for showing only actionable, currently-active schedules.

Example: List all tasks across every scope
{ "scope": null, "enabled_only": null }

Example: List only enabled workspace tasks
{ "scope": "workspace", "enabled_only": true }

Example: List all global tasks (including disabled)
{ "scope": "global", "enabled_only": false }`

export default {
	type: "function",
	function: {
		name: "list_scheduled_tasks",
		description: LIST_SCHEDULED_TASKS_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				scope: {
					type: ["string", "null"],
					enum: ["workspace", "global", "all", null],
					description:
						'Filter tasks by scope: "workspace", "global", or "all". Defaults to "all" when null.',
				},
				enabled_only: {
					type: ["boolean", "null"],
					description: "When true, only return enabled tasks. Defaults to false when null.",
				},
			},
			required: ["scope", "enabled_only"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

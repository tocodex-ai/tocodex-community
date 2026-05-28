import type OpenAI from "openai"

const UPDATE_SCHEDULED_TASK_DESCRIPTION = `Update an existing scheduled task. Only provide the fields you want to modify; omitted fields remain unchanged.

Parameters:
- id: (required) The unique identifier of the task to update
- name: (optional) New display name for the task (1-200 characters)
- description: (optional) New description (max 1000 characters)
- trigger: (optional) New schedule trigger configuration. One of:
  - { "kind": "cron", "expression": "<cron>", "timezone": "<tz>" } — standard 5-field cron
  - { "kind": "interval", "intervalMs": <ms>, "startAt": <timestamp> } — repeat every N ms
  - { "kind": "once", "runAt": <timestamp> } — run once at a specific time
- mode: (optional) Mode slug to run the task in (e.g., "code", "architect")
- prompt: (optional) New prompt/instructions for the task (1-50000 characters)
- apiConfigName: (optional) API configuration profile name to use
- enabled: (optional) Set to false to pause the task, true to resume
- maxRuntimeMs: (optional) Maximum execution time in milliseconds before timeout
- concurrency: (optional) Policy when a new run triggers while previous is still running:
  - "skip" — skip the new run
  - "queue" — queue the new run
  - "cancel-previous" — cancel the running execution and start new
- notifyOn: (optional) Array of events to notify on: ["success"], ["failure"], or ["success", "failure"]

Notes:
- Use enabled: false to pause a task without deleting it
- Changes take effect immediately for future runs
- The task's next scheduled run time will be recalculated if trigger is updated

Example: Pause a task
{ "id": "abc-123", "enabled": false }

Example: Update schedule to run every hour
{ "id": "abc-123", "trigger": { "kind": "interval", "intervalMs": 3600000 } }

Example: Change prompt and mode
{ "id": "abc-123", "mode": "architect", "prompt": "Review and document the API changes" }`

export default {
	type: "function",
	function: {
		name: "update_scheduled_task",
		description: UPDATE_SCHEDULED_TASK_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The unique identifier of the scheduled task to update",
				},
				name: {
					type: ["string", "null"],
					description: "New display name for the task (1-200 characters)",
				},
				description: {
					type: ["string", "null"],
					description: "New description for the task (max 1000 characters)",
				},
				trigger: {
					type: ["object", "null"],
					description:
						'New schedule trigger. Must include "kind" field: "cron" (with expression, optional timezone), "interval" (with intervalMs, optional startAt), or "once" (with runAt timestamp)',
					properties: {
						kind: {
							type: "string",
							enum: ["cron", "interval", "once"],
							description: "Type of trigger",
						},
						expression: {
							type: "string",
							description: "Cron expression (for kind=cron)",
						},
						timezone: {
							type: "string",
							description: "Timezone for cron (for kind=cron)",
						},
						intervalMs: {
							type: "number",
							description: "Interval in milliseconds (for kind=interval)",
						},
						startAt: {
							type: "number",
							description: "Start timestamp in ms (for kind=interval)",
						},
						runAt: {
							type: "number",
							description: "Run-at timestamp in ms (for kind=once)",
						},
					},
					required: ["kind"],
					additionalProperties: false,
				},
				mode: {
					type: ["string", "null"],
					description: "Mode slug to run the task in (e.g., code, architect)",
				},
				prompt: {
					type: ["string", "null"],
					description: "New prompt/instructions for the task (1-50000 characters)",
				},
				apiConfigName: {
					type: ["string", "null"],
					description: "API configuration profile name to use",
				},
				enabled: {
					type: ["boolean", "null"],
					description: "Set to false to pause the task, true to resume",
				},
				maxRuntimeMs: {
					type: ["number", "null"],
					description: "Maximum execution time in milliseconds before timeout",
				},
				concurrency: {
					type: ["string", "null"],
					enum: ["skip", "queue", "cancel-previous", null],
					description:
						"Policy when a new run triggers while previous is still running: skip, queue, or cancel-previous",
				},
				notifyOn: {
					type: ["array", "null"],
					items: {
						type: "string",
						enum: ["success", "failure"],
					},
					description: 'Array of events to notify on: "success" and/or "failure"',
				},
			},
			required: [
				"id",
				"name",
				"description",
				"trigger",
				"mode",
				"prompt",
				"apiConfigName",
				"enabled",
				"maxRuntimeMs",
				"concurrency",
				"notifyOn",
			],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

import type OpenAI from "openai"

const DESCRIPTION = `Request to create a scheduled task. ToCodex will automatically execute the task at the specified time.

Parameters:
- name: (required) Task name, max 200 characters
- description: (optional) Task description, max 1000 characters
- trigger: (required) Trigger configuration, one of three types:
  - Cron: { "kind": "cron", "expression": "0 9 * * *", "timezone": "Asia/Shanghai" } - Standard cron expression
  - Interval: { "kind": "interval", "intervalMs": 3600000, "startAt": 1700000000000 } - Fixed interval in milliseconds
  - Once: { "kind": "once", "runAt": 1700000000000 } - Single execution at Unix timestamp (ms)
- mode: (required) Mode slug for task execution, e.g. "code", "ssh-server", "browser-worker"
- prompt: (required) The prompt to execute when the task runs, max 50000 characters
- apiConfigName: (optional) Provider profile name to use for the task
- scope: (optional) "workspace" or "global", defaults to "global" — global tasks survive switching projects and live in the extension global storage. Use "workspace" only when the task is strictly tied to the current project.
- maxRuntimeMs: (optional) Maximum runtime in milliseconds, defaults to 1800000 (30 minutes)
- concurrency: (optional) Policy when task overlaps: "skip" | "queue" | "cancel-previous", defaults to "skip"
- notifyOn: (optional) When to notify: array of "success" and/or "failure", defaults to ["failure"]

Notes:
- VS Code must be running for scheduled tasks to execute
- Tasks require user approval by default before execution
- Cron expressions use standard 5-field format (minute hour day month weekday)
- Minimum interval for interval triggers is 10 seconds (10000ms)
- Maximum 50 enabled tasks per scope

Example: Daily backup at 9 AM
{ "name": "Daily Backup", "description": "Backup important files", "trigger": { "kind": "cron", "expression": "0 9 * * *", "timezone": "Asia/Shanghai" }, "mode": "code", "prompt": "Backup the src directory to backup/", "apiConfigName": null, "scope": "workspace", "maxRuntimeMs": 1800000, "concurrency": "skip", "notifyOn": ["failure"] }

Example: Run once at specific time
{ "name": "Deploy Release", "description": null, "trigger": { "kind": "once", "runAt": 1700000000000 }, "mode": "ssh-server", "prompt": "Deploy the latest release to production", "apiConfigName": null, "scope": "workspace", "maxRuntimeMs": 1800000, "concurrency": "skip", "notifyOn": ["success", "failure"] }

Example: Check server health every hour
{ "name": "Health Check", "description": "Monitor server status", "trigger": { "kind": "interval", "intervalMs": 3600000 }, "mode": "ssh-server", "prompt": "Check if all services are running and report any issues", "apiConfigName": null, "scope": "global", "maxRuntimeMs": 300000, "concurrency": "skip", "notifyOn": ["failure"] }`

export default {
	type: "function",
	function: {
		name: "schedule_task",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Task name, max 200 characters",
				},
				description: {
					type: ["string", "null"],
					description: "Task description, max 1000 characters",
				},
				trigger: {
					type: "object",
					description:
						"Trigger configuration. Must include 'kind' field with value 'cron', 'interval', or 'once'",
					properties: {
						kind: {
							type: "string",
							enum: ["cron", "interval", "once"],
							description: "Trigger type",
						},
						expression: {
							type: "string",
							description: "Cron expression (required for kind='cron')",
						},
						timezone: {
							type: "string",
							description: "Timezone for cron expression (optional, e.g. 'Asia/Shanghai')",
						},
						intervalMs: {
							type: "number",
							description: "Interval in milliseconds (required for kind='interval')",
						},
						startAt: {
							type: "number",
							description: "Unix timestamp (ms) to start interval from (optional for kind='interval')",
						},
						runAt: {
							type: "number",
							description: "Unix timestamp (ms) to run at (required for kind='once')",
						},
					},
					required: ["kind"],
					additionalProperties: false,
				},
				mode: {
					type: "string",
					description: "Mode slug for task execution, e.g. 'code', 'ssh-server', 'browser-worker'",
				},
				prompt: {
					type: "string",
					description: "The prompt to execute when the task runs, max 50000 characters",
				},
				apiConfigName: {
					type: ["string", "null"],
					description: "Provider profile name to use for the task",
				},
				scope: {
					type: "string",
					enum: ["workspace", "global"],
					description: "Task scope, defaults to 'workspace'",
				},
				maxRuntimeMs: {
					type: ["number", "null"],
					description: "Maximum runtime in milliseconds, defaults to 1800000 (30 minutes)",
				},
				concurrency: {
					type: "string",
					enum: ["skip", "queue", "cancel-previous"],
					description: "Concurrency policy when task overlaps, defaults to 'skip'",
				},
				notifyOn: {
					type: "array",
					items: {
						type: "string",
						enum: ["success", "failure"],
					},
					description: "When to notify, defaults to ['failure']",
				},
			},
			required: [
				"name",
				"description",
				"trigger",
				"mode",
				"prompt",
				"apiConfigName",
				"scope",
				"maxRuntimeMs",
				"concurrency",
				"notifyOn",
			],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

/**
 * 返回 Tool Use Guidelines 段落。
 * 首轮返回完整指南，后续轮次返回精简版以节省 token。
 *
 * @param isFirstTurn - 是否为对话的首轮（默认 true，保持向后兼容）
 */
export function getToolUseGuidelinesSection(isFirstTurn: boolean = true): string {
	if (!isFirstTurn) {
		return `# Tool Use Guidelines

Choose the most appropriate tool for each step. Use multiple tools per message when appropriate. Each step must be informed by previous results — do not assume outcomes.`
	}

	return `# Tool Use Guidelines

1. Assess what information you already have and what information you need to proceed with the task.
2. Choose the most appropriate tool based on the task and the tool descriptions provided. Assess if you need additional information to proceed, and which of the available tools would be most effective for gathering this information. For example using the list_files tool is more effective than running a command like \`ls\` in the terminal. It's critical that you think about each available tool and use the one that best fits the current step in the task.
3. If multiple actions are needed, you may use multiple tools in a single message when appropriate, or use tools iteratively across messages. Each tool use should be informed by the results of previous tool uses. Do not assume the outcome of any tool use. Each step must be informed by the previous step's result.

By carefully considering the user's response after tool executions, you can react accordingly and make informed decisions about how to proceed with the task. This iterative process helps ensure the overall success and accuracy of your work.`
}

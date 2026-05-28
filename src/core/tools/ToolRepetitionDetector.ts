import stringify from "safe-stable-stringify"
import { ToolUse } from "../../shared/tools"
import { t } from "../../i18n"

/**
 * 从 ToolUse 中提取指定参数值，优先使用 nativeArgs，回退到 params。
 */
function getParam(toolUse: ToolUse, key: string): string | undefined {
	const native = toolUse.nativeArgs as Record<string, unknown> | undefined
	if (native && key in native) {
		const val = native[key]
		return val !== undefined && val !== null ? String(val) : undefined
	}
	return (toolUse.params as Record<string, string | undefined>)[key]
}

/**
 * Class for detecting consecutive identical tool calls
 * to prevent the AI from getting stuck in a loop.
 *
 * 支持两种检测模式：
 * 1. 精确匹配（原有逻辑）：序列化后完全相同
 * 2. 语义匹配（新增）：对特定工具做语义等价判断
 *    - read_file：同路径即视为重复（忽略行范围差异）
 *    - apply_diff / search_and_replace：同路径 + 同 diff/内容
 *    - execute_command：同命令字符串
 */
export class ToolRepetitionDetector {
	private previousToolCallJson: string | null = null
	private previousToolUse: ToolUse | null = null
	private consecutiveIdenticalToolCallCount: number = 0
	private consecutiveSemanticToolCallCount: number = 0
	private readonly consecutiveIdenticalToolCallLimit: number

	/**
	 * Creates a new ToolRepetitionDetector
	 * @param limit The maximum number of identical consecutive tool calls allowed
	 */
	constructor(limit: number = 3) {
		this.consecutiveIdenticalToolCallLimit = limit
	}

	/**
	 * Checks if the current tool call is identical to the previous one
	 * and determines if execution should be allowed.
	 *
	 * 检测顺序：先做精确匹配，再做语义匹配。
	 * 语义匹配的阈值固定为 2（第3次触发），与精确匹配独立计数。
	 *
	 * @param currentToolCallBlock ToolUse object representing the current tool call
	 * @returns Object indicating if execution is allowed and a message to show if not
	 */
	public check(currentToolCallBlock: ToolUse): {
		allowExecution: boolean
		askUser?: {
			messageKey: string
			messageDetail: string
		}
	} {
		// Serialize the block to a canonical JSON string for comparison
		const currentToolCallJson = this.serializeToolUse(currentToolCallBlock)

		// --- 精确匹配 ---
		if (this.previousToolCallJson === currentToolCallJson) {
			this.consecutiveIdenticalToolCallCount++
		} else {
			this.consecutiveIdenticalToolCallCount = 0
			this.previousToolCallJson = currentToolCallJson
		}

		// --- 语义匹配 ---
		if (this.previousToolUse !== null && this.isSemanticallyIdentical(this.previousToolUse, currentToolCallBlock)) {
			// 精确匹配已经计数的情况下不重复计数语义，避免双重触发
			if (this.previousToolCallJson !== currentToolCallJson) {
				this.consecutiveSemanticToolCallCount++
			}
		} else {
			this.consecutiveSemanticToolCallCount = 0
		}
		this.previousToolUse = currentToolCallBlock

		// --- 精确匹配限制检查 ---
		if (
			this.consecutiveIdenticalToolCallLimit > 0 &&
			this.consecutiveIdenticalToolCallCount >= this.consecutiveIdenticalToolCallLimit
		) {
			this.resetCounters()

			return {
				allowExecution: false,
				askUser: {
					messageKey: "mistake_limit_reached",
					messageDetail: t("tools:toolRepetitionLimitReached", { toolName: currentToolCallBlock.name }),
				},
			}
		}

		// --- 语义匹配限制检查（阈值固定为 2，即第3次调用触发） ---
		if (
			this.consecutiveIdenticalToolCallLimit > 0 &&
			this.consecutiveSemanticToolCallCount >= 2 &&
			// 只在语义匹配适用的工具上触发
			this.isSemanticDetectionApplicable(currentToolCallBlock)
		) {
			this.resetCounters()

			return {
				allowExecution: false,
				askUser: {
					messageKey: "mistake_limit_reached",
					messageDetail: t("tools:toolRepetitionLimitReached", { toolName: currentToolCallBlock.name }),
				},
			}
		}

		// Execution is allowed
		return { allowExecution: true }
	}

	/**
	 * 判断两个工具调用是否语义等价。
	 *
	 * 语义等价规则：
	 * - read_file：同文件路径即视为重复（忽略行范围、offset 等差异）
	 * - apply_diff：同路径 + 同 diff 内容
	 * - search_and_replace / edit / search_replace / edit_file：同路径 + 同替换内容
	 * - execute_command：同命令字符串
	 * - 其他工具：不做语义匹配（返回 false）
	 */
	public isSemanticallyIdentical(a: ToolUse, b: ToolUse): boolean {
		if (a.name !== b.name) {
			return false
		}

		switch (a.name) {
			case "read_file": {
				const pathA = getParam(a, "path")
				const pathB = getParam(b, "path")
				return pathA !== undefined && pathB !== undefined && pathA === pathB
			}

			case "apply_diff": {
				const pathA = getParam(a, "path")
				const pathB = getParam(b, "path")
				const diffA = getParam(a, "diff")
				const diffB = getParam(b, "diff")
				return pathA !== undefined && pathB !== undefined && pathA === pathB && diffA === diffB
			}

			case "search_and_replace":
			case "edit":
			case "search_replace":
			case "edit_file": {
				const pathA = getParam(a, "file_path") ?? getParam(a, "path")
				const pathB = getParam(b, "file_path") ?? getParam(b, "path")
				const oldA = getParam(a, "old_string")
				const oldB = getParam(b, "old_string")
				const newA = getParam(a, "new_string")
				const newB = getParam(b, "new_string")
				return pathA !== undefined && pathB !== undefined && pathA === pathB && oldA === oldB && newA === newB
			}

			case "execute_command": {
				const cmdA = getParam(a, "command")
				const cmdB = getParam(b, "command")
				return cmdA !== undefined && cmdB !== undefined && cmdA === cmdB
			}

			default:
				return false
		}
	}

	/**
	 * 判断工具是否适用语义检测
	 */
	private isSemanticDetectionApplicable(toolUse: ToolUse): boolean {
		return [
			"read_file",
			"apply_diff",
			"search_and_replace",
			"edit",
			"search_replace",
			"edit_file",
			"execute_command",
		].includes(toolUse.name)
	}

	/**
	 * 重置所有计数器
	 */
	private resetCounters(): void {
		this.consecutiveIdenticalToolCallCount = 0
		this.consecutiveSemanticToolCallCount = 0
		this.previousToolCallJson = null
		this.previousToolUse = null
	}

	/**
	 * Serializes a ToolUse object into a canonical JSON string for comparison
	 *
	 * @param toolUse The ToolUse object to serialize
	 * @returns JSON string representation of the tool use with sorted parameter keys
	 */
	private serializeToolUse(toolUse: ToolUse): string {
		const toolObject: Record<string, any> = {
			name: toolUse.name,
			params: toolUse.params,
		}

		// Only include nativeArgs if it has content
		if (toolUse.nativeArgs && Object.keys(toolUse.nativeArgs).length > 0) {
			toolObject.nativeArgs = toolUse.nativeArgs
		}

		return stringify(toolObject)
	}
}

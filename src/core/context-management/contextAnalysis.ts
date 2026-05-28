/**
 * 上下文健康度分析模块（后端版本 — 当前未被调用）
 *
 * 注意：前端 ContextHealthPanel 组件已自行实现了等价的分析逻辑，
 * 此模块的 analyzeContextHealth 函数目前没有任何调用方。
 * 保留此文件供未来后端驱动的健康度分析使用（如服务端 token 精确计算）。
 *
 * 分析当前对话上下文中各类内容的 token 占比，
 * 识别高占用工具结果、重复文件读取和大型输出，
 * 并生成优化建议。
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */

import type { ClineMessage } from "@roo-code/types"

// ---- 类型定义 ----

export interface ToolResultBreakdown {
	/** 工具名称 */
	toolName: string
	/** 相关文件路径（如有） */
	filePath?: string
	/** 估算字符数 */
	charCount: number
	/** 占总上下文的百分比 */
	percent: number
}

export interface RepeatedFileRead {
	/** 文件路径 */
	filePath: string
	/** 读取次数 */
	readCount: number
}

export interface ContextWarning {
	type: "high_usage" | "repeated_file" | "large_output"
	message: string
	/** 相关字符数 */
	charCount: number
	/** 占总上下文的百分比 */
	percent: number
}

export interface ContextSuggestion {
	type: "compress" | "cache" | "condense"
	message: string
	/** 关联的工具结果或文件 */
	target?: string
}

export interface ContextHealthReport {
	/** 总 token 数（由调用方传入） */
	totalTokens: number
	/** 上下文使用率百分比 */
	usagePercent: number
	/** 各类内容的字符数分布 */
	breakdown: {
		toolResults: ToolResultBreakdown[]
		systemPrompt: number
		conversation: number
	}
	/** 警告列表 */
	warnings: ContextWarning[]
	/** 优化建议列表 */
	suggestions: ContextSuggestion[]
}

// ---- 常量 ----

/** 单个工具结果占比超过此值时标记为"高占用" */
const HIGH_USAGE_THRESHOLD_PERCENT = 15

/** 同一文件读取超过此次数时建议使用缓存 */
const REPEATED_READ_THRESHOLD = 3

/** 单个工具结果超过此字符数时标记为"大型输出" */
const LARGE_OUTPUT_CHAR_THRESHOLD = 30_000

// ---- 核心分析函数 ----

/**
 * 从 ClineMessage 数组中提取工具调用相关信息。
 * 识别 tool 类型的 say 消息和 api_req_started 消息。
 */
export function extractToolResults(messages: ClineMessage[]): ToolResultBreakdown[] {
	const results: ToolResultBreakdown[] = []

	for (const msg of messages) {
		if (msg.type !== "say") continue

		// 处理 tool 类型消息 — text 中包含工具名和结果
		if (msg.say === "tool" && msg.text) {
			const toolName = parseToolName(msg.text)
			const filePath = parseFilePath(msg.text)
			const charCount = msg.text.length
			results.push({ toolName, filePath, charCount, percent: 0 })
		}

		// 处理命令输出
		if (msg.say === "command_output" && msg.text) {
			results.push({
				toolName: "execute_command",
				charCount: msg.text.length,
				percent: 0,
			})
		}
	}

	return results
}

/**
 * 从工具消息文本中解析工具名称。
 * 工具消息通常以 JSON 格式存储，包含 tool 字段。
 */
export function parseToolName(text: string): string {
	try {
		const parsed = JSON.parse(text)
		if (parsed && typeof parsed.tool === "string") {
			return parsed.tool
		}
	} catch {
		// 非 JSON 格式，尝试从文本中提取
	}

	// 回退：从文本开头提取工具名
	const match = text.match(/^(\w+)[\s:(]/)
	return match?.[1] ?? "unknown"
}

/**
 * 从工具消息文本中解析文件路径。
 */
export function parseFilePath(text: string): string | undefined {
	try {
		const parsed = JSON.parse(text)
		if (parsed && typeof parsed.path === "string") {
			return parsed.path
		}
	} catch {
		// 非 JSON 格式
	}

	// 回退：匹配常见文件路径模式
	const match = text.match(/(?:^|\s)((?:\/|\.\/|[a-zA-Z]:\\)[\w\-./\\]+\.\w+)/)
	return match?.[1]
}

/**
 * 检测重复文件读取。
 */
export function detectRepeatedFileReads(messages: ClineMessage[]): RepeatedFileRead[] {
	const fileReadCounts = new Map<string, number>()

	for (const msg of messages) {
		if (msg.type !== "say" || msg.say !== "tool" || !msg.text) continue

		try {
			const parsed = JSON.parse(msg.text)
			if (parsed?.tool === "read_file" && typeof parsed.path === "string") {
				const count = fileReadCounts.get(parsed.path) ?? 0
				fileReadCounts.set(parsed.path, count + 1)
			}
		} catch {
			// 忽略解析错误
		}
	}

	const repeated: RepeatedFileRead[] = []
	for (const [filePath, readCount] of fileReadCounts) {
		if (readCount >= REPEATED_READ_THRESHOLD) {
			repeated.push({ filePath, readCount })
		}
	}

	return repeated.sort((a, b) => b.readCount - a.readCount)
}

/**
 * 生成上下文健康度报告。
 *
 * @param messages - 当前对话的 ClineMessage 数组
 * @param totalTokens - 当前上下文总 token 数
 * @param contextWindow - 模型上下文窗口大小
 * @returns 上下文健康度报告
 */
export function analyzeContextHealth(
	messages: ClineMessage[],
	totalTokens: number,
	contextWindow: number,
): ContextHealthReport {
	const usagePercent = contextWindow > 0 ? (totalTokens / contextWindow) * 100 : 0

	// 提取工具结果
	const toolResults = extractToolResults(messages)

	// 计算总字符数用于百分比计算
	const totalChars = messages.reduce((sum, msg) => sum + (msg.text?.length ?? 0), 0)

	// 计算各工具结果的占比
	for (const result of toolResults) {
		result.percent = totalChars > 0 ? (result.charCount / totalChars) * 100 : 0
	}

	// 按占比降序排列
	toolResults.sort((a, b) => b.percent - a.percent)

	// 计算对话内容字符数（非工具结果的消息）
	let conversationChars = 0
	let systemPromptChars = 0

	for (const msg of messages) {
		if (!msg.text) continue
		if (msg.say === "tool" || msg.say === "command_output") continue
		if (msg.say === "api_req_started") {
			// api_req_started 包含系统提示的 token 信息
			systemPromptChars += msg.text.length
		} else {
			conversationChars += msg.text.length
		}
	}

	// 检测重复文件读取
	const repeatedReads = detectRepeatedFileReads(messages)

	// 生成警告
	const warnings: ContextWarning[] = []

	// 高占用工具结果警告
	for (const result of toolResults) {
		if (result.percent > HIGH_USAGE_THRESHOLD_PERCENT) {
			warnings.push({
				type: "high_usage",
				message: `工具 "${result.toolName}" 的结果占上下文 ${result.percent.toFixed(1)}%${result.filePath ? `（文件: ${result.filePath}）` : ""}`,
				charCount: result.charCount,
				percent: result.percent,
			})
		}
	}

	// 大型输出警告
	for (const result of toolResults) {
		if (result.charCount > LARGE_OUTPUT_CHAR_THRESHOLD) {
			warnings.push({
				type: "large_output",
				message: `工具 "${result.toolName}" 返回了 ${(result.charCount / 1000).toFixed(0)}K 字符的大型输出${result.filePath ? `（文件: ${result.filePath}）` : ""}`,
				charCount: result.charCount,
				percent: result.percent,
			})
		}
	}

	// 重复文件读取警告
	for (const read of repeatedReads) {
		const charCount = toolResults
			.filter((r) => r.filePath === read.filePath)
			.reduce((sum, r) => sum + r.charCount, 0)
		const percent = totalChars > 0 ? (charCount / totalChars) * 100 : 0

		warnings.push({
			type: "repeated_file",
			message: `文件 "${read.filePath}" 被读取了 ${read.readCount} 次`,
			charCount,
			percent,
		})
	}

	// 生成建议
	const suggestions: ContextSuggestion[] = []

	// 高占用工具结果 → 建议压缩
	for (const warning of warnings) {
		if (warning.type === "high_usage") {
			suggestions.push({
				type: "compress",
				message: `建议压缩高占用的工具结果以释放上下文空间`,
				target: warning.message,
			})
		}
	}

	// 重复文件读取 → 建议使用缓存
	for (const read of repeatedReads) {
		suggestions.push({
			type: "cache",
			message: `文件 "${read.filePath}" 被重复读取 ${read.readCount} 次，建议使用文件缓存`,
			target: read.filePath,
		})
	}

	// 使用率高 → 建议 condense
	if (usagePercent > 60) {
		suggestions.push({
			type: "condense",
			message: `上下文使用率已达 ${usagePercent.toFixed(0)}%，建议执行上下文压缩`,
		})
	}

	return {
		totalTokens,
		usagePercent,
		breakdown: {
			toolResults,
			systemPrompt: systemPromptChars,
			conversation: conversationChars,
		},
		warnings,
		suggestions,
	}
}

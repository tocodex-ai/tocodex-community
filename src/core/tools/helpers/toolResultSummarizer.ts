/**
 * ToolResultSummarizer — 工具结果智能摘要
 *
 * 当工具返回结果超过阈值时，自动截断并保留头部+尾部，
 * 避免大量内容占满 context window。
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5
 */

interface SummarizerConfig {
	/** 最大字符数，超过则触发摘要 */
	maxChars: number
	/** 保留头部行数 */
	keepHead: number
	/** 保留尾部行数 */
	keepTail: number
}

interface SummarizerResult {
	content: string
	wasSummarized: boolean
	originalLength: number
}

/** 各工具的摘要阈值配置 */
export const TOOL_THRESHOLDS: Record<string, SummarizerConfig> = {
	read_file: { maxChars: 50_000, keepHead: 50, keepTail: 50 },
	search_files: { maxChars: 30_000, keepHead: 30, keepTail: 30 },
	execute_command: { maxChars: 20_000, keepHead: 20, keepTail: 20 },
	web_fetch: { maxChars: 50_000, keepHead: 50, keepTail: 50 },
}

/**
 * 对工具结果进行智能摘要。
 * 如果结果超过阈值，保留头部和尾部行，中间用摘要标注替换。
 *
 * @param toolName 工具名称，用于查找阈值配置
 * @param result 工具返回的原始结果字符串
 * @param forceFullContent 是否强制返回完整内容（用户明确要求时）
 */
export function summarizeIfNeeded(toolName: string, result: string, forceFullContent = false): SummarizerResult {
	const originalLength = result.length
	const config = TOOL_THRESHOLDS[toolName]

	// 无配置或强制完整内容时直接返回
	if (!config || forceFullContent || originalLength <= config.maxChars) {
		return { content: result, wasSummarized: false, originalLength }
	}

	const lines = result.split("\n")
	const totalLines = lines.length

	// 行数不多时直接截断字符
	if (totalLines <= config.keepHead + config.keepTail + 5) {
		const truncated = result.slice(0, config.maxChars)
		const notice = `\n\n[已摘要，原始长度 ${originalLength} 字符，已截断至 ${config.maxChars} 字符]`
		return { content: truncated + notice, wasSummarized: true, originalLength }
	}

	const headLines = lines.slice(0, config.keepHead)
	const tailLines = lines.slice(-config.keepTail)
	const omittedLines = totalLines - config.keepHead - config.keepTail

	const content = [
		...headLines,
		``,
		`[已摘要，原始长度 ${originalLength} 字符，省略中间 ${omittedLines} 行]`,
		``,
		...tailLines,
	].join("\n")

	return { content, wasSummarized: true, originalLength }
}

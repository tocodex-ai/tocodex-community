/**
 * TokenBudgetParser — Token 预算自然语言解析
 *
 * 从用户消息中解析 token 预算指令，如 "+500k"、"+2M"、"use 1M tokens"。
 *
 * Requirements: 11.1, 11.5
 */

export interface TokenBudget {
	/** 解析出的 token 数量 */
	tokens: number
	/** 原始匹配文本，用于 UI 高亮 */
	raw: string
	/** 在消息中的起始位置 */
	position: number
}

/** 单位倍数映射 */
const UNIT_MULTIPLIERS: Record<string, number> = {
	k: 1_000,
	K: 1_000,
	m: 1_000_000,
	M: 1_000_000,
	b: 1_000_000_000,
	B: 1_000_000_000,
}

/**
 * 匹配模式列表（按优先级排序）：
 * 1. "use N[k/M/B] tokens" / "use N[k/M/B] token"
 * 2. "+N[k/M/B]"
 * 3. "N[k/M/B] tokens"
 */
const BUDGET_PATTERNS: RegExp[] = [
	/\buse\s+(\d+(?:\.\d+)?)\s*([kKmMbB])?\s*tokens?\b/i,
	/\+(\d+(?:\.\d+)?)\s*([kKmMbB])\b/,
	/\b(\d+(?:\.\d+)?)\s*([kKmMbB])\s*tokens?\b/i,
]

/**
 * 从消息中解析 token 预算。
 * 返回第一个匹配到的预算，或 null（未找到）。
 */
export function parseTokenBudget(message: string): TokenBudget | null {
	for (const pattern of BUDGET_PATTERNS) {
		const match = pattern.exec(message)
		if (!match) continue

		const numStr = match[1]
		const unit = match[2] ?? ""
		const num = parseFloat(numStr)

		if (isNaN(num) || num <= 0) continue

		const multiplier = UNIT_MULTIPLIERS[unit] ?? 1
		const tokens = Math.floor(num * multiplier)

		if (tokens <= 0) continue

		return {
			tokens,
			raw: match[0],
			position: match.index,
		}
	}

	return null
}

/**
 * 将消息中的预算关键词替换为高亮标记（用于前端渲染）。
 */
export function highlightBudgetInMessage(message: string, budget: TokenBudget): string {
	return message.slice(0, budget.position) + `**${budget.raw}**` + message.slice(budget.position + budget.raw.length)
}

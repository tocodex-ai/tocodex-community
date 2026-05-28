/**
 * CostTracker — 精细费用追踪
 *
 * 按模型分类追踪 input/output/cache token 和美元成本，
 * 支持预算警告（80%）和停止（100%）。
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

export interface ModelCost {
	modelId: string
	inputTokens: number
	outputTokens: number
	cacheReadTokens: number
	cacheWriteTokens: number
	costUSD: number
}

export interface TaskCostSummary {
	totalCostUSD: number
	byModel: Record<string, ModelCost>
	startTime: number
	duration: number
}

export interface TokenUsageForCost {
	inputTokens: number
	outputTokens: number
	cacheReadTokens?: number
	cacheWriteTokens?: number
}

export interface ModelPricing {
	/** 每百万 input token 的美元价格 */
	inputPricePerMToken: number
	/** 每百万 output token 的美元价格 */
	outputPricePerMToken: number
	/** 每百万 cache read token 的美元价格 */
	cacheReadPricePerMToken?: number
	/** 每百万 cache write token 的美元价格 */
	cacheWritePricePerMToken?: number
}

export type BudgetStatus = "ok" | "warning" | "exceeded"

export class CostTracker {
	private costs: Map<string, ModelCost> = new Map()
	private budgetUSD?: number
	private readonly startTime: number

	constructor(budgetUSD?: number) {
		this.budgetUSD = budgetUSD
		this.startTime = Date.now()
	}

	/**
	 * 记录一次 API 调用的费用
	 */
	recordApiCall(modelId: string, usage: TokenUsageForCost, pricing: ModelPricing): void {
		const existing = this.costs.get(modelId) ?? {
			modelId,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			costUSD: 0,
		}

		const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPricePerMToken
		const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPricePerMToken
		const cacheReadCost = ((usage.cacheReadTokens ?? 0) / 1_000_000) * (pricing.cacheReadPricePerMToken ?? 0)
		const cacheWriteCost = ((usage.cacheWriteTokens ?? 0) / 1_000_000) * (pricing.cacheWritePricePerMToken ?? 0)

		this.costs.set(modelId, {
			modelId,
			inputTokens: existing.inputTokens + usage.inputTokens,
			outputTokens: existing.outputTokens + usage.outputTokens,
			cacheReadTokens: existing.cacheReadTokens + (usage.cacheReadTokens ?? 0),
			cacheWriteTokens: existing.cacheWriteTokens + (usage.cacheWriteTokens ?? 0),
			costUSD: existing.costUSD + inputCost + outputCost + cacheReadCost + cacheWriteCost,
		})
	}

	/**
	 * 获取总费用（美元）
	 */
	getTotalCost(): number {
		let total = 0
		for (const cost of this.costs.values()) {
			total += cost.costUSD
		}
		return total
	}

	/**
	 * P2: 添加外部费用（如并行子任务的费用汇总到父任务）
	 */
	addExternalCost(costUSD: number, source: string): void {
		const existing = this.costs.get(source) ?? {
			modelId: source,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			costUSD: 0,
		}
		this.costs.set(source, {
			...existing,
			costUSD: existing.costUSD + costUSD,
		})
	}

	/**
	 * 获取完整费用摘要
	 */
	getSummary(): TaskCostSummary {
		const byModel: Record<string, ModelCost> = {}
		for (const [modelId, cost] of this.costs.entries()) {
			byModel[modelId] = { ...cost }
		}
		return {
			totalCostUSD: this.getTotalCost(),
			byModel,
			startTime: this.startTime,
			duration: Date.now() - this.startTime,
		}
	}

	/**
	 * 检查预算状态
	 */
	checkBudget(): BudgetStatus {
		if (!this.budgetUSD) return "ok"
		const total = this.getTotalCost()
		const ratio = total / this.budgetUSD
		if (ratio >= 1.0) return "exceeded"
		if (ratio >= 0.8) return "warning"
		return "ok"
	}

	/**
	 * 设置预算上限
	 */
	setBudget(budgetUSD: number): void {
		this.budgetUSD = budgetUSD
	}

	/**
	 * 重置追踪器
	 */
	reset(): void {
		this.costs.clear()
	}

	/**
	 * 格式化费用摘要为可读字符串
	 */
	formatSummary(): string {
		const summary = this.getSummary()
		const lines = [`总费用: $${summary.totalCostUSD.toFixed(4)}`]

		for (const [modelId, cost] of Object.entries(summary.byModel)) {
			lines.push(
				`  ${modelId}: $${cost.costUSD.toFixed(4)} ` +
					`(输入 ${cost.inputTokens}, 输出 ${cost.outputTokens}, ` +
					`缓存读 ${cost.cacheReadTokens}, 缓存写 ${cost.cacheWriteTokens})`,
			)
		}

		return lines.join("\n")
	}
}

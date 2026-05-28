/**
 * RetryStrategy — 分级错误恢复机制
 *
 * 对可重试错误自动重试，apply_diff 失败时降级到 write_to_file，
 * 重试耗尽后向用户展示清晰的失败摘要。
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

type RetryableErrorType = "diff_failed" | "file_not_found" | "syntax_error" | "permission_error"
type NonRetryableErrorType = "network_timeout" | "api_error" | "permission_denied" | "unknown"

interface RetryConfig {
	/** 最大重试次数，默认 2 */
	maxAttempts?: number
	/** 失败时的降级工具名（如 apply_diff → write_to_file） */
	fallbackTool?: string
}

interface AttemptRecord {
	attempt: number
	toolName: string
	error: string
	timestamp: number
}

interface RetryResult<T> {
	success: boolean
	value?: T
	attempts: AttemptRecord[]
	/** 所有重试耗尽后的摘要，用于展示给用户 */
	failureSummary?: string
	/** 是否使用了降级工具 */
	usedFallback?: boolean
}

/** 可重试错误的关键词匹配 */
const RETRYABLE_PATTERNS: Record<RetryableErrorType, RegExp[]> = {
	diff_failed: [/diff.*fail/i, /patch.*fail/i, /hunk.*fail/i, /apply.*fail/i],
	file_not_found: [/ENOENT/i, /no such file/i, /file not found/i],
	syntax_error: [/syntax error/i, /parse error/i, /unexpected token/i],
	permission_error: [/EACCES/i, /permission denied/i],
}

/** 不可重试错误的关键词匹配 */
const NON_RETRYABLE_PATTERNS: RegExp[] = [
	/network.*timeout/i,
	/ETIMEDOUT/i,
	/api.*error/i,
	/rate.*limit/i,
	/unauthorized/i,
	/forbidden/i,
]

export class RetryStrategy {
	private readonly defaultMaxAttempts = 2

	/**
	 * 分类错误类型
	 */
	classifyError(error: Error): RetryableErrorType | NonRetryableErrorType {
		const msg = error.message

		// 先检查不可重试
		for (const pattern of NON_RETRYABLE_PATTERNS) {
			if (pattern.test(msg)) return "unknown"
		}

		// 再检查可重试
		for (const [type, patterns] of Object.entries(RETRYABLE_PATTERNS) as [RetryableErrorType, RegExp[]][]) {
			for (const pattern of patterns) {
				if (pattern.test(msg)) return type
			}
		}

		return "unknown"
	}

	/**
	 * 判断错误是否可重试
	 */
	isRetryable(error: Error): boolean {
		const type = this.classifyError(error)
		return type !== "unknown" && type !== "network_timeout" && type !== "api_error" && type !== "permission_denied"
	}

	/**
	 * 构建重试失败摘要，展示给用户
	 */
	buildFailureSummary(attempts: AttemptRecord[]): string {
		const lines = [`重试 ${attempts.length} 次后仍然失败：`]
		for (const a of attempts) {
			lines.push(`  第 ${a.attempt} 次（${a.toolName}）：${a.error}`)
		}
		return lines.join("\n")
	}

	/**
	 * 带重试的工具执行
	 *
	 * @param toolName 工具名称
	 * @param execute 执行函数
	 * @param config 重试配置
	 */
	async executeWithRetry<T>(
		toolName: string,
		execute: (currentToolName: string) => Promise<T>,
		config: RetryConfig = {},
	): Promise<RetryResult<T>> {
		const maxAttempts = config.maxAttempts ?? this.defaultMaxAttempts
		const attempts: AttemptRecord[] = []
		let currentToolName = toolName
		let usedFallback = false

		for (let attempt = 1; attempt <= maxAttempts + 1; attempt++) {
			try {
				const value = await execute(currentToolName)
				return { success: true, value, attempts, usedFallback }
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error))
				attempts.push({
					attempt,
					toolName: currentToolName,
					error: err.message,
					timestamp: Date.now(),
				})

				// 最后一次尝试失败，不再重试
				if (attempt > maxAttempts) {
					break
				}

				// 检查是否可重试
				if (!this.isRetryable(err)) {
					break
				}

				// apply_diff 失败时第二次降级到 write_to_file
				if (currentToolName === "apply_diff" && config.fallbackTool && attempt === 1) {
					currentToolName = config.fallbackTool
					usedFallback = true
				}
			}
		}

		return {
			success: false,
			attempts,
			usedFallback,
			failureSummary: this.buildFailureSummary(attempts),
		}
	}
}

export const retryStrategy = new RetryStrategy()

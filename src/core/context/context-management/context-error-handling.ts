import { APIError } from "openai"

export function checkContextWindowExceededError(error: unknown): boolean {
	return (
		checkIsOpenAIContextWindowError(error) ||
		checkIsOpenRouterContextWindowError(error) ||
		checkIsAnthropicContextWindowError(error)
	)
}

function checkIsOpenRouterContextWindowError(error: unknown): boolean {
	try {
		if (!error || typeof error !== "object") {
			return false
		}

		// Use Record<string, any> for proper type narrowing
		const err = error as Record<string, any>
		const status = err.status ?? err.code ?? err.error?.status ?? err.response?.status
		const message: string = String(
			err.message || err.error?.message || err.error?.error?.message || err.body?.error?.message || "",
		)
		const errorCode: string = String(
			err.error?.code || err.error?.error?.code || err.body?.error?.code || err.code || "",
		)

		// 直接匹配已知的 error code（如 OpenAI 兼容 API 返回的 model_max_prompt_tokens_exceeded）
		const KNOWN_CONTEXT_ERROR_CODES = ["model_max_prompt_tokens_exceeded", "context_length_exceeded"] as const
		if (KNOWN_CONTEXT_ERROR_CODES.some((code) => errorCode === code)) {
			return true
		}

		// Known OpenAI/OpenRouter-style signal (code 400 and message includes "context length")
		const CONTEXT_ERROR_PATTERNS = [
			/\bcontext\s*(?:length|window)\b/i,
			/\bmaximum\s*context\b/i,
			/\b(?:input\s*)?tokens?.*exceed/i,
			/\btoo\s*many\s*tokens?\b/i,
			/\bprompt\s*(?:token|is)\s*(?:too\s*long|.*exceed)/i,
			/\bexceeds\s*(?:the\s*)?(?:\w+\s+)?(?:limit|maximum|context|token)/i,
			/\bexceeds\s+.*\blimit\b/i,
		] as const

		// 支持 status 为数字 400 或字符串 "400"（new-api / OpenAI 兼容后端两种格式均可）
		const isStatus400 = status === 400 || String(status) === "400"
		return isStatus400 && CONTEXT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
	} catch {
		return false
	}
}

// Docs: https://platform.openai.com/docs/guides/error-codes/api-errors
function checkIsOpenAIContextWindowError(error: unknown): boolean {
	try {
		// Check for LengthFinishReasonError
		if (error && typeof error === "object" && "name" in error && error.name === "LengthFinishReasonError") {
			return true
		}

		const KNOWN_CONTEXT_ERROR_SUBSTRINGS = ["token", "context length"] as const

		if (!error || !(error instanceof APIError)) {
			return false
		}

		// APIError.status 是 HTTP 状态码（number），APIError.code 可能是 string 错误码
		// 某些 OpenAI 兼容 API 的 code 是 "model_max_prompt_tokens_exceeded" 而非 "400"
		const isStatus400 =
			error.status === 400 ||
			error.code?.toString() === "400" ||
			error.code === "model_max_prompt_tokens_exceeded" ||
			error.code === "context_length_exceeded"

		return isStatus400 && KNOWN_CONTEXT_ERROR_SUBSTRINGS.some((substring) => error.message.includes(substring))
	} catch {
		return false
	}
}

function checkIsAnthropicContextWindowError(response: unknown): boolean {
	try {
		// Type guard to safely access properties
		if (!response || typeof response !== "object") {
			return false
		}

		// Use type assertions with proper checks
		const res = response as Record<string, any>

		// Check for Anthropic-specific error structure with more specific validation
		if (res.error?.error?.type === "invalid_request_error") {
			const message: string = String(res.error?.error?.message || "")

			// More specific patterns for context window errors
			const contextWindowPatterns = [
				/prompt is too long/i,
				/maximum.*tokens/i,
				/context.*too.*long/i,
				/exceeds.*context/i,
				/token.*limit/i,
				/context_length_exceeded/i,
				/max_tokens_to_sample/i,
			]

			// Additional check for Anthropic-specific error codes
			const errorCode = res.error?.error?.code
			if (errorCode === "context_length_exceeded" || errorCode === "invalid_request_error") {
				return contextWindowPatterns.some((pattern) => pattern.test(message))
			}

			return contextWindowPatterns.some((pattern) => pattern.test(message))
		}

		return false
	} catch {
		return false
	}
}

const CONTEXT_WINDOW_RESERVED_PERCENTAGE = 0.1

/**
 * Result of token distribution calculation
 */
export interface TokenDistributionResult {
	/**
	 * Percentage of context window used by current tokens (0-100)
	 */
	currentPercent: number

	/**
	 * Percentage of context window reserved as safety buffer (0-100)
	 */
	reservedPercent: number

	/**
	 * Percentage of context window still available (0-100)
	 */
	availablePercent: number

	/**
	 * Number of tokens reserved as safety buffer
	 */
	reservedForOutput: number

	/**
	 * Number of tokens still available in the context window
	 */
	availableSize: number
}

/**
 * Calculates distribution of tokens within the context window
 * This is used for visualizing the token distribution in the UI
 *
 * @param contextWindow The total size of the context window
 * @param contextTokens The number of tokens currently used
 * @param maxTokens API max output tokens, intentionally ignored for context reserve display
 * @returns Distribution of tokens with percentages and raw numbers
 */
export const calculateTokenDistribution = (
	contextWindow: number,
	contextTokens: number,
	reservedTokens?: number,
): TokenDistributionResult => {
	// Handle potential invalid inputs with positive fallbacks
	const safeContextWindow = Math.max(0, contextWindow)
	const safeContextTokens = Math.max(0, contextTokens)

	// Reserve the configured context-management safety buffer for all models.
	// API max output tokens still come from model metadata/provider APIs, but they are not used for UI reserve display.
	const reservedForOutput =
		reservedTokens !== undefined
			? Math.max(0, reservedTokens)
			: Math.ceil(safeContextWindow * CONTEXT_WINDOW_RESERVED_PERCENTAGE)

	// Calculate sizes directly without buffer display
	const availableSize = Math.max(0, safeContextWindow - safeContextTokens - reservedForOutput)

	// Calculate percentages - ensure they sum to exactly 100%
	// Use the ratio of each part to the total context window
	const total = safeContextTokens + reservedForOutput + availableSize

	// Safeguard against division by zero
	if (total <= 0) {
		return {
			currentPercent: 0,
			reservedPercent: 0,
			availablePercent: 0,
			reservedForOutput,
			availableSize,
		}
	}

	return {
		currentPercent: (safeContextTokens / total) * 100,
		reservedPercent: (reservedForOutput / total) * 100,
		availablePercent: (availableSize / total) * 100,
		reservedForOutput,
		availableSize,
	}
}

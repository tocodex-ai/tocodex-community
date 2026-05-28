import { Anthropic } from "@anthropic-ai/sdk"
import crypto from "crypto"

import { TelemetryService } from "@roo-code/telemetry"

import { ApiHandler, ApiHandlerCreateMessageMetadata } from "../../api"
import { MAX_CONDENSE_THRESHOLD, MIN_CONDENSE_THRESHOLD, summarizeConversation, SummarizeResponse } from "../condense"
import { ApiMessage } from "../task-persistence/apiMessages"
import { RooIgnoreController } from "../ignore/RooIgnoreController"
import { t } from "../../i18n"

/**
 * Context Management
 *
 * This module provides Context Management for conversations, combining:
 * - Intelligent condensation of prior messages when approaching configured thresholds
 * - Sliding window truncation as a fallback when necessary
 *
 * Behavior and exports are preserved exactly from the previous sliding-window implementation.
 */

/**
 * Default percentage of the context window to use as a buffer when deciding when to truncate.
 * Used by Context Management to determine when to trigger condensation or (fallback) sliding window truncation.
 */
export const TOKEN_BUFFER_PERCENTAGE = 0.1

/**
 * Counts tokens for user content using the provider's token counting implementation.
 *
 * @param {Array<Anthropic.Messages.ContentBlockParam>} content - The content to count tokens for
 * @param {ApiHandler} apiHandler - The API handler to use for token counting
 * @returns {Promise<number>} A promise resolving to the token count
 */
export async function estimateTokenCount(
	content: Array<Anthropic.Messages.ContentBlockParam>,
	apiHandler: ApiHandler,
): Promise<number> {
	if (!content || content.length === 0) return 0
	return apiHandler.countTokens(content)
}

/**
 * Result of truncation operation, includes the truncation ID for UI events.
 */
export type TruncationResult = {
	messages: ApiMessage[]
	truncationId: string
	messagesRemoved: number
}

/**
 * Estimates token count for a single ApiMessage using a fast heuristic.
 * Non-ASCII characters (e.g. Chinese) count as 2 tokens each; ASCII as 0.25.
 */
function estimateMessageTokens(msg: ApiMessage): number {
	const content = msg.content
	let text = ""
	if (typeof content === "string") {
		text = content
	} else if (Array.isArray(content)) {
		for (const block of content) {
			if (
				typeof block === "object" &&
				block !== null &&
				"text" in block &&
				typeof (block as any).text === "string"
			) {
				text += (block as any).text
			}
		}
	}
	let tokens = 0
	for (let i = 0; i < text.length; i++) {
		tokens += text.charCodeAt(i) > 127 ? 2 : 0.25
	}
	return Math.ceil(tokens) + 4 // +4 for role/overhead
}

/**
 * Truncates a conversation by tagging messages as hidden instead of removing them.
 *
 * The first message is always retained, and a specified fraction (rounded to an even number)
 * of messages from the beginning (excluding the first) is tagged with truncationParent.
 * A truncation marker is inserted to track where truncation occurred.
 *
 * This implements non-destructive sliding window truncation, allowing messages to be
 * restored if the user rewinds past the truncation point.
 *
 * @param {ApiMessage[]} messages - The conversation messages.
 * @param {number} fracToRemove - The fraction (between 0 and 1) of messages (excluding the first) to hide.
 * @param {string} taskId - The task ID for the conversation, used for telemetry
 * @returns {TruncationResult} Object containing the tagged messages, truncation ID, and count of messages removed.
 */
export function truncateConversation(messages: ApiMessage[], fracToRemove: number, taskId: string): TruncationResult {
	TelemetryService.instance.captureSlidingWindowTruncation(taskId)

	const truncationId = crypto.randomUUID()

	// Filter to only visible messages (those not already truncated)
	// We need to track original indices to correctly tag messages in the full array
	const visibleIndices: number[] = []
	messages.forEach((msg, index) => {
		if (!msg.truncationParent && !msg.isTruncationMarker) {
			visibleIndices.push(index)
		}
	})

	// Calculate how many visible messages to truncate (excluding first visible message)
	const visibleCount = visibleIndices.length
	const rawMessagesToRemove = Math.floor((visibleCount - 1) * fracToRemove)
	const messagesToRemove = rawMessagesToRemove - (rawMessagesToRemove % 2)

	if (messagesToRemove <= 0) {
		// Nothing to truncate
		return {
			messages,
			truncationId,
			messagesRemoved: 0,
		}
	}

	// Get the indices of visible messages to truncate (skip first visible, take next N)
	const indicesToTruncate = new Set(visibleIndices.slice(1, messagesToRemove + 1))

	// Tag messages that are being "truncated" (hidden from API calls)
	const taggedMessages = messages.map((msg, index) => {
		if (indicesToTruncate.has(index)) {
			return { ...msg, truncationParent: truncationId }
		}
		return msg
	})

	// Find the actual boundary - the index right after the last truncated message
	const lastTruncatedVisibleIndex = visibleIndices[messagesToRemove] // Last visible message being truncated
	// If all visible messages except the first are truncated, insert marker at the end
	const firstKeptVisibleIndex = visibleIndices[messagesToRemove + 1] ?? taggedMessages.length

	// Insert truncation marker at the actual boundary (between last truncated and first kept)
	const firstKeptTs = messages[firstKeptVisibleIndex]?.ts ?? Date.now()
	const truncationMarker: ApiMessage = {
		role: "user",
		content: `[Sliding window truncation: ${messagesToRemove} messages hidden to reduce context]`,
		ts: firstKeptTs - 1,
		isTruncationMarker: true,
		truncationId,
	}

	// Insert marker at the boundary position
	// Find where to insert: right before the first kept visible message
	const insertPosition = firstKeptVisibleIndex
	const result = [
		...taggedMessages.slice(0, insertPosition),
		truncationMarker,
		...taggedMessages.slice(insertPosition),
	]

	return {
		messages: result,
		truncationId,
		messagesRemoved: messagesToRemove,
	}
}

/**
 * Truncates a conversation by token budget instead of message count.
 *
 * Walks visible messages from the END (most recent) backwards, accumulating tokens.
 * Once cumulative tokens exceed `targetTokenBudget`, all earlier visible messages
 * (except the first, which we always keep) are tagged as truncated.
 *
 * This is more reliable than {@link truncateConversation} for super-large contexts
 * (e.g. a single message containing 3M tokens of pasted text), because it guarantees
 * the resulting context fits within the budget regardless of message count.
 *
 * @param messages - Conversation messages.
 * @param targetTokenBudget - Maximum total tokens allowed for kept messages.
 * @param taskId - Task ID for telemetry.
 * @returns TruncationResult with hidden tagged messages and a truncation marker.
 */
export function truncateConversationByTokens(
	messages: ApiMessage[],
	targetTokenBudget: number,
	taskId: string,
): TruncationResult {
	TelemetryService.instance.captureSlidingWindowTruncation(taskId)

	const truncationId = crypto.randomUUID()

	// Collect indices of currently visible messages
	const visibleIndices: number[] = []
	messages.forEach((msg, index) => {
		if (!msg.truncationParent && !msg.isTruncationMarker) {
			visibleIndices.push(index)
		}
	})

	const visibleCount = visibleIndices.length
	if (visibleCount <= 2) {
		// Nothing meaningful to truncate
		return { messages, truncationId, messagesRemoved: 0 }
	}

	// Walk visible messages from the most recent backwards.
	// Always keep the first visible message (task initialiser) AND the last few messages
	// that fit within the budget.
	const firstVisibleIdx = visibleIndices[0]
	let runningTokens = estimateMessageTokens(messages[firstVisibleIdx])
	const keepIndices = new Set<number>([firstVisibleIdx])
	let cutoffPosition = visibleCount // index in visibleIndices below which everything is truncated

	for (let i = visibleCount - 1; i >= 1; i--) {
		const realIdx = visibleIndices[i]
		const msgTokens = estimateMessageTokens(messages[realIdx])
		if (runningTokens + msgTokens > targetTokenBudget && keepIndices.size >= 2) {
			// Out of budget: stop here. Mark cutoff so messages before this index get hidden.
			cutoffPosition = i + 1
			break
		}
		runningTokens += msgTokens
		keepIndices.add(realIdx)
		cutoffPosition = i
	}

	// Pair-align: tool_use/tool_result must stay together. If we cut on an odd boundary
	// (cutting between a tool_use and its result), shift the cutoff one earlier.
	// Simplification: if the kept count is odd (excluding the first message), shift by one.
	const keptCountAfterFirst = visibleCount - cutoffPosition
	if (keptCountAfterFirst % 2 === 1 && cutoffPosition > 1) {
		cutoffPosition += 1
	}

	const indicesToTruncate = new Set<number>()
	for (let i = 1; i < cutoffPosition; i++) {
		indicesToTruncate.add(visibleIndices[i])
	}

	const messagesRemoved = indicesToTruncate.size
	if (messagesRemoved === 0) {
		// Even after walking, nothing was hidden — message tokens already fit
		return { messages, truncationId, messagesRemoved: 0 }
	}

	const taggedMessages = messages.map((msg, index) => {
		if (indicesToTruncate.has(index)) {
			return { ...msg, truncationParent: truncationId }
		}
		return msg
	})

	const firstKeptVisibleIndex = visibleIndices[cutoffPosition] ?? taggedMessages.length
	const firstKeptTs = messages[firstKeptVisibleIndex]?.ts ?? Date.now()
	const truncationMarker: ApiMessage = {
		role: "user",
		content: `[Sliding window truncation: ${messagesRemoved} messages hidden to reduce context (token-based)]`,
		ts: firstKeptTs - 1,
		isTruncationMarker: true,
		truncationId,
	}

	const insertPosition = firstKeptVisibleIndex
	const result = [
		...taggedMessages.slice(0, insertPosition),
		truncationMarker,
		...taggedMessages.slice(insertPosition),
	]

	return {
		messages: result,
		truncationId,
		messagesRemoved,
	}
}

/**
 * Options for checking if context management will likely run.
 * A subset of ContextManagementOptions with only the fields needed for threshold calculation.
 */
export type WillManageContextOptions = {
	totalTokens: number
	contextWindow: number
	maxTokens?: number | null
	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	profileThresholds: Record<string, number>
	currentProfileId: string
	lastMessageTokens: number
}

/**
 * Checks whether context management (condensation or truncation) will likely run based on current token usage.
 *
 * This is useful for showing UI indicators before `manageContext` is actually called,
 * without duplicating the threshold calculation logic.
 *
 * @param {WillManageContextOptions} options - The options for threshold calculation
 * @returns {boolean} True if context management will likely run, false otherwise
 */
export function willManageContext({
	totalTokens,
	contextWindow,
	maxTokens,
	autoCondenseContext,
	autoCondenseContextPercent,
	profileThresholds,
	currentProfileId,
	lastMessageTokens,
}: WillManageContextOptions): boolean {
	const prevContextTokens = totalTokens + lastMessageTokens

	if (!autoCondenseContext) {
		// When auto-condense is disabled, only truncation can occur.
		// Keep a hard 10% context-window safety buffer, without reserving the model's full max output tokens.
		const allowedTokens = contextWindow * (1 - TOKEN_BUFFER_PERCENTAGE)
		return prevContextTokens > allowedTokens
	}

	// Determine the effective threshold to use
	let effectiveThreshold = autoCondenseContextPercent
	const profileThreshold = profileThresholds[currentProfileId]
	if (profileThreshold !== undefined) {
		if (profileThreshold === -1) {
			effectiveThreshold = autoCondenseContextPercent
		} else if (profileThreshold >= MIN_CONDENSE_THRESHOLD && profileThreshold <= MAX_CONDENSE_THRESHOLD) {
			effectiveThreshold = profileThreshold
		}
		// Invalid values fall back to global setting (effectiveThreshold already set)
	}

	const allowedTokens = contextWindow * (effectiveThreshold / 100)
	const contextPercent = (100 * prevContextTokens) / contextWindow
	return contextPercent >= effectiveThreshold || prevContextTokens > allowedTokens
}

/**
 * Context Management: Conditionally manages the conversation context when approaching limits.
 *
 * Attempts intelligent condensation of prior messages when thresholds are reached.
 * Falls back to sliding window truncation if condensation is unavailable or fails.
 *
 * @param {ContextManagementOptions} options - The options for truncation/condensation
 * @returns {Promise<ApiMessage[]>} The original, condensed, or truncated conversation messages.
 */

export type ContextManagementOptions = {
	messages: ApiMessage[]
	totalTokens: number
	contextWindow: number
	maxTokens?: number | null
	apiHandler: ApiHandler
	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	systemPrompt: string
	taskId: string
	customCondensingPrompt?: string
	profileThresholds: Record<string, number>
	currentProfileId: string
	/** Optional metadata to pass through to the condensing API call (tools, taskId, etc.) */
	metadata?: ApiHandlerCreateMessageMetadata
	/** Optional environment details string to include in the condensed summary */
	environmentDetails?: string
	/** Optional array of file paths read by Roo during the task (will be folded via tree-sitter) */
	filesReadByRoo?: string[]
	/** Optional current working directory for resolving file paths (required if filesReadByRoo is provided) */
	cwd?: string
	/** Optional controller for file access validation */
	rooIgnoreController?: RooIgnoreController
}

export type ContextManagementResult = SummarizeResponse & {
	prevContextTokens: number
	truncationId?: string
	messagesRemoved?: number
	newContextTokensAfterTruncation?: number
}

/**
 * Conditionally manages conversation context (condense and fallback truncation).
 *
 * @param {ContextManagementOptions} options - The options for truncation/condensation
 * @returns {Promise<ApiMessage[]>} The original, condensed, or truncated conversation messages.
 */
export async function manageContext({
	messages,
	totalTokens,
	contextWindow,
	maxTokens,
	apiHandler,
	autoCondenseContext,
	autoCondenseContextPercent,
	systemPrompt,
	taskId,
	customCondensingPrompt,
	profileThresholds,
	currentProfileId,
	metadata,
	environmentDetails,
	filesReadByRoo,
	cwd,
	rooIgnoreController,
}: ContextManagementOptions): Promise<ContextManagementResult> {
	let error: string | undefined
	let errorDetails: string | undefined
	let cost = 0
	// Context management keeps a universal 10% context-window buffer.
	// maxTokens is still used by API request construction, but not by compression/truncation thresholds.

	// Estimate tokens for the last message (which is always a user message)
	const lastMessage = messages[messages.length - 1]
	const lastMessageContent = lastMessage.content
	const lastMessageTokens = Array.isArray(lastMessageContent)
		? await estimateTokenCount(lastMessageContent, apiHandler)
		: await estimateTokenCount([{ type: "text", text: lastMessageContent as string }], apiHandler)

	// Calculate total effective tokens (totalTokens never includes the last message)
	const prevContextTokens = totalTokens + lastMessageTokens

	// Determine the effective threshold to use
	let effectiveThreshold = autoCondenseContextPercent
	const profileThreshold = profileThresholds[currentProfileId]
	if (profileThreshold !== undefined) {
		if (profileThreshold === -1) {
			// Special case: -1 means inherit from global setting
			effectiveThreshold = autoCondenseContextPercent
		} else if (profileThreshold >= MIN_CONDENSE_THRESHOLD && profileThreshold <= MAX_CONDENSE_THRESHOLD) {
			// Valid custom threshold
			effectiveThreshold = profileThreshold
		} else {
			// Invalid threshold value, fall back to global setting
			console.warn(
				`Invalid profile threshold ${profileThreshold} for profile "${currentProfileId}". Using global default of ${autoCondenseContextPercent}%`,
			)
			effectiveThreshold = autoCondenseContextPercent
		}
	}
	// If no specific threshold is found for the profile, fall back to global setting

	// Calculate available tokens for conversation history.
	// Auto-condense follows the configured threshold; truncation-only mode keeps a hard 10% safety buffer.
	const allowedTokens = contextWindow * (autoCondenseContext ? effectiveThreshold / 100 : 1 - TOKEN_BUFFER_PERCENTAGE)

	let condensingWasAttempted = false

	if (autoCondenseContext) {
		const contextPercent = (100 * prevContextTokens) / contextWindow
		if (contextPercent >= effectiveThreshold || prevContextTokens > allowedTokens) {
			// Attempt to intelligently condense the context
			condensingWasAttempted = true
			const result = await summarizeConversation({
				messages,
				apiHandler,
				systemPrompt,
				taskId,
				isAutomaticTrigger: true,
				customCondensingPrompt,
				metadata,
				environmentDetails,
				filesReadByRoo,
				cwd,
				rooIgnoreController,
			})
			if (result.error) {
				error = result.error
				errorDetails = result.errorDetails
				cost = result.cost
			} else {
				return { ...result, prevContextTokens }
			}
		}
	}

	// Fall back to sliding window truncation if needed.
	// This runs when:
	// 1. Tokens exceed the hard limit (allowedTokens), OR
	// 2. Condensing was attempted but failed (e.g. HTTP error, not enough messages, etc.)
	//    — in this case we must truncate to prevent the context from growing unbounded
	//    and causing repeated failed condense attempts on every subsequent request.
	if (prevContextTokens > allowedTokens || condensingWasAttempted) {
		// Use token-based truncation: keep messages whose cumulative token count ≤ contextWindow * 0.6
		// This is more reliable than message-count-based truncation for super-large contexts
		// (e.g. 3M tokens with few messages would still overflow after a 50% message-count cut)
		const targetTokenBudget = Math.floor(contextWindow * 0.6)
		const truncationResult = truncateConversationByTokens(messages, targetTokenBudget, taskId)

		// If condense was attempted but failed, enrich the error message to inform the user
		// that the conversation history has been hard-truncated by token count.
		if (condensingWasAttempted && error) {
			error = t("common:errors.condense_failed_truncated")
		}

		// Calculate new context tokens after truncation by counting non-truncated messages
		// Messages with truncationParent are hidden, so we count only those without it
		const effectiveMessages = truncationResult.messages.filter(
			(msg) => !msg.truncationParent && !msg.isTruncationMarker,
		)

		// Include system prompt tokens so this value matches what we send to the API.
		// Note: `prevContextTokens` is computed locally here (totalTokens + lastMessageTokens).
		let newContextTokensAfterTruncation = await estimateTokenCount(
			[{ type: "text", text: systemPrompt }],
			apiHandler,
		)

		for (const msg of effectiveMessages) {
			const content = msg.content
			if (Array.isArray(content)) {
				newContextTokensAfterTruncation += await estimateTokenCount(content, apiHandler)
			} else if (typeof content === "string") {
				newContextTokensAfterTruncation += await estimateTokenCount(
					[{ type: "text", text: content }],
					apiHandler,
				)
			}
		}

		return {
			messages: truncationResult.messages,
			prevContextTokens,
			summary: "",
			cost,
			error,
			errorDetails,
			truncationId: truncationResult.truncationId,
			messagesRemoved: truncationResult.messagesRemoved,
			newContextTokensAfterTruncation,
		}
	}
	// No truncation or condensation needed
	return { messages, summary: "", cost, prevContextTokens, error, errorDetails }
}

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { rooDefaultModelId, getApiProtocol, type ImageGenerationApiMethod } from "@roo-code/types"
import { CloudService } from "@roo-code/cloud"

import { NativeToolCallParser } from "../../core/assistant-message/NativeToolCallParser"

import { Package } from "../../shared/package"
import type { ApiHandlerOptions } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import { convertToOpenAiMessages } from "../transform/openai-format"
import type { RooReasoningParams } from "../transform/reasoning"
import { getRooReasoning } from "../transform/reasoning"

import type { ApiHandlerCreateMessageMetadata } from "../index"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"
import { DEFAULT_TOCODEX_API_URL } from "./constants"
import { getModels, getModelsFromCache } from "../providers/fetchers/modelCache"
import { handleOpenAIError } from "./utils/openai-error-handler"
import { generateImageWithProvider, generateImageWithImagesApi, ImageGenerationResult } from "./utils/image-generation"
import { t } from "../../i18n"

// Extend OpenAI's CompletionUsage to include Roo specific fields
interface RooUsage extends OpenAI.CompletionUsage {
	cache_creation_input_tokens?: number
	cost?: number
}

// Add custom interface for Roo params to support reasoning
type RooChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParamsStreaming & {
	reasoning?: RooReasoningParams
}

function getSessionToken(): string {
	const token = CloudService.hasInstance() ? CloudService.instance.authService?.getSessionToken() : undefined
	return token ?? "unauthenticated"
}

export class RooHandler extends BaseOpenAiCompatibleProvider<string> {
	private fetcherBaseURL: string
	private currentReasoningDetails: any[] = []

	constructor(options: ApiHandlerOptions) {
		const sessionToken = options.rooApiKey ?? getSessionToken()

		let baseURL = DEFAULT_TOCODEX_API_URL

		// Ensure baseURL ends with /v1 for OpenAI client, but don't duplicate it
		if (!baseURL.endsWith("/v1")) {
			baseURL = `${baseURL}/v1`
		}

		// Always construct the handler, even without a valid token.
		// The provider-proxy server will return 401 if authentication fails.
		super({
			...options,
			providerName: "ToCodex",
			baseURL, // Already has /v1 suffix
			apiKey: sessionToken || "unauthenticated",
			defaultProviderModelId: rooDefaultModelId,
			providerModels: {},
		})

		// Load dynamic models asynchronously - strip /v1 from baseURL for fetcher
		this.fetcherBaseURL = baseURL.endsWith("/v1") ? baseURL.slice(0, -3) : baseURL

		// 无有效 key 时不在构造函数中立即加载模型（走 /api/pricing 数据量大）
		// 由 initializeModelCacheRefresh 延迟加载，或 webview requestRouterModels 触发
		const hasValidKey = sessionToken && sessionToken !== "unauthenticated"
		if (hasValidKey) {
			this.loadDynamicModels(this.fetcherBaseURL, sessionToken).catch((error) => {
				console.error("[RooHandler] Failed to load dynamic models:", error)
			})
		}
	}

	protected override createStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
		requestOptions?: OpenAI.RequestOptions,
	) {
		const { id: model, info } = this.getModel()

		// Get model parameters including reasoning
		const params = getModelParams({
			format: "openai",
			modelId: model,
			model: info,
			settings: this.options,
			defaultTemperature: this.defaultTemperature,
		})

		// Get Roo-specific reasoning parameters
		const reasoning = getRooReasoning({
			model: info,
			reasoningBudget: params.reasoningBudget,
			reasoningEffort: params.reasoningEffort,
			settings: this.options,
		})

		// ToCodex/Roo 提供商：采用与 OpenAI 兼容供应商相同的逻辑
		// 用户设置优先，否则直接使用模型接口返回的 maxTokens，不做额外 clamp
		// 后端（newapi）负责根据实际模型能力调整 max_tokens
		const max_tokens = this.options.modelMaxTokens || info.maxTokens || params.maxTokens
		const temperature = params.temperature ?? this.defaultTemperature

		const rooParams: RooChatCompletionParams = {
			model,
			max_tokens,
			temperature,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
			...(reasoning && { reasoning }),
			tools: this.convertToolsForOpenAI(metadata?.tools),
			tool_choice: metadata?.tool_choice,
		}

		try {
			const token = this.options.rooApiKey ?? getSessionToken()
			// 阶段 8.10 桌面壳诊断
			try {
				const fs = require("node:fs") as typeof import("node:fs")
				const path = require("node:path") as typeof import("node:path")
				const candidates = [
					path.join(path.dirname(process.execPath), "tocodex-diag-api.txt"),
					path.join(process.cwd(), "tocodex-diag-api.txt"),
				]
				for (const p of candidates) {
					try {
						fs.appendFileSync(
							p,
							`[${new Date().toISOString()}] [createStream] token=${!token ? "null" : token === "unauthenticated" ? "unauthenticated" : "present"}, baseURL=${this.client.baseURL}\n`,
						)
						break
					} catch {}
				}
			} catch {}
			if (!token || token === "unauthenticated") {
				const enhanced = new Error(
					"Please login or bind your API key first, or select a free model.\n请先登录或绑定 API Key，或选择免费模型。",
				)
				;(enhanced as any).status = 401
				throw enhanced
			}

			this.client.apiKey = token

			return this.client.chat.completions.create(rooParams, requestOptions)
		} catch (error) {
			if ((error as any)?.status === 401) {
				const enhanced = new Error(
					"Please login or bind your API key first, or select a free model.\n请先登录或绑定 API Key，或选择免费模型。",
				)
				;(enhanced as any).status = 401
				throw enhanced
			}

			throw handleOpenAIError(error, this.providerName)
		}
	}

	getReasoningDetails(): any[] | undefined {
		return this.currentReasoningDetails.length > 0 ? this.currentReasoningDetails : undefined
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// 阶段 8.10 桌面壳诊断：把每步实际状态写到 exe 同目录 tocodex-diag-api.txt
		const diagWrite = (line: string) => {
			try {
				const fs = require("node:fs") as typeof import("node:fs")
				const path = require("node:path") as typeof import("node:path")
				const candidates = [
					path.join(path.dirname(process.execPath), "tocodex-diag-api.txt"),
					path.join(process.cwd(), "tocodex-diag-api.txt"),
				]
				for (const p of candidates) {
					try {
						fs.appendFileSync(p, `[${new Date().toISOString()}] ${line}\n`)
						return
					} catch {}
				}
			} catch {}
		}
		try {
			// Reset reasoning_details accumulator for this request
			this.currentReasoningDetails = []

			const headers: Record<string, string> = {
				"X-Roo-App-Version": Package.version,
			}

			if (metadata?.taskId) {
				headers["X-Roo-Task-ID"] = metadata.taskId
			}

			const sessTok = getSessionToken()
			const optsKey = this.options.rooApiKey
			diagWrite(
				`[createMessage] model=${this.getModel().id}, taskId=${metadata?.taskId}, optsRooApiKey=${optsKey ? "present" : "missing"}, sessionToken=${sessTok && sessTok !== "unauthenticated" ? "present" : sessTok}, tools=${metadata?.tools?.length ?? 0}`,
			)
			console.log(
				`[Diag#RooHandler] createMessage model=${this.getModel().id}, hasKey=${!!(this.options.rooApiKey ?? getSessionToken())}, taskId=${metadata?.taskId}, tools=${metadata?.tools?.length ?? 0}`,
			)
			const stream = await this.createStream(systemPrompt, messages, metadata, { headers })
			diagWrite(`[createMessage] stream created taskId=${metadata?.taskId}`)
			console.log(`[Diag#RooHandler] stream created taskId=${metadata?.taskId}`)

			let lastUsage: RooUsage | undefined = undefined
			// Accumulator for reasoning_details FROM the API.
			// We preserve the original shape of reasoning_details to prevent malformed responses.
			const reasoningDetailsAccumulator = new Map<
				string,
				{
					type: string
					text?: string
					summary?: string
					data?: string
					id?: string | null
					format?: string
					signature?: string
					index: number
				}
			>()

			// Track whether we've yielded displayable text from reasoning_details.
			// When reasoning_details has displayable content (reasoning.text or reasoning.summary),
			// we skip yielding the top-level reasoning field to avoid duplicate display.
			let hasYieldedReasoningFromDetails = false

			let diagFirstChunkSeen = false
			for await (const chunk of stream) {
				if (!diagFirstChunkSeen) {
					diagFirstChunkSeen = true
					console.log(`[Diag#RooHandler] first chunk received taskId=${metadata?.taskId}`)
				}
				const delta = chunk.choices?.[0]?.delta
				const finishReason = chunk.choices?.[0]?.finish_reason

				if (delta) {
					// Handle reasoning_details array format (used by Gemini 3, Claude, OpenAI o-series, etc.)
					// See: https://openrouter.ai/docs/use-cases/reasoning-tokens#preserving-reasoning-blocks
					// Priority: Check for reasoning_details first, as it's the newer format
					const deltaWithReasoning = delta as typeof delta & {
						reasoning_details?: Array<{
							type: string
							text?: string
							summary?: string
							data?: string
							id?: string | null
							format?: string
							signature?: string
							index?: number
						}>
					}

					if (deltaWithReasoning.reasoning_details && Array.isArray(deltaWithReasoning.reasoning_details)) {
						for (const detail of deltaWithReasoning.reasoning_details) {
							const index = detail.index ?? 0
							// Use id as key when available to merge chunks that share the same reasoning block id
							// This ensures that reasoning.summary and reasoning.encrypted chunks with the same id
							// are merged into a single object, matching the provider's expected format
							const key = detail.id ?? `${detail.type}-${index}`
							const existing = reasoningDetailsAccumulator.get(key)

							if (existing) {
								// Accumulate text/summary/data for existing reasoning detail
								if (detail.text !== undefined) {
									existing.text = (existing.text || "") + detail.text
								}
								if (detail.summary !== undefined) {
									existing.summary = (existing.summary || "") + detail.summary
								}
								if (detail.data !== undefined) {
									existing.data = (existing.data || "") + detail.data
								}
								// Update other fields if provided
								// Note: Don't update type - keep original type (e.g., reasoning.summary)
								// even when encrypted data chunks arrive with type reasoning.encrypted
								if (detail.id !== undefined) existing.id = detail.id
								if (detail.format !== undefined) existing.format = detail.format
								if (detail.signature !== undefined) existing.signature = detail.signature
							} else {
								// Start new reasoning detail accumulation
								reasoningDetailsAccumulator.set(key, {
									type: detail.type,
									text: detail.text,
									summary: detail.summary,
									data: detail.data,
									id: detail.id,
									format: detail.format,
									signature: detail.signature,
									index,
								})
							}

							// Yield text for display (still fragmented for live streaming)
							// Only reasoning.text and reasoning.summary have displayable content
							// reasoning.encrypted is intentionally skipped as it contains redacted content
							let reasoningText: string | undefined
							if (detail.type === "reasoning.text" && typeof detail.text === "string") {
								reasoningText = detail.text
							} else if (detail.type === "reasoning.summary" && typeof detail.summary === "string") {
								reasoningText = detail.summary
							}

							if (reasoningText) {
								hasYieldedReasoningFromDetails = true
								yield { type: "reasoning", text: reasoningText }
							}
						}
					}

					// Handle top-level reasoning field for UI display.
					// Skip if we've already yielded from reasoning_details to avoid duplicate display.
					if ("reasoning" in delta && delta.reasoning && typeof delta.reasoning === "string") {
						if (!hasYieldedReasoningFromDetails) {
							yield { type: "reasoning", text: delta.reasoning }
						}
					} else if ("reasoning_content" in delta && typeof delta.reasoning_content === "string") {
						// Also check for reasoning_content for backward compatibility
						if (!hasYieldedReasoningFromDetails) {
							yield { type: "reasoning", text: delta.reasoning_content }
						}
					}

					// Emit raw tool call chunks - NativeToolCallParser handles state management
					if ("tool_calls" in delta && Array.isArray(delta.tool_calls)) {
						for (const toolCall of delta.tool_calls) {
							yield {
								type: "tool_call_partial",
								index: toolCall.index,
								id: toolCall.id,
								name: toolCall.function?.name,
								arguments: toolCall.function?.arguments,
							}
						}
					}

					if (delta.content) {
						yield {
							type: "text",
							text: delta.content,
						}
					}
				}

				if (finishReason) {
					const endEvents = NativeToolCallParser.processFinishReason(finishReason)
					for (const event of endEvents) {
						yield event
					}
				}

				if (chunk.usage) {
					lastUsage = chunk.usage as RooUsage
				}
			}

			// After streaming completes, store ONLY the reasoning_details we received from the API.
			if (reasoningDetailsAccumulator.size > 0) {
				this.currentReasoningDetails = Array.from(reasoningDetailsAccumulator.values())
			}

			if (lastUsage) {
				const model = this.getModel()
				// Normalize input tokens based on protocol expectations:
				// - OpenAI protocol expects TOTAL input tokens (cached + non-cached)
				// - Anthropic protocol expects NON-CACHED input tokens (caches passed separately)
				const modelId = model.id
				const apiProtocol = getApiProtocol("roo", modelId)

				const promptTokens = lastUsage.prompt_tokens || 0
				const cacheWrite = lastUsage.cache_creation_input_tokens || 0
				const cacheRead = lastUsage.prompt_tokens_details?.cached_tokens || 0
				const nonCached = Math.max(0, promptTokens - cacheWrite - cacheRead)

				const inputTokensForDownstream = apiProtocol === "anthropic" ? nonCached : promptTokens

				yield {
					type: "usage",
					inputTokens: inputTokensForDownstream,
					outputTokens: lastUsage.completion_tokens || 0,
					cacheWriteTokens: cacheWrite,
					cacheReadTokens: cacheRead,
					totalCost: lastUsage.cost ?? 0,
				}
			}
		} catch (error) {
			const status = (error as any)?.status

			// 401 错误时替换为统一的友好提示
			if (status === 401) {
				const enhanced = new Error(
					"Please login or bind your API key first, or select a free model.\n请先登录或绑定 API Key，或选择免费模型。",
				)
				;(enhanced as any).status = 401
				throw enhanced
			}

			// 403 余额不足时给出友好提示
			const originalMessage = error instanceof Error ? error.message : String(error)
			if (status === 403 && originalMessage.includes("预扣费额度失败")) {
				// 从错误消息中解析余额和预扣费金额：预扣费额度失败, 用户剩余额度: $X, 需要预扣费额度: $Y
				const remainMatch = originalMessage.match(/用户剩余额度[：:]\s*(\$[\d.]+)/)
				const needMatch = originalMessage.match(/需要预扣费额度[：:]\s*(\$[\d.]+)/)
				const remainStr = remainMatch ? remainMatch[1] : "未知"
				const needStr = needMatch ? needMatch[1] : "未知"

				const enhanced = new Error(
					`账户余额不足，无法完成本次请求。\n\n` +
						`当前账户余额: ${remainStr}\n` +
						`本次请求预扣费: ${needStr}\n\n` +
						`⚠️ 说明：平台在请求开始前会按"输入token数+最大输出token数"预扣费，请求完成后会退还多余部分。\n` +
						`若余额不足以覆盖预扣费，请求会被拒绝（即使实际消耗更少）。\n\n` +
						`💡 解决方法：\n` +
						`  1. 前往平台充值（确保余额 > ${needStr}）\n` +
						`  2. 选择价格更低的模型\n` +
						`  3. 选择免费模型（Free 标记）`,
				)
				;(enhanced as any).status = 403
				if (error instanceof Error) {
					enhanced.stack = error.stack
				}
				throw enhanced
			}

			// 网络断流 / 连接中断错误友好提示
			const isNetworkError =
				originalMessage.includes("terminated") ||
				originalMessage.includes("ECONNRESET") ||
				originalMessage.includes("socket hang up") ||
				originalMessage.includes("network error") ||
				originalMessage.includes("fetch failed") ||
				originalMessage.includes("Connection error")

			if (isNetworkError) {
				const enhanced = new Error(
					"网络连接中断，请求未能完成。\n\n" +
						"可能原因：网络不稳定或请求超时。\n" +
						"建议：稍后重试，或检查网络连接。",
				)
				;(enhanced as any).status = (error as any)?.status
				if (error instanceof Error) {
					enhanced.stack = error.stack
				}
				throw enhanced
			}

			throw error
		}
	}
	override async completePrompt(prompt: string): Promise<string> {
		const token = this.options.rooApiKey ?? getSessionToken()
		this.client.apiKey = token

		const { id: modelId } = this.getModel()

		const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
			model: modelId,
			messages: [{ role: "user", content: prompt }],
		}

		const response = await this.client.chat.completions.create(params)

		return response.choices?.[0]?.message.content || ""
	}

	private async loadDynamicModels(baseURL: string, apiKey?: string): Promise<void> {
		try {
			await getModels({
				provider: "roo",
				baseUrl: baseURL,
				apiKey,
			})
		} catch (error) {
			console.warn(
				"[RooHandler] Failed to load dynamic models:",
				error instanceof Error ? error.message : String(error),
			)
		}
	}

	override getModel() {
		const models = getModelsFromCache("roo") || {}
		// 优先使用用户配置的模型，否则取模型列表第1个，最后回退到 rooDefaultModelId
		const sortedModelIds = Object.keys(models).sort()
		const effectiveDefault = sortedModelIds[0] ?? rooDefaultModelId
		const modelId = this.options.apiModelId || effectiveDefault
		const modelInfo = models[modelId]

		if (modelInfo) {
			return { id: modelId, info: { ...modelInfo, supportsImages: modelInfo.supportsImages ?? true } }
		}

		// Return the requested model ID even if not found, with fallback info.
		const fallbackInfo = {
			maxTokens: 16_384,
			contextWindow: 262_144,
			supportsImages: true,
			supportsReasoningEffort: false,
			supportsPromptCache: true,
			inputPrice: 0,
			outputPrice: 0,
			isFree: false,
		}

		return {
			id: modelId,
			info: fallbackInfo,
		}
	}

	/**
	 * Generate an image using Roo Code Cloud's image generation API
	 * @param prompt The text prompt for image generation
	 * @param model The model to use for generation
	 * @param inputImage Optional base64 encoded input image data URL
	 * @param apiMethod The API method to use (chat_completions or images_api)
	 * @param size Optional image size (e.g. "1024x1024")
	 * @returns The generated image data and format, or an error
	 */
	async generateImage(
		prompt: string,
		model: string,
		inputImage?: string,
		apiMethod?: ImageGenerationApiMethod,
		size?: string,
	): Promise<ImageGenerationResult> {
		const sessionToken = this.options.rooApiKey ?? getSessionToken()

		if (!sessionToken || sessionToken === "unauthenticated") {
			return {
				success: false,
				error: t("tools:generateImage.roo.authRequired"),
			}
		}

		const baseURL = `${this.fetcherBaseURL}/v1`
		// 生图端点使用独立域名（不走 CF，避免超时）
		const imgBaseURL = ""

		// Use the specified API method, defaulting to chat_completions for backward compatibility
		if (apiMethod === "images_api") {
			return generateImageWithImagesApi({
				baseURL: imgBaseURL,
				authToken: sessionToken,
				model,
				prompt,
				inputImage,
				size,
				outputFormat: "png",
			})
		}

		// Default to chat completions approach（也走独立生图域名，避免 CF 超时）
		return generateImageWithProvider({
			baseURL: imgBaseURL,
			authToken: sessionToken,
			model,
			prompt,
			inputImage,
			size,
		})
	}
}

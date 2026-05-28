import { t } from "../../../i18n"
import { Agent } from "undici"

// Image generation types
// content parts 元素类型（gpt-5.5 等多模态模型返回）
interface ContentPart {
	type?: string
	text?: string
	image_url?: {
		url?: string
	}
}

interface ImageGenerationResponse {
	choices?: Array<{
		message?: {
			content?: string | ContentPart[]
			images?: Array<{
				type?: string
				image_url?: {
					url?: string
				}
			}>
		}
	}>
	error?: {
		message?: string
		type?: string
		code?: string
	}
}

interface ImagesApiResponse {
	data?: Array<{
		b64_json?: string
		url?: string
	}>
	error?: {
		message?: string
		type?: string
		code?: string
	}
}

export interface ImageGenerationResult {
	success: boolean
	imageData?: string
	imageFormat?: string
	error?: string
}

interface ImageGenerationOptions {
	baseURL: string
	authToken: string
	model: string
	prompt: string
	inputImage?: string
	size?: string
	extraHeaders?: Record<string, string>
}

interface ImagesApiOptions {
	baseURL: string
	authToken: string
	model: string
	prompt: string
	inputImage?: string
	size?: string
	quality?: string
	outputFormat?: string
	extraHeaders?: Record<string, string>
}

/**
 * 判断模型是否需要使用流式请求。
 * gpt-image-2 生成耗时 50-140 秒，非流式会触发 Cloudflare 100 秒超时（524 错误），
 * 因此必须使用 stream: true 让服务端发送心跳保持连接活跃。
 * 其他模型（如 gpt-5.5、claude 系列）生成较快，不需要流式且部分上游不支持。
 */
function shouldUseStreaming(model: string): boolean {
	const streamingModels = ["gpt-image-2", "gpt-5.5"]
	return streamingModels.some((m) => model.includes(m))
}

/**
 * Shared image generation implementation for OpenRouter and ToCodex providers
 */
export async function generateImageWithProvider(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
	const { baseURL, authToken, model, prompt, inputImage, size, extraHeaders } = options
	const useStreaming = shouldUseStreaming(model)

	try {
		const requestBody: Record<string, unknown> = {
			model,
			messages: [
				{
					role: "user",
					content: inputImage
						? [
								{
									type: "text",
									text: prompt,
								},
								{
									type: "image_url",
									image_url: {
										url: inputImage,
									},
								},
							]
						: prompt,
				},
			],
			modalities: ["image", "text"],
			...(size ? { size } : {}),
		}

		// 仅对需要的模型启用流式，避免破坏不支持流式的上游
		if (useStreaming) {
			requestBody.stream = true
		}

		// 生图 chat completions 路径同样可能耗时数百秒。
		// undici（Node fetch 底层）headersTimeout 默认 300s，会在 ~300s 抛 HeadersTimeoutError（fetch failed）。
		// 必须通过 undici Agent 显式覆盖 headersTimeout/bodyTimeout，否则 AbortSignal.timeout 无效。
		const IMAGE_TIMEOUT_MS = 660_000 // 比 nginx proxy_read_timeout 600s 稍大，让超时由 nginx 控制
		const imageAgent = new Agent({ headersTimeout: IMAGE_TIMEOUT_MS, bodyTimeout: IMAGE_TIMEOUT_MS })
		const response = await fetch(`${baseURL}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${authToken}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://ruteapi.com",
				"X-Title": "tocodex-Community",
				...extraHeaders,
			},
			body: JSON.stringify(requestBody),
			signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
			// @ts-ignore — undici dispatcher，Node 18+ 原生 fetch 支持
			dispatcher: imageAgent,
		})

		if (!response.ok) {
			const errorText = await response.text()
			let errorMessage = t("tools:generateImage.failedWithStatus", {
				status: response.status,
				statusText: response.statusText,
			})

			try {
				const errorJson = JSON.parse(errorText)
				if (errorJson.error?.message) {
					errorMessage = t("tools:generateImage.failedWithMessage", {
						message: errorJson.error.message,
					})
				}
			} catch {
				// Use default error message
			}

			// 502/524 通常是网络超时（如 Cloudflare 超时），提示用户降低分辨率
			if (response.status === 502 || response.status === 524) {
				errorMessage +=
					"\n\n" +
					t("tools:generateImage.timeoutHint", {
						defaultValue:
							"This may be caused by a network timeout. High-resolution images (e.g. 4K) take longer to generate and may exceed the timeout limit. Please try reducing the image resolution (e.g. use 1024x1024 instead of 4096x4096).",
					})
			}

			return {
				success: false,
				error: errorMessage,
			}
		}

		if (useStreaming) {
			// 流式模式：解析 SSE 响应，累积所有 delta 数据
			const assembled = await parseStreamingImageResponse(response)

			if (assembled.error) {
				return {
					success: false,
					error: t("tools:generateImage.failedWithMessage", {
						message: assembled.error,
					}),
				}
			}

			// 从累积的流式数据中提取图片
			return extractImageFromResponse(assembled.images, assembled.content)
		} else {
			// 非流式模式：直接解析 JSON 响应
			const data: ImageGenerationResponse = await response.json()

			if (data.error) {
				return {
					success: false,
					error: t("tools:generateImage.failedWithMessage", {
						message: data.error.message || JSON.stringify(data.error),
					}),
				}
			}

			const message = data.choices?.[0]?.message
			if (!message) {
				return {
					success: false,
					error: t("tools:generateImage.noImageGenerated"),
				}
			}

			// 处理 content 可能是 content parts 数组的情况（gpt-5.5 多模态输出）
			let images = message.images || []
			let content = ""
			if (message.content) {
				if (typeof message.content === "string") {
					content = message.content
				} else if (Array.isArray(message.content)) {
					for (const part of message.content) {
						if (part.type === "text" && part.text) {
							content += part.text
						} else if ((part.type === "output_image" || part.type === "image_url") && part.image_url?.url) {
							images = [
								...images,
								{
									type: part.type,
									image_url: { url: part.image_url.url },
								},
							]
						}
					}
				}
			}

			return extractImageFromResponse(images, content)
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}

/**
 * 解析 SSE 流式响应，累积图片和文本数据。
 * 流式图片生成的 SSE 格式：
 *   data: {"choices":[{"delta":{"content":"..."}}]}\n\n
 *   data: {"choices":[{"delta":{"images":[...]}}]}\n\n  (部分服务端)
 *   data: [DONE]\n\n
 *
 * 对于图片生成，服务端通常在最终 chunk 中一次性返回完整的图片数据。
 */
async function parseStreamingImageResponse(response: Response): Promise<{
	images: Array<{ type?: string; image_url?: { url?: string } }>
	content: string
	error?: string
}> {
	const result = {
		images: [] as Array<{ type?: string; image_url?: { url?: string } }>,
		content: "",
		error: undefined as string | undefined,
	}

	if (!response.body) {
		result.error = "Response body is empty"
		return result
	}

	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ""

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })

			// 处理 buffer 中的完整 SSE 行
			const lines = buffer.split("\n")
			// 保留最后一个可能不完整的行
			buffer = lines.pop() || ""

			for (const line of lines) {
				const trimmed = line.trim()
				if (!trimmed || trimmed.startsWith(":")) {
					// 空行或注释（心跳），跳过
					continue
				}

				if (trimmed === "data: [DONE]") {
					// 流结束
					continue
				}

				if (trimmed.startsWith("data: ")) {
					const jsonStr = trimmed.slice(6)
					try {
						const chunk = JSON.parse(jsonStr)

						// 检查错误
						if (chunk.error) {
							result.error = chunk.error.message || JSON.stringify(chunk.error)
							return result
						}

						const delta = chunk.choices?.[0]?.delta

						if (delta) {
							// 累积文本内容和图片
							if (delta.content) {
								if (typeof delta.content === "string") {
									result.content += delta.content
								} else if (Array.isArray(delta.content)) {
									// gpt-5.5 multimodal output: content 是 content parts 数组
									// [{"type": "output_image", "image_url": {"url": "data:..."}}, {"type": "text", "text": "..."}]
									for (const part of delta.content) {
										if (part.type === "text" && part.text) {
											result.content += part.text
										} else if (
											(part.type === "output_image" || part.type === "image_url") &&
											part.image_url?.url
										) {
											result.images.push({
												type: part.type,
												image_url: { url: part.image_url.url },
											})
										}
									}
								}
							}

							// 累积图片数据 (部分服务端在 delta 中返回 images)
							if (delta.images && Array.isArray(delta.images)) {
								result.images.push(...delta.images)
							}
						}

						// 某些服务端在 choices[0].message 中返回完整数据（非标准但兼容）
						const message = chunk.choices?.[0]?.message
						if (message) {
							if (message.content) {
								if (typeof message.content === "string") {
									result.content += message.content
								} else if (Array.isArray(message.content)) {
									for (const part of message.content) {
										if (part.type === "text" && part.text) {
											result.content += part.text
										} else if (
											(part.type === "output_image" || part.type === "image_url") &&
											part.image_url?.url
										) {
											result.images.push({
												type: part.type,
												image_url: { url: part.image_url.url },
											})
										}
									}
								}
							}
							if (message.images && Array.isArray(message.images)) {
								result.images.push(...message.images)
							}
						}
					} catch {
						// 无法解析的 JSON chunk，跳过
					}
				}
			}
		}

		// 处理 buffer 中剩余的数据
		if (buffer.trim()) {
			const trimmed = buffer.trim()
			if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
				try {
					const chunk = JSON.parse(trimmed.slice(6))
					if (chunk.error) {
						result.error = chunk.error.message || JSON.stringify(chunk.error)
					}
					const delta = chunk.choices?.[0]?.delta
					if (delta?.content) {
						if (typeof delta.content === "string") {
							result.content += delta.content
						} else if (Array.isArray(delta.content)) {
							for (const part of delta.content) {
								if (part.type === "text" && part.text) {
									result.content += part.text
								} else if (
									(part.type === "output_image" || part.type === "image_url") &&
									part.image_url?.url
								) {
									result.images.push({
										type: part.type,
										image_url: { url: part.image_url.url },
									})
								}
							}
						}
					}
					if (delta?.images) result.images.push(...delta.images)
					const message = chunk.choices?.[0]?.message
					if (message?.content) {
						if (typeof message.content === "string") {
							result.content += message.content
						} else if (Array.isArray(message.content)) {
							for (const part of message.content) {
								if (part.type === "text" && part.text) {
									result.content += part.text
								} else if (
									(part.type === "output_image" || part.type === "image_url") &&
									part.image_url?.url
								) {
									result.images.push({
										type: part.type,
										image_url: { url: part.image_url.url },
									})
								}
							}
						}
					}
					if (message?.images) result.images.push(...message.images)
				} catch {
					// 忽略
				}
			}
		}
	} finally {
		reader.releaseLock()
	}

	return result
}

/**
 * 从响应数据中提取图片。
 * 复用格式 A（images 数组 base64）和格式 B（content 中的图片 URL）的处理逻辑。
 */
async function extractImageFromResponse(
	images: Array<{ type?: string; image_url?: { url?: string } }>,
	content: string,
): Promise<ImageGenerationResult> {
	if (images && images.length > 0) {
		// 格式A: images 数组 (base64 data URL)
		const imageData = images[0]?.image_url?.url
		if (!imageData) {
			return {
				success: false,
				error: t("tools:generateImage.invalidImageData"),
			}
		}

		// Extract base64 data from data URL
		const base64Match = imageData.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/)
		if (!base64Match) {
			return {
				success: false,
				error: t("tools:generateImage.invalidImageFormat"),
			}
		}

		return {
			success: true,
			imageData: imageData,
			imageFormat: base64Match[1],
		}
	}

	if (content) {
		// 格式B: content 中包含图片 URL (Markdown 格式或直接 URL)
		const urlMatch =
			content.match(/!\[.*?\]\((https?:\/\/[^\s)]+\.(?:png|jpg|jpeg|gif|webp))\)/i) ||
			content.match(/(https?:\/\/[^\s"']+\.(?:png|jpg|jpeg|gif|webp))/i)

		if (urlMatch && urlMatch[1]) {
			try {
				// 下载图片并转成 base64（已生成完成的图片下载，60s 兜底防挂死）
				const imgResponse = await fetch(urlMatch[1], {
					signal: AbortSignal.timeout(60_000),
				})
				if (!imgResponse.ok) {
					return {
						success: false,
						error: t("tools:generateImage.failedWithMessage", {
							message: `Failed to download image: ${imgResponse.status}`,
						}),
					}
				}
				const imgBuffer = await imgResponse.arrayBuffer()
				const imgBase64 = Buffer.from(imgBuffer).toString("base64")

				// 从 Content-Type 或 URL 推断格式
				const contentType = imgResponse.headers.get("content-type") || ""
				let imgFormat = "png"
				if (contentType.includes("jpeg") || contentType.includes("jpg")) {
					imgFormat = "jpeg"
				} else if (contentType.includes("webp")) {
					imgFormat = "webp"
				} else if (contentType.includes("gif")) {
					imgFormat = "gif"
				} else {
					// 从 URL 推断
					const extMatch = urlMatch[1].match(/\.(png|jpg|jpeg|gif|webp)$/i)
					if (extMatch) {
						imgFormat = extMatch[1].toLowerCase()
						if (imgFormat === "jpg") imgFormat = "jpeg"
					}
				}

				const dataUrl = `data:image/${imgFormat};base64,${imgBase64}`
				return {
					success: true,
					imageData: dataUrl,
					imageFormat: imgFormat,
				}
			} catch (downloadError) {
				return {
					success: false,
					error: t("tools:generateImage.failedWithMessage", {
						message: `Failed to download image from URL: ${downloadError instanceof Error ? downloadError.message : "unknown error"}`,
					}),
				}
			}
		}
	}

	return {
		success: false,
		error: t("tools:generateImage.noImageGenerated"),
	}
}

/**
 * Generate an image using OpenAI's Images API (/v1/images/generations)
 * When inputImage is provided (for non-BFL models), uses /v1/images/edits with multipart/form-data
 * Supports BFL models (Flux) with provider-specific options for image editing
 */
export async function generateImageWithImagesApi(options: ImagesApiOptions): Promise<ImageGenerationResult> {
	const { baseURL, authToken, model, prompt, inputImage, outputFormat = "png" } = options

	try {
		// When inputImage is provided and not a BFL model, use /v1/images/edits endpoint
		// This is the OpenAI standard for image editing (multipart/form-data)
		const useEditsEndpoint = !!inputImage && !model.startsWith("bfl/")
		const url = useEditsEndpoint ? `${baseURL}/images/edits` : `${baseURL}/images/generations`

		let fetchOptions: RequestInit

		if (useEditsEndpoint) {
			// Image editing: use multipart/form-data (OpenAI /v1/images/edits standard)
			const formData = new FormData()
			formData.append("model", model)
			formData.append("prompt", prompt)
			formData.append("n", "1")
			if (options.size) {
				formData.append("size", options.size)
			}
			if (options.quality) {
				formData.append("quality", options.quality)
			}

			// Convert base64 data URL to Blob and append as file
			// inputImage format: "data:image/png;base64,iVBOR..."
			const base64Match = inputImage!.match(/^data:image\/(\w+);base64,(.+)$/)
			if (base64Match) {
				const mimeType = `image/${base64Match[1]}`
				const base64Data = base64Match[2]
				const binaryData = Buffer.from(base64Data, "base64")
				const blob = new Blob([binaryData], { type: mimeType })
				formData.append("image", blob, `input.${base64Match[1]}`)
			} else {
				// If not a data URL, try to use it as-is (URL string)
				formData.append("image", inputImage!)
			}

			fetchOptions = {
				method: "POST",
				headers: {
					Authorization: `Bearer ${authToken}`,
					// Note: Do NOT set Content-Type for FormData, fetch will set it with boundary
					"HTTP-Referer": "https://ruteapi.com",
					"X-Title": "tocodex-Community",
					...options.extraHeaders,
				},
				body: formData,
			}
		} else {
			// Pure text-to-image: use JSON body with /v1/images/generations
			const requestBody: Record<string, unknown> = {
				model,
				prompt,
				n: 1,
			}

			// Add optional parameters
			if (options.size) {
				requestBody.size = options.size
			}
			if (options.quality) {
				requestBody.quality = options.quality
			}

			// For BFL (Black Forest Labs) models like flux-pro-1.1, use providerOptions
			if (model.startsWith("bfl/")) {
				requestBody.providerOptions = {
					blackForestLabs: {
						outputFormat: outputFormat,
						// inputImage: Base64 encoded image or URL of image to use as reference
						...(inputImage && { inputImage }),
					},
				}
			} else {
				// For other models, use standard output_format parameter
				requestBody.output_format = outputFormat
			}

			fetchOptions = {
				method: "POST",
				headers: {
					Authorization: `Bearer ${authToken}`,
					"Content-Type": "application/json",
					"HTTP-Referer": "https://ruteapi.com",
					"X-Title": "tocodex-Community",
					...options.extraHeaders,
				},
				body: JSON.stringify(requestBody),
			}
		}

		// 生图接口（/v1/images/edits、/v1/images/generations）单次生成可能耗时数百秒。
		// undici（Node fetch 底层）headersTimeout 默认 300s，会在 ~300s 抛 HeadersTimeoutError（fetch failed）。
		// 必须通过 undici Agent 显式覆盖 headersTimeout/bodyTimeout，否则 AbortSignal.timeout 无效。
		const IMAGE_API_TIMEOUT_MS = 660_000 // 比 nginx proxy_read_timeout 600s 稍大，让超时由 nginx 控制
		const imageApiAgent = new Agent({ headersTimeout: IMAGE_API_TIMEOUT_MS, bodyTimeout: IMAGE_API_TIMEOUT_MS })
		fetchOptions.signal = AbortSignal.timeout(IMAGE_API_TIMEOUT_MS)
		// @ts-ignore — undici dispatcher，Node 18+ 原生 fetch 支持
		fetchOptions.dispatcher = imageApiAgent

		const response = await fetch(url, fetchOptions)

		if (!response.ok) {
			const errorText = await response.text()
			let errorMessage = t("tools:generateImage.failedWithStatus", {
				status: response.status,
				statusText: response.statusText,
			})

			try {
				const errorJson = JSON.parse(errorText)
				if (errorJson.error?.message) {
					errorMessage = t("tools:generateImage.failedWithMessage", {
						message: errorJson.error.message,
					})
				}
			} catch {
				// Use default error message
			}

			// 502/524 通常是网络超时（如 Cloudflare 超时），提示用户降低分辨率
			if (response.status === 502 || response.status === 524) {
				errorMessage +=
					"\n\n" +
					t("tools:generateImage.timeoutHint", {
						defaultValue:
							"This may be caused by a network timeout. High-resolution images (e.g. 4K) take longer to generate and may exceed the timeout limit. Please try reducing the image resolution (e.g. use 1024x1024 instead of 4096x4096).",
					})
			}

			return {
				success: false,
				error: errorMessage,
			}
		}

		const result: ImagesApiResponse = await response.json()

		if (result.error) {
			return {
				success: false,
				error: t("tools:generateImage.failedWithMessage", {
					message: result.error.message,
				}),
			}
		}

		// Extract the generated image from the response
		const images = result.data
		if (!images || images.length === 0) {
			return {
				success: false,
				error: t("tools:generateImage.noImageGenerated"),
			}
		}

		const imageItem = images[0]

		// Handle b64_json response (most common)
		if (imageItem?.b64_json) {
			// Convert base64 to data URL
			const dataUrl = `data:image/${outputFormat};base64,${imageItem.b64_json}`
			return {
				success: true,
				imageData: dataUrl,
				imageFormat: outputFormat,
			}
		}

		// Handle URL response (fallback)
		if (imageItem?.url) {
			// If it's already a data URL, use it directly
			if (imageItem.url.startsWith("data:image/")) {
				const formatMatch = imageItem.url.match(/^data:image\/(\w+);/)
				const format = formatMatch?.[1] || outputFormat
				return {
					success: true,
					imageData: imageItem.url,
					imageFormat: format,
				}
			}
			// For external URLs, return as-is (the caller will need to handle fetching)
			return {
				success: true,
				imageData: imageItem.url,
				imageFormat: outputFormat,
			}
		}

		return {
			success: false,
			error: t("tools:generateImage.invalidImageData"),
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}

import path from "path"
import fs from "fs/promises"
import * as vscode from "vscode"
import { GenerateImageParams } from "@roo-code/types"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { fileExistsAtPath } from "../../utils/fs"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { RooHandler } from "../../api/providers/roo"
import { generateImageWithImagesApi } from "../../api/providers/utils/image-generation"
import { DEFAULT_CUSTOM_IMAGE_BASE_URL } from "@roo-code/types"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { t } from "../../i18n"

export class GenerateImageTool extends BaseTool<"generate_image"> {
	readonly name = "generate_image" as const

	async execute(params: GenerateImageParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { prompt, path: relPath, image: inputImagePath, size: toolSize } = params
		const { handleError, pushToolResult, askApproval } = callbacks

		const provider = task.providerRef.deref()
		const state = await provider?.getState()
		const isImageGenerationEnabled = experiments.isEnabled(
			state?.experiments ?? {},
			EXPERIMENT_IDS.IMAGE_GENERATION,
		)

		if (!isImageGenerationEnabled) {
			pushToolResult(
				formatResponse.toolError(
					"Image generation is an experimental feature that must be enabled in settings. Please enable 'Image Generation' in the Experimental Settings section.",
				),
			)
			return
		}

		if (!prompt) {
			task.consecutiveMistakeCount++
			task.recordToolError("generate_image")
			pushToolResult(await task.sayAndCreateMissingParamError("generate_image", "prompt"))
			return
		}

		if (!relPath) {
			task.consecutiveMistakeCount++
			task.recordToolError("generate_image")
			pushToolResult(await task.sayAndCreateMissingParamError("generate_image", "path"))
			return
		}

		const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)
		if (!accessAllowed) {
			await task.say("rooignore_error", relPath)
			pushToolResult(formatResponse.rooIgnoreError(relPath))
			return
		}

		let inputImageData: string | undefined
		if (inputImagePath && inputImagePath !== "null") {
			const inputImageFullPath = path.resolve(task.cwd, inputImagePath)

			const inputImageExists = await fileExistsAtPath(inputImageFullPath)
			if (!inputImageExists) {
				await task.say("error", `Input image not found: ${getReadablePath(task.cwd, inputImagePath)}`)
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(`Input image not found: ${getReadablePath(task.cwd, inputImagePath)}`),
				)
				return
			}

			const inputImageAccessAllowed = task.rooIgnoreController?.validateAccess(inputImagePath)
			if (!inputImageAccessAllowed) {
				await task.say("rooignore_error", inputImagePath)
				pushToolResult(formatResponse.rooIgnoreError(inputImagePath))
				return
			}

			try {
				const imageBuffer = await fs.readFile(inputImageFullPath)
				const imageExtension = path.extname(inputImageFullPath).toLowerCase().replace(".", "")

				const supportedFormats = ["png", "jpg", "jpeg", "gif", "webp"]
				if (!supportedFormats.includes(imageExtension)) {
					await task.say(
						"error",
						`Unsupported image format: ${imageExtension}. Supported formats: ${supportedFormats.join(", ")}`,
					)
					task.didToolFailInCurrentTurn = true
					pushToolResult(
						formatResponse.toolError(
							`Unsupported image format: ${imageExtension}. Supported formats: ${supportedFormats.join(", ")}`,
						),
					)
					return
				}

				const mimeType = imageExtension === "jpg" ? "jpeg" : imageExtension
				inputImageData = `data:image/${mimeType};base64,${imageBuffer.toString("base64")}`
			} catch (error) {
				await task.say(
					"error",
					`Failed to read input image: ${error instanceof Error ? error.message : "Unknown error"}`,
				)
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						`Failed to read input image: ${error instanceof Error ? error.message : "Unknown error"}`,
					),
				)
				return
			}
		}

		const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false

		// 生图模型选择：优先使用设置中的生图模型，否则默认 gpt-image-2
		// 注意：聊天模型（如 gpt-5.5）不支持图像生成，必须使用专门的生图模型
		let selectedModel = state?.openRouterImageGenerationSelectedModel || "gpt-image-2"
		const imageProvider = state?.imageGenerationProvider ?? "roo"
		// 兼容处理：如果用户设置中保存了 OpenRouter 风格的旧模型名（如 "openai/gpt-image-1"），
		// 在 ToCodex/Roo 现有路径下映射为 NewAPI 可识别的模型名（如 "gpt-image-2"）。
		// custom provider 使用用户输入的原始模型名，不能自动改写。
		const OPENROUTER_TO_NEWAPI_MODEL_MAP: Record<string, string> = {
			"openai/gpt-image-1": "gpt-image-2",
		}
		if (imageProvider !== "custom" && OPENROUTER_TO_NEWAPI_MODEL_MAP[selectedModel]) {
			selectedModel = OPENROUTER_TO_NEWAPI_MODEL_MAP[selectedModel]
		}

		const fullPath = path.resolve(task.cwd, relPath)
		const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)

		const sharedMessageProps = {
			tool: "generateImage" as const,
			path: getReadablePath(task.cwd, relPath),
			content: prompt,
			isOutsideWorkspace,
			isProtected: isWriteProtected,
		}

		try {
			task.consecutiveMistakeCount = 0

			const approvalMessage = JSON.stringify({
				...sharedMessageProps,
				content: prompt,
				...(inputImagePath && { inputImage: getReadablePath(task.cwd, inputImagePath) }),
			})

			const didApprove = await askApproval("tool", approvalMessage, undefined, isWriteProtected)

			if (!didApprove) {
				return
			}

			// 优化2: 生图进度提示 — 在 API 调用前显示等待消息
			const progressMessage = JSON.stringify({
				...sharedMessageProps,
				content: `⏳ ${selectedModel} ${t("tools:generateImage.generating", { defaultValue: "Generating image, please wait..." })}`,
			})
			await task.say("tool", progressMessage)

			let result
			// 优化1: 工具参数 size 优先于设置中的 imageGenerationSize
			// 注意: 当 AI 传 size: null 时，参数解析器会将其转为字符串 "null"，需要过滤掉
			const validToolSize = toolSize && toolSize !== "null" ? toolSize : undefined
			const imageSize = validToolSize || state?.imageGenerationSize

			if (imageProvider === "custom") {
				// 自定义 provider：使用用户配置的独立生图 URL 和 API Key
				const customBaseUrl = (state?.customImageBaseUrl || DEFAULT_CUSTOM_IMAGE_BASE_URL).replace(/\/$/, "")
				const customApiKey = state?.customImageApiKey || ""
				if (!customApiKey) {
					pushToolResult(
						formatResponse.toolError(
							"Custom image provider is selected but no API key is configured. Please set the API key in Settings → Image Generation.",
						),
					)
					return
				}
				result = await generateImageWithImagesApi({
					baseURL: customBaseUrl,
					authToken: customApiKey,
					model: selectedModel,
					prompt,
					inputImage: inputImageData,
					size: imageSize,
				})
			} else {
				// ToCodex Cloud（roo）或 OpenRouter：使用 RooHandler（独立域名 + HMAC）
				const rooHandler = new RooHandler({} as any)
				result = await rooHandler.generateImage(prompt, selectedModel, inputImageData, "images_api", imageSize)
			}

			if (!result.success) {
				await task.say("error", result.error || "Failed to generate image")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(result.error || "Failed to generate image"))
				return
			}

			if (!result.imageData) {
				const errorMessage = "No image data received"
				await task.say("error", errorMessage)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			let imageData = result.imageData

			// 如果返回的是远程 URL（非 data URI），先下载并转为 base64
			if (imageData.startsWith("http://") || imageData.startsWith("https://")) {
				try {
					// 下载已生成图片到本地，60s 兜底防止网络挂死
					const response = await fetch(imageData, {
						signal: AbortSignal.timeout(60_000),
					})
					if (!response.ok) {
						throw new Error(`HTTP ${response.status} ${response.statusText}`)
					}
					const arrayBuffer = await response.arrayBuffer()
					const buffer = Buffer.from(arrayBuffer)
					// 从 Content-Type 或 URL 推断格式
					const contentType = response.headers.get("content-type") || ""
					let format = "png"
					if (contentType.includes("jpeg") || contentType.includes("jpg")) format = "jpeg"
					else if (contentType.includes("webp")) format = "webp"
					else if (contentType.includes("gif")) format = "gif"
					else if (contentType.includes("png")) format = "png"
					else {
						// 从 URL 推断
						const urlLower = imageData.toLowerCase()
						if (urlLower.includes(".jpg") || urlLower.includes(".jpeg")) format = "jpeg"
						else if (urlLower.includes(".webp")) format = "webp"
						else if (urlLower.includes(".gif")) format = "gif"
					}
					imageData = `data:image/${format};base64,${buffer.toString("base64")}`
				} catch (downloadError) {
					const errorMessage = `Failed to download generated image: ${downloadError instanceof Error ? downloadError.message : "Unknown error"}`
					await task.say("error", errorMessage)
					task.didToolFailInCurrentTurn = true
					pushToolResult(formatResponse.toolError(errorMessage))
					return
				}
			}

			const base64Match = imageData.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/)
			if (!base64Match) {
				const errorMessage = "Invalid image format received"
				await task.say("error", errorMessage)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			const imageFormat = base64Match[1]
			const base64Data = base64Match[2]

			let finalPath = relPath
			if (!finalPath.match(/\.(png|jpg|jpeg|webp|gif)$/i)) {
				finalPath = `${finalPath}.${imageFormat === "jpeg" ? "jpg" : imageFormat}`
			}

			const imageBuffer = Buffer.from(base64Data, "base64")

			const absolutePath = path.resolve(task.cwd, finalPath)
			const directory = path.dirname(absolutePath)
			await fs.mkdir(directory, { recursive: true })

			await fs.writeFile(absolutePath, imageBuffer)

			if (finalPath) {
				await task.fileContextTracker.trackFileContext(finalPath, "roo_edited")
			}

			task.didEditFile = true

			task.recordToolUsage("generate_image")

			const fullImagePath = path.join(task.cwd, finalPath)

			// Use toString(true) to skip encoding — avoids g%3A on Windows drive letters
			let imageUri =
				provider?.convertToWebviewUri?.(fullImagePath) ?? vscode.Uri.file(fullImagePath).toString(true)

			const cacheBuster = Date.now()
			imageUri = imageUri.includes("?") ? `${imageUri}&t=${cacheBuster}` : `${imageUri}?t=${cacheBuster}`

			// imagePath: use relative path with forward slashes for cross-platform display & markdown link compat
			const relImagePath = "./" + finalPath.replace(/\\/g, "/")
			await task.say("image", JSON.stringify({ imageUri, imagePath: relImagePath }))
			pushToolResult(formatResponse.toolResult(getReadablePath(task.cwd, finalPath)))
		} catch (error) {
			await handleError("generating image", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"generate_image">): Promise<void> {
		return
	}
}

export const generateImageTool = new GenerateImageTool()

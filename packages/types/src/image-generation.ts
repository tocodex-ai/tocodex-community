/**
 * Image generation model constants
 */

/**
 * API method used for image generation
 */
export type ImageGenerationApiMethod = "chat_completions" | "images_api"

export interface ImageGenerationModel {
	value: string
	label: string
	provider: ImageGenerationProvider
	apiMethod?: ImageGenerationApiMethod
}

/**
 * 默认内置的生图模型列表（当配置文件不存在时使用）
 */
export const DEFAULT_IMAGE_GENERATION_MODELS: ImageGenerationModel[] = [
	// OpenRouter models
	{ value: "openai/gpt-image-1", label: "GPT-Image-2", provider: "openrouter" },
	{ value: "google/gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image", provider: "openrouter" },
	{ value: "google/gemini-3-pro-image-preview", label: "Gemini 3 Pro Image Preview", provider: "openrouter" },
	{ value: "alibaba/wan2.7-image", label: "Wan2.7-Image", provider: "openrouter" },
	{ value: "volcengine/seedream-5.0-lite", label: "Seedream 5.0 Lite", provider: "openrouter" },
	{ value: "alibaba/qwen-image-2.0", label: "Qwen-Image-2.0", provider: "openrouter" },
	{ value: "openai/gpt-5-image", label: "GPT-5 Image", provider: "openrouter" },
	{ value: "openai/gpt-5-image-mini", label: "GPT-5 Image Mini", provider: "openrouter" },
	{ value: "black-forest-labs/flux.2-flex", label: "Black Forest Labs FLUX.2 Flex", provider: "openrouter" },
	{ value: "black-forest-labs/flux.2-pro", label: "Black Forest Labs FLUX.2 Pro", provider: "openrouter" },
	// ToCodex models (模型名须与服务端 new-api 渠道配置一致)
	{ value: "gpt-image-2", label: "GPT-Image-2", provider: "roo" },
	{ value: "gpt-image-1", label: "GPT-Image-1", provider: "roo" },
	{ value: "dall-e-3", label: "DALL-E 3", provider: "roo" },
	{ value: "dall-e-2", label: "DALL-E 2", provider: "roo" },
]

/**
 * 图片尺寸预设
 */
export interface ImageSizePreset {
	label: string
	width: number
	height: number
	category: "1K" | "2K" | "4K"
}

export const IMAGE_SIZE_PRESETS: ImageSizePreset[] = [
	// 1K
	{ label: "1K 方图 · 1024 × 1024", width: 1024, height: 1024, category: "1K" },
	// 2K
	{ label: "2K 横图 · 1536 × 1024", width: 1536, height: 1024, category: "2K" },
	{ label: "2K 竖图 · 1024 × 1536", width: 1024, height: 1536, category: "2K" },
	{ label: "2K 方图 · 2048 × 2048", width: 2048, height: 2048, category: "2K" },
	{ label: "2K 宽屏 · 2048 × 1152", width: 2048, height: 1152, category: "2K" },
	{ label: "2K 竖幅 · 1152 × 2048", width: 1152, height: 2048, category: "2K" },
	// 4K
	{ label: "4K 横图 · 3840 × 2160", width: 3840, height: 2160, category: "4K" },
	{ label: "4K 竖图 · 2160 × 3840", width: 2160, height: 3840, category: "4K" },
]

export const DEFAULT_IMAGE_SIZE = "1024x1024"

/**
 * @deprecated 使用 DEFAULT_IMAGE_GENERATION_MODELS 或从 state 获取动态模型列表
 */
export const IMAGE_GENERATION_MODELS = DEFAULT_IMAGE_GENERATION_MODELS

/**
 * Get array of model values only (for backend validation)
 */
export const IMAGE_GENERATION_MODEL_IDS = DEFAULT_IMAGE_GENERATION_MODELS.map((m) => m.value)

/**
 * 校验并解析配置文件中的生图模型列表。
 * 返回合法的模型数组；如果输入无效则返回 null。
 */
export function parseImageGenerationModels(data: unknown): ImageGenerationModel[] | null {
	if (!Array.isArray(data)) return null
	const validProviders = ["openrouter", "roo", "custom"]
	const validApiMethods = ["chat_completions", "images_api"]
	const models: ImageGenerationModel[] = []
	for (const item of data) {
		if (
			typeof item === "object" &&
			item !== null &&
			typeof (item as any).value === "string" &&
			typeof (item as any).label === "string" &&
			validProviders.includes((item as any).provider)
		) {
			const m: ImageGenerationModel = {
				value: (item as any).value,
				label: (item as any).label,
				provider: (item as any).provider,
			}
			if ((item as any).apiMethod && validApiMethods.includes((item as any).apiMethod)) {
				m.apiMethod = (item as any).apiMethod
			}
			models.push(m)
		}
	}
	return models.length > 0 ? models : null
}

/**
 * Image generation provider type
 * - "roo": ToCodex Cloud（独立生图域名 + HMAC 签名）
 * - "openrouter": OpenRouter 公共生图 API
 * - "custom": 用户自定义独立生图 endpoint，URL 与 API Key 与对话提供商无关
 */
export type ImageGenerationProvider = "openrouter" | "roo" | "custom"

/**
 * 自定义生图 provider 默认 base URL（示例值，让用户在设置里自行替换）
 */
export const DEFAULT_CUSTOM_IMAGE_BASE_URL = "https://example.com/v1"

/**
 * Get the image generation provider with backwards compatibility
 * - If provider is explicitly set, use it
 * - If a model is already configured (existing users), default to "openrouter"
 * - Otherwise default to "roo" (new users)
 */
export function getImageGenerationProvider(
	explicitProvider: ImageGenerationProvider | undefined,
	hasExistingModel: boolean,
): ImageGenerationProvider {
	return explicitProvider !== undefined ? explicitProvider : hasExistingModel ? "openrouter" : "roo"
}

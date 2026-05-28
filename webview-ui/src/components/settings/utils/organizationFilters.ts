import type { ProviderName, ModelInfo, OrganizationAllowList } from "@roo-code/types"

/**
 * 判断模型是否为「纯图像生成模型」（即只能用于图像生成、不能用于对话/工具调用的模型）。
 * 用于在对话模型选择器（ModelSelector / ModelPicker / 辅助模型下拉）中过滤掉这些模型，
 * 防止用户误选导致 generate_image 工具在调用对话补全时报 openai_error / system message not supported 等错误。
 *
 * 规则均为大小写不敏感，并兼容常见 provider 前缀变体（例如 openai/、google/、black-forest-labs/）。
 *
 * 注意：此函数仅用于过滤「对话模型选择器」，不能用于
 * `ImageGenerationSettings.tsx` 中的图像生成模型选择器（那里需要展示这些模型）。
 */
export const isImageOnlyModel = (modelId: string | undefined | null): boolean => {
	if (!modelId || typeof modelId !== "string") {
		return false
	}

	// 规范化：去除空白
	const id = modelId.trim()
	if (!id) {
		return false
	}

	// 大小写不敏感的匹配模式集合
	const patterns: RegExp[] = [
		// OpenAI 图像专用：gpt-image-1 / gpt-image-2 / openai/gpt-image-*
		/^(?:openai\/)?gpt-image[-_]?\d*/i,
		// gpt-<digits>-image-* / gpt-<digits>.<digits>-image-* （如 gpt-5.4-image-2 / gpt-5-image-mini）
		/^(?:openai\/)?gpt-\d+(?:\.\d+)?[-_]image\b/i,
		// DALL·E 系列：dall-e-2 / dall-e-3 / openai/dall-e-*
		/^(?:openai\/)?dall[-_]?e[-_]?\d*/i,
		// Black Forest Labs：bfl/* 全系都是图像
		/^bfl\//i,
		// Flux 系列：flux* / black-forest-labs/flux*
		/^(?:black-forest-labs\/)?flux/i,
		// Google Gemini 图像变体（gemini-2.5-flash-image、gemini-3.1-flash-image-preview 等）
		/^(?:google\/)?gemini[-_].+[-_]image(?:[-_]preview)?$/i,
		// 通用尾缀：以 -image 或 -image-preview 结尾的模型 ID
		/[-_]image[-_]preview$/i,
		/[-_]image$/i,
	]

	return patterns.some((re) => re.test(id))
}

/**
 * 过滤掉模型记录中的纯图像模型，返回新对象。
 * 可选保留 `keepIds`（一般是当前已选中的模型），即使命中规则也保留，
 * 这样不会让用户已配置的模型从下拉列表里凭空消失。
 */
export const filterOutImageOnlyModels = <T extends Record<string, unknown>>(
	models: T | null | undefined,
	keepIds: ReadonlyArray<string> = [],
): T => {
	if (!models) {
		return {} as T
	}
	const keepSet = new Set(keepIds.filter(Boolean))
	const result: Record<string, unknown> = {}
	for (const [id, info] of Object.entries(models)) {
		if (keepSet.has(id) || !isImageOnlyModel(id)) {
			result[id] = info
		}
	}
	return result as T
}

export const filterProviders = (
	providers: Array<{ value: string; label: string }>,
	organizationAllowList?: OrganizationAllowList,
): Array<{ value: string; label: string }> => {
	if (!organizationAllowList || organizationAllowList.allowAll) {
		return providers
	}

	return providers.filter((provider) => {
		const providerConfig = organizationAllowList.providers[provider.value]
		if (!providerConfig) {
			return false
		}

		return providerConfig.allowAll || (providerConfig.models && providerConfig.models.length > 0)
	})
}

export const filterModels = (
	models: Record<string, ModelInfo> | null,
	providerId?: ProviderName,
	organizationAllowList?: OrganizationAllowList,
): Record<string, ModelInfo> | null => {
	if (!models || !organizationAllowList || organizationAllowList.allowAll) {
		return models
	}

	if (!providerId) {
		return {}
	}

	const providerConfig = organizationAllowList.providers[providerId]
	if (!providerConfig) {
		return {}
	}

	if (providerConfig.allowAll) {
		return models
	}

	const allowedModels = providerConfig.models || []
	const filteredModels: Record<string, ModelInfo> = {}

	for (const modelId of allowedModels) {
		if (models[modelId]) {
			filteredModels[modelId] = models[modelId]
		}
	}

	return filteredModels
}

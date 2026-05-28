/**
 * 辅助模型（轻量模型）工具函数
 *
 * 用于 condense、进度摘要、记忆提取等后台任务。
 * 当用户配置了 lightModelId 时使用轻量模型，否则回退到主模型。
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5
 */

import type { ProviderSettings } from "@roo-code/types"
import { modelIdKeysByProvider } from "@roo-code/types"
import { buildApiHandler, type ApiHandler } from "./index"

/**
 * 获取辅助模型的 ID。
 * 如果未配置 lightModelId，返回 undefined（表示使用主模型）。
 */
export function getLightModelId(config: ProviderSettings): string | undefined {
	return config.lightModelId || undefined
}

/**
 * 构建辅助模型的 API handler。
 * 如果配置了 lightModelId，用它替换主模型 ID 创建新 handler；
 * 否则返回 null，调用方应回退到主 handler。
 */
export function buildLightModelHandler(config: ProviderSettings): ApiHandler | null {
	const lightId = getLightModelId(config)
	if (!lightId) {
		return null
	}

	const provider = config.apiProvider
	if (!provider) {
		return null
	}

	// 找到当前 provider 对应的 modelId 字段名
	const modelIdKey = (modelIdKeysByProvider as Record<string, string>)[provider]
	if (!modelIdKey) {
		return null
	}

	// 用 lightModelId 替换主模型 ID，创建新的 handler
	const lightConfig: ProviderSettings = {
		...config,
		[modelIdKey]: lightId,
	}

	try {
		return buildApiHandler(lightConfig)
	} catch {
		// 构建失败时静默回退
		return null
	}
}

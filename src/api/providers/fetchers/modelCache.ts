import * as path from "path"
import fs from "fs/promises"
import * as fsSync from "fs"

import NodeCache from "node-cache"
import { z } from "zod"

import type { ProviderName, ModelRecord } from "@roo-code/types"
import { modelInfoSchema, TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { DEFAULT_TOCODEX_API_URL } from "../constants"

import { safeWriteJson } from "../../../utils/safeWriteJson"

import { ContextProxy } from "../../../core/config/ContextProxy"
import { getCacheDirectoryPath } from "../../../utils/storage"
import type { RouterName } from "../../../shared/api"
import { fileExistsAtPath } from "../../../utils/fs"

import { getOpenRouterModels } from "./openrouter"
import { getVercelAiGatewayModels } from "./vercel-ai-gateway"
import { getRequestyModels } from "./requesty"
import { getUnboundModels } from "./unbound"
import { getLiteLLMModels } from "./litellm"
import { GetModelsOptions } from "../../../shared/api"
import { getOllamaModels } from "./ollama"
import { getLMStudioModels } from "./lmstudio"
import { getRooModels, getDefaultFallbackModels } from "./roo"

const memoryCache = new NodeCache({ stdTTL: 5 * 60, checkperiod: 5 * 60 })

// Zod schema for validating ModelRecord structure from disk cache
const modelRecordSchema = z.record(z.string(), modelInfoSchema)

// Track in-flight refresh requests to prevent concurrent API calls for the same provider
// This prevents race conditions where multiple calls might overwrite each other's results
const inFlightRefresh = new Map<RouterName, Promise<ModelRecord>>()

// Track whether a successful refresh has occurred for each provider
// Used to prevent stale fallback from overwriting fresh data in webviewDidLaunch
const refreshSucceeded = new Set<RouterName>()

/**
 * Returns true if a successful refresh has already completed for this provider.
 * Used by webviewDidLaunch to decide whether to push fallback models.
 */
export function hasRefreshSucceeded(provider: RouterName): boolean {
	return refreshSucceeded.has(provider)
}

async function writeModels(router: RouterName, data: ModelRecord) {
	const filename = `${router}_models.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	await safeWriteJson(path.join(cacheDir, filename), data)
}

async function readModels(router: RouterName): Promise<ModelRecord | undefined> {
	const filename = `${router}_models.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	const filePath = path.join(cacheDir, filename)
	const exists = await fileExistsAtPath(filePath)
	return exists ? JSON.parse(await fs.readFile(filePath, "utf8")) : undefined
}

/**
 * Fetch models from the provider API.
 * Extracted to avoid duplication between getModels() and refreshModels().
 *
 * @param options - Provider options for fetching models
 * @returns Fresh models from the provider API
 */
async function fetchModelsFromProvider(options: GetModelsOptions): Promise<ModelRecord> {
	const { provider } = options

	let models: ModelRecord

	switch (provider) {
		case "openrouter":
			models = await getOpenRouterModels()
			break
		case "requesty":
			// Requesty models endpoint requires an API key for per-user custom policies.
			models = await getRequestyModels(options.baseUrl, options.apiKey)
			break
		case "unbound":
			models = await getUnboundModels(options.apiKey)
			break
		case "litellm":
			// Type safety ensures apiKey and baseUrl are always provided for LiteLLM.
			models = await getLiteLLMModels(options.apiKey, options.baseUrl)
			break
		case "ollama":
			models = await getOllamaModels(options.baseUrl, options.apiKey)
			break
		case "lmstudio":
			models = await getLMStudioModels(options.baseUrl)
			break
		case "vercel-ai-gateway":
			models = await getVercelAiGatewayModels()
			break
		case "roo": {
			// Roo Code Cloud provider requires baseUrl and optional apiKey
			const rooBaseUrl = options.baseUrl ?? DEFAULT_TOCODEX_API_URL
			models = await getRooModels(rooBaseUrl, options.apiKey)
			break
		}
		default: {
			// Ensures router is exhaustively checked if RouterName is a strict union.
			const exhaustiveCheck: never = provider
			throw new Error(`Unknown provider: ${exhaustiveCheck}`)
		}
	}

	return models
}

/**
 * Get models from the cache or fetch them from the provider and cache them.
 * There are two caches:
 * 1. Memory cache - This is a simple in-memory cache that is used to store models for a short period of time.
 * 2. File cache - This is a file-based cache that is used to store models for a longer period of time.
 *
 * @param router - The router to fetch models from.
 * @param apiKey - Optional API key for the provider.
 * @param baseUrl - Optional base URL for the provider (currently used only for LiteLLM).
 * @returns The models from the cache or the fetched models.
 */
export const getModels = async (options: GetModelsOptions): Promise<ModelRecord> => {
	const { provider } = options

	let models = getModelsFromCache(provider)

	// 只有缓存中有实际模型数据（非空）才直接返回
	if (models && Object.keys(models).length > 0) {
		return models
	}

	// 如果有同一 provider 的 in-flight refresh，等待它完成后直接用缓存
	// 防止竞态：refreshModels 完成后 getModels 不应再触发新 API 请求
	const existingRefresh = inFlightRefresh.get(provider as RouterName)
	if (existingRefresh) {
		await existingRefresh
		const cachedAfterRefresh = getModelsFromCache(provider)
		if (cachedAfterRefresh && Object.keys(cachedAfterRefresh).length > 0) {
			return cachedAfterRefresh
		}
	}

	// 如果刷新已成功完成，直接用缓存，不发新 API 请求
	if (hasRefreshSucceeded(provider as RouterName)) {
		const cachedModels = getModelsFromCache(provider)
		if (cachedModels && Object.keys(cachedModels).length > 0) {
			return cachedModels
		}
		// 刷新成功但缓存为空（极端情况），用 fallback 而不再发 API 请求
		if (provider === "roo") {
			return getDefaultFallbackModels()
		}
	}

	try {
		models = await fetchModelsFromProvider(options)
		const modelCount = Object.keys(models).length

		// Only cache non-empty results to prevent persisting failed API responses
		// Empty results could indicate API failure rather than "no models exist"
		if (modelCount > 0) {
			memoryCache.set(provider, models)

			await writeModels(provider, models).catch((err) =>
				console.error(`[MODEL_CACHE] Error writing ${provider} models to file cache:`, err),
			)
		} else {
			TelemetryService.instance.captureEvent(TelemetryEventName.MODEL_CACHE_EMPTY_RESPONSE, {
				provider,
				context: "getModels",
				hasExistingCache: false,
			})

			// roo provider 无缓存且 API 返回空时，使用固定 fallback 保持 UI 可用
			// 不写入缓存，下次启动仍会重新尝试 /api/pricing
			if (provider === "roo") {
				return getDefaultFallbackModels()
			}
		}

		return models
	} catch (error) {
		// Log the error and re-throw it so the caller can handle it (e.g., show a UI message).
		console.error(`[getModels] Failed to fetch models in modelCache for ${provider}:`, error)

		throw error // Re-throw the original error to be handled by the caller.
	}
}

/**
 * Force-refresh models from API, bypassing cache.
 * Uses atomic writes so cache remains available during refresh.
 * This function also prevents concurrent API calls for the same provider using
 * in-flight request tracking to avoid race conditions.
 *
 * @param options - Provider options for fetching models
 * @returns Fresh models from API, or existing cache if refresh yields worse data
 */
export const refreshModels = async (options: GetModelsOptions): Promise<ModelRecord> => {
	const { provider } = options

	// Check if there's already an in-flight refresh for this provider
	// This prevents race conditions where multiple concurrent refreshes might
	// overwrite each other's results
	const existingRequest = inFlightRefresh.get(provider)
	if (existingRequest) {
		return existingRequest
	}

	// Create the refresh promise and track it
	const refreshPromise = (async (): Promise<ModelRecord> => {
		try {
			// Force fresh API fetch - skip getModelsFromCache() check
			const models = await fetchModelsFromProvider(options)
			const modelCount = Object.keys(models).length

			// Get existing cached data for comparison
			const existingCache = getModelsFromCache(provider)
			const existingCount = existingCache ? Object.keys(existingCache).length : 0

			if (modelCount === 0) {
				TelemetryService.instance.captureEvent(TelemetryEventName.MODEL_CACHE_EMPTY_RESPONSE, {
					provider,
					context: "refreshModels",
					hasExistingCache: existingCount > 0,
					existingCacheSize: existingCount,
				})
				if (existingCount > 0) {
					return existingCache!
				} else {
					return {}
				}
			}

			// Update memory cache first
			memoryCache.set(provider, models)

			// Mark this provider as having a successful refresh
			// Prevents stale fallback from overwriting fresh data in webviewDidLaunch
			refreshSucceeded.add(provider)

			// Atomically write to disk (safeWriteJson handles atomic writes)
			await writeModels(provider, models).catch((err) =>
				console.error(`[refreshModels] Error writing ${provider} models to disk:`, err),
			)

			return models
		} catch (error) {
			// Log the error for debugging, then return existing cache if available (graceful degradation)
			console.error(`[refreshModels] Failed to refresh ${provider} models:`, error)
			return getModelsFromCache(provider) || {}
		} finally {
			// Always clean up the in-flight tracking
			inFlightRefresh.delete(provider)
		}
	})()

	// Track the in-flight request
	inFlightRefresh.set(provider, refreshPromise)

	return refreshPromise
}

/**
 * Initialize background model cache refresh.
 * Refreshes public provider caches without blocking or requiring auth.
 * Should be called once during extension activation.
 */
export async function initializeModelCacheRefresh(): Promise<void> {
	// 先异步预热磁盘缓存到内存，消除后续 getModelsFromCache 的同步 IO
	await warmupDiskCache()

	// 扩展激活后延迟刷新默认 provider（ToCodex Router）的模型缓存
	// roo provider 始终走 /api/pricing（公开定价，含价格和 free 标记），不传 apiKey
	setTimeout(() => {
		refreshModels({
			provider: "roo",
			baseUrl: DEFAULT_TOCODEX_API_URL,
		}).catch(() => {
			// Silent fail - old cache or fallback models remain available
		})
	}, 1000)

	// 延迟刷新 OpenRouter 模型缓存（免 key，用于为 ToCodex 模型补充能力信息）
	// 仅启动时后台静默刷新一次，数据持久化到磁盘，后续直接读本地缓存
	setTimeout(() => {
		refreshModels({
			provider: "openrouter",
		}).catch(() => {
			// Silent fail - 磁盘缓存仍可用，或回退到本地推断
		})
	}, 3000)
}

/**
 * Flush models memory cache for a specific router.
 *
 * @param options - The options for fetching models, including provider, apiKey, and baseUrl
 * @param refresh - If true, immediately fetch fresh data from API
 */
export const flushModels = async (options: GetModelsOptions, refresh: boolean = false): Promise<void> => {
	const { provider } = options
	if (refresh) {
		// Don't delete memory cache - let refreshModels atomically replace it
		// This prevents a race condition where getModels() might be called
		// before refresh completes, avoiding a gap in cache availability
		// Await the refresh to ensure the cache is updated before returning
		await refreshModels(options)
	} else {
		// Only delete memory cache when not refreshing
		memoryCache.del(provider)
	}
}

/**
 * Get models from cache, checking memory first, then disk.
 * This ensures providers always have access to last known good data,
 * preventing fallback to hardcoded defaults on startup.
 *
 * 注意：磁盘读取仅在内存缓存未命中时发生，且通过 warmupDiskCache() 在激活时
 * 异步预热，正常情况下此函数只访问内存，不会阻塞扩展宿主进程。
 *
 * @param provider - The provider to get models for.
 * @returns Models from memory cache, disk cache, or undefined if not cached.
 */
export function getModelsFromCache(provider: ProviderName): ModelRecord | undefined {
	// 内存缓存命中直接返回（绝大多数情况）
	const memoryModels = memoryCache.get<ModelRecord>(provider)
	if (memoryModels) {
		return memoryModels
	}

	// 内存未命中：尝试同步读磁盘（仅冷启动且 warmupDiskCache 尚未完成时触发）
	// 通过 warmupDiskCache() 在激活时异步预热后，此分支基本不会执行
	try {
		const cacheDir = getCacheDirectoryPathSync()
		if (!cacheDir) return undefined

		const filePath = path.join(cacheDir, `${provider}_models.json`)
		if (!fsSync.existsSync(filePath)) return undefined

		const data = fsSync.readFileSync(filePath, "utf8")
		const validation = modelRecordSchema.safeParse(JSON.parse(data))
		if (!validation.success) {
			console.error(`[MODEL_CACHE] Invalid disk cache for ${provider}:`, validation.error.format())
			return undefined
		}

		// 写入内存缓存，后续调用直接命中内存
		memoryCache.set(provider, validation.data)
		return validation.data
	} catch (error) {
		console.error(`[MODEL_CACHE] Error loading ${provider} models from disk:`, error)
	}

	return undefined
}

/**
 * 异步预热磁盘缓存到内存，在扩展激活时调用一次。
 * 将所有已缓存 provider 的模型数据提前加载到内存，
 * 确保后续 getModelsFromCache() 调用只访问内存，不阻塞主线程。
 */
export async function warmupDiskCache(): Promise<void> {
	const cacheDir = getCacheDirectoryPathSync()
	if (!cacheDir) return

	const providers: ProviderName[] = [
		"roo",
		"openrouter",
		"requesty",
		"unbound",
		"litellm",
		"ollama",
		"lmstudio",
		"vercel-ai-gateway",
	]

	await Promise.allSettled(
		providers.map(async (provider) => {
			// 内存已有则跳过
			if (memoryCache.get(provider)) return

			try {
				const filePath = path.join(cacheDir, `${provider}_models.json`)
				const exists = await fileExistsAtPath(filePath)
				if (!exists) return

				const data = await fs.readFile(filePath, "utf8")
				const validation = modelRecordSchema.safeParse(JSON.parse(data))
				if (validation.success) {
					memoryCache.set(provider, validation.data)
				}
			} catch {
				// 静默忽略，单个 provider 预热失败不影响其他
			}
		}),
	)
}

/**
 * Synchronous version of getCacheDirectoryPath for use in getModelsFromCache.
 * Returns the cache directory path without async operations.
 */
function getCacheDirectoryPathSync(): string | undefined {
	try {
		const globalStoragePath = ContextProxy.instance?.globalStorageUri?.fsPath
		if (!globalStoragePath) return undefined
		return path.join(globalStoragePath, "cache")
	} catch (error) {
		console.error(`[MODEL_CACHE] Error getting cache directory path:`, error)
		return undefined
	}
}

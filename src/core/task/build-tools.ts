import path from "path"

import type OpenAI from "openai"

import type { ProviderSettings, ModeConfig, ModelInfo } from "@roo-code/types"
import { customToolRegistry, formatNative } from "@roo-code/core"

import type { ClineProvider } from "../webview/ClineProvider"
import { getRooDirectoriesForCwd } from "../../services/roo-config/index.js"

import { getNativeTools, getMcpServerTools } from "../prompts/tools/native-tools"
import {
	filterNativeToolsForMode,
	filterMcpToolsForMode,
	resolveToolAlias,
} from "../prompts/tools/filter-tools-for-mode"

/**
 * 延迟加载阈值：当可用工具总数超过此值时启用延迟加载模式。
 * 核心工具直接加载，其余标记为可搜索（通过 tool_search 工具加载）。
 */
export const DEFERRED_LOADING_THRESHOLD = 30

/**
 * 核心工具名称列表 — 这些工具始终直接加载，不会被延迟。
 * 包括基本的文件读写、搜索、命令执行等高频工具。
 */
export const CORE_TOOL_NAMES = new Set<string>([
	// 读取类
	"read_file",
	"search_files",
	"list_files",
	"codebase_search",
	"lsp_code_intelligence",
	// 编辑类
	"apply_diff",
	"write_to_file",
	"edit",
	"search_and_replace",
	"search_replace",
	"edit_file",
	"apply_patch",
	// 命令类
	"execute_command",
	"read_command_output",
	// 始终可用类
	"ask_followup_question",
	"attempt_completion",
	"switch_mode",
	"new_task",
	"update_todo_list",
	"run_slash_command",
	"skill",
	"enter_plan_mode",
	"exit_plan_mode",
	"spawn_parallel_task",
	"tool_search",
	// MCP 基础
	"use_mcp_tool",
	"access_mcp_resource",
])

/**
	* 模式 → 永远直接加载（不延迟）的 MCP 服务器名集合。
	*
	* 某些模式天然依赖特定 MCP 服务器（例如 browser-worker 必须能直接调
	* playwright 的 browser_* 工具），如果让这些工具走延迟加载，模型就要
	* 先调 `tool_search` 才能拿到 schema，但实际观察到模型经常 query 参数
	* 传不全，导致工具一直无法注入到当前会话。
	*
	* 在这些模式下，列在白名单里的 server 名匹配的所有工具一律直接加载。
	*/
export const MODE_PRELOAD_MCP_SERVERS: Record<string, ReadonlyArray<string>> = {
	"browser-worker": ["playwright"],
	"ssh-server": ["ssh-server"],
}

/**
	* 判断一个 MCP 工具是否属于当前模式的"预加载"白名单。
	* MCP 工具名格式为 `mcp--{sanitizedServer}--{sanitizedTool}`，
	* 因此用 `mcp--{server}--` 前缀匹配。
	*/
function isPreloadMcpTool(toolName: string, mode: string | undefined): boolean {
	if (!mode) return false
	const servers = MODE_PRELOAD_MCP_SERVERS[mode]
	if (!servers || servers.length === 0) return false
	return servers.some((server) => toolName.startsWith(`mcp--${server}--`))
}

/**
	* 延迟工具的精简描述，用于在系统提示中列出可搜索的工具。
	*/
export interface DeferredToolInfo {
	name: string
	description: string
}

/**
 * 延迟加载的构建结果，包含直接加载的工具和延迟工具列表。
 */
export interface DeferredLoadingResult {
	/** 直接加载的工具（包含完整 schema） */
	tools: OpenAI.Chat.ChatCompletionTool[]
	/** 被延迟的工具信息（仅名称和描述，供 tool_search 使用） */
	deferredTools: DeferredToolInfo[]
	/** 是否启用了延迟加载 */
	isDeferredLoadingEnabled: boolean
}

interface BuildToolsOptions {
	provider: ClineProvider
	cwd: string
	mode: string | undefined
	customModes: ModeConfig[] | undefined
	experiments: Record<string, boolean> | undefined
	apiConfiguration: ProviderSettings | undefined
	disabledTools?: string[]
	modelInfo?: ModelInfo
	/**
	 * If true, returns all tools without mode filtering, but also includes
	 * the list of allowed tool names for use with allowedFunctionNames.
	 * This enables providers that support function call restrictions (e.g., Gemini)
	 * to pass all tool definitions while restricting callable tools.
	 */
	includeAllToolsWithRestrictions?: boolean
}

interface BuildToolsResult {
	/**
	 * The tools to pass to the model.
	 * If includeAllToolsWithRestrictions is true, this includes ALL tools.
	 * Otherwise, it includes only mode-filtered tools.
	 */
	tools: OpenAI.Chat.ChatCompletionTool[]
	/**
	 * The names of tools that are allowed to be called based on mode restrictions.
	 * Only populated when includeAllToolsWithRestrictions is true.
	 * Use this with allowedFunctionNames in providers that support it.
	 */
	allowedFunctionNames?: string[]
}

/**
 * Extracts the function name from a tool definition.
 */
function getToolName(tool: OpenAI.Chat.ChatCompletionTool): string {
	return (tool as OpenAI.Chat.ChatCompletionFunctionTool).function.name
}

/**
 * 判断一个工具是否为核心工具（不应被延迟加载）。
 * 核心工具始终包含在系统提示中，MCP 工具默认为非核心（可延迟）。
 *
 * @param tool - 工具定义
 * @param mode - 当前模式（用于判断模式特定的预加载白名单）
 */
function isCoreNativeTool(tool: OpenAI.Chat.ChatCompletionTool, mode?: string): boolean {
	const name = getToolName(tool)
	// 全局核心工具
	if (CORE_TOOL_NAMES.has(name)) return true
	// 模式特定的 MCP 预加载白名单
	if (isPreloadMcpTool(name, mode)) return true
	return false
}

/**
 * 从工具定义中提取精简描述信息。
 */
function extractDeferredToolInfo(tool: OpenAI.Chat.ChatCompletionTool): DeferredToolInfo {
	const fn = (tool as OpenAI.Chat.ChatCompletionFunctionTool).function
	return {
		name: fn.name,
		description: fn.description ?? "",
	}
}

/**
 * 对工具列表应用延迟加载策略。
 * 当工具总数超过 DEFERRED_LOADING_THRESHOLD 时：
 * - 核心原生工具直接加载
 * - MCP 工具和非核心工具标记为可搜索（延迟加载）
 * - 自动包含 tool_search 工具
 *
 * @param allTools - 所有已过滤的工具（原生 + MCP + 自定义）
 * @param mode - 当前模式，用于查询模式特定的 MCP 预加载白名单
 * @returns 延迟加载结果
 */
export function applyDeferredLoading(
	allTools: OpenAI.Chat.ChatCompletionTool[],
	mode?: string,
): DeferredLoadingResult {
	if (allTools.length <= DEFERRED_LOADING_THRESHOLD) {
		return {
			tools: allTools,
			deferredTools: [],
			isDeferredLoadingEnabled: false,
		}
	}

	const coreTools: OpenAI.Chat.ChatCompletionTool[] = []
	const deferredTools: DeferredToolInfo[] = []

	for (const tool of allTools) {
		if (isCoreNativeTool(tool, mode)) {
			coreTools.push(tool)
		} else {
			deferredTools.push(extractDeferredToolInfo(tool))
		}
	}

	// 确保 tool_search 工具在核心工具中（如果还没有的话）
	const hasToolSearch = coreTools.some((t) => getToolName(t) === "tool_search")
	if (!hasToolSearch) {
		// tool_search 应该已经在 nativeTools 中，但如果被模式过滤掉了，
		// 需要从原始工具列表中找回来
		const toolSearchTool = allTools.find((t) => getToolName(t) === "tool_search")
		if (toolSearchTool) {
			coreTools.push(toolSearchTool)
		}
	}

	return {
		tools: coreTools,
		deferredTools,
		isDeferredLoadingEnabled: true,
	}
}

/**
 * 全局存储当前会话的延迟工具列表，供 ToolSearchTool 执行时查询。
 */
let currentDeferredTools: DeferredToolInfo[] = []
let currentAllFilteredTools: OpenAI.Chat.ChatCompletionTool[] = []

/**
 * 获取当前延迟工具列表。
 */
export function getDeferredTools(): DeferredToolInfo[] {
	return currentDeferredTools
}

/**
 * 获取当前所有已过滤的工具（包含完整 schema），供 tool_search 加载延迟工具时使用。
 */
export function getAllFilteredTools(): OpenAI.Chat.ChatCompletionTool[] {
	return currentAllFilteredTools
}

/**
 * 清除延迟工具状态（任务结束时调用）。
 */
export function clearDeferredToolsState(): void {
	currentDeferredTools = []
	currentAllFilteredTools = []
}

/**
 * Builds the complete tools array for native protocol requests.
 * Combines native tools and MCP tools, filtered by mode restrictions.
 *
 * @param options - Configuration options for building the tools
 * @returns Array of filtered native and MCP tools
 */
export async function buildNativeToolsArray(options: BuildToolsOptions): Promise<OpenAI.Chat.ChatCompletionTool[]> {
	const result = await buildNativeToolsArrayWithRestrictions(options)
	return result.tools
}

/**
 * Builds the complete tools array for native protocol requests with optional mode restrictions.
 * When includeAllToolsWithRestrictions is true, returns ALL tools but also provides
 * the list of allowed tool names for use with allowedFunctionNames.
 *
 * This enables providers like Gemini to pass all tool definitions to the model
 * (so it can reference historical tool calls) while restricting which tools
 * can actually be invoked via allowedFunctionNames in toolConfig.
 *
 * @param options - Configuration options for building the tools
 * @returns BuildToolsResult with tools array and optional allowedFunctionNames
 */
export async function buildNativeToolsArrayWithRestrictions(options: BuildToolsOptions): Promise<BuildToolsResult> {
	const {
		provider,
		cwd,
		mode,
		customModes,
		experiments,
		apiConfiguration,
		disabledTools,
		modelInfo,
		includeAllToolsWithRestrictions,
	} = options

	const mcpHub = provider.getMcpHub()

	// Get CodeIndexManager for feature checking.
	const { CodeIndexManager } = await import("../../services/code-index/manager")
	const codeIndexManager = CodeIndexManager.getInstance(provider.context, cwd)

	// Build settings object for tool filtering.
	const filterSettings = {
		todoListEnabled: apiConfiguration?.todoListEnabled ?? true,
		disabledTools,
		modelInfo,
	}

	// Check if the model supports images for read_file tool description.
	const supportsImages = modelInfo?.supportsImages ?? false

	// Build native tools with dynamic read_file tool based on settings.
	const nativeTools = getNativeTools({
		supportsImages,
	})

	// Filter native tools based on mode restrictions.
	const filteredNativeTools = filterNativeToolsForMode(
		nativeTools,
		mode,
		customModes,
		experiments,
		codeIndexManager,
		filterSettings,
		mcpHub,
	)

	// Filter MCP tools based on mode restrictions.
	const mcpTools = getMcpServerTools(mcpHub)
	const filteredMcpTools = filterMcpToolsForMode(mcpTools, mode, customModes, experiments)

	// Add custom tools if they are available and the experiment is enabled.
	let nativeCustomTools: OpenAI.Chat.ChatCompletionFunctionTool[] = []

	if (experiments?.customTools) {
		const toolDirs = getRooDirectoriesForCwd(cwd).map((dir) => path.join(dir, "tools"))
		await customToolRegistry.loadFromDirectoriesIfStale(toolDirs)
		const customTools = customToolRegistry.getAllSerialized()

		if (customTools.length > 0) {
			nativeCustomTools = customTools.map(formatNative)
		}
	}

	// Combine filtered tools (for backward compatibility and for allowedFunctionNames)
	const filteredTools = [...filteredNativeTools, ...filteredMcpTools, ...nativeCustomTools]

	// 保存所有已过滤工具的完整列表（供 tool_search 使用）
	currentAllFilteredTools = filteredTools

	// 应用延迟加载策略（传入 mode 以便查询模式特定的 MCP 预加载白名单）
	const deferredResult = applyDeferredLoading(filteredTools, mode)
	currentDeferredTools = deferredResult.deferredTools

	// If includeAllToolsWithRestrictions is true, return ALL tools but provide
	// allowed names based on mode filtering
	if (includeAllToolsWithRestrictions) {
		// Combine ALL tools (unfiltered native + all MCP + custom)
		const allTools = [...nativeTools, ...mcpTools, ...nativeCustomTools]

		// Extract names of tools that are allowed based on mode filtering.
		// Resolve any alias names to canonical names to ensure consistency with allTools
		// (which uses canonical names). This prevents Gemini errors when tools are renamed
		// to aliases in filteredTools but allTools contains the original canonical names.
		const allowedFunctionNames = filteredTools.map((tool) => resolveToolAlias(getToolName(tool)))

		return {
			tools: allTools,
			allowedFunctionNames,
		}
	}

	// Default behavior: return tools with deferred loading applied
	return {
		tools: deferredResult.tools,
	}
}

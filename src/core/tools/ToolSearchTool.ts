import type { ToolUse, ToolResponse, AskApproval, HandleError, PushToolResult } from "../../shared/tools"
import type { Task } from "../task/Task"
import { getDeferredTools, getAllFilteredTools, type DeferredToolInfo } from "../task/build-tools"

interface ToolSearchToolHandlerOptions {
	askApproval: AskApproval
	handleError: HandleError
	pushToolResult: PushToolResult
}

/**
 * tool_search 工具处理器
 *
 * 当延迟加载启用时，模型可以通过此工具搜索并加载延迟工具。
 * 支持两种查询模式：
 * - "select:toolName" — 精确选择工具
 * - "keyword" — 关键词搜索
 */
class ToolSearchToolHandler {
	async handle(cline: Task, block: ToolUse<"tool_search">, options: ToolSearchToolHandlerOptions): Promise<void> {
		const { pushToolResult, handleError } = options

		try {
			const query = block.params.query ?? block.nativeArgs?.query
			const maxResults = block.nativeArgs?.max_results ?? 5

			if (!query) {
				pushToolResult("Error: query parameter is required for tool_search.")
				return
			}

			const deferredTools = getDeferredTools()
			const allTools = getAllFilteredTools()

			if (deferredTools.length === 0) {
				pushToolResult("No deferred tools available. All tools are already loaded.")
				return
			}

			// 处理 select: 前缀 — 精确选择工具
			const selectMatch = query.match(/^select:(.+)$/i)
			if (selectMatch) {
				const requested = selectMatch[1]!
					.split(",")
					.map((s: string) => s.trim())
					.filter(Boolean)

				const found: string[] = []
				const missing: string[] = []

				for (const toolName of requested) {
					const lowerName = toolName.toLowerCase()
					const match = allTools.find((t) => (t as any).function?.name?.toLowerCase() === lowerName)
					if (match) {
						found.push((match as any).function.name)
					} else {
						missing.push(toolName)
					}
				}

				if (found.length === 0) {
					pushToolResult(
						`No tools found matching: ${missing.join(", ")}. ` +
							`Available deferred tools: ${deferredTools.map((t) => t.name).join(", ")}`,
					)
					return
				}

				// 返回匹配工具的完整 schema
				const schemas = found
					.map((name) => {
						const tool = allTools.find((t) => (t as any).function?.name === name)
						if (!tool) return null
						return JSON.stringify((tool as any).function, null, 2)
					})
					.filter(Boolean)

				let result = `Found ${found.length} tool(s):\n\n`
				result += schemas.join("\n\n")
				if (missing.length > 0) {
					result += `\n\nNot found: ${missing.join(", ")}`
				}

				pushToolResult(result)
				return
			}

			// 关键词搜索
			const matches = searchDeferredTools(query, deferredTools, allTools, maxResults)

			if (matches.length === 0) {
				pushToolResult(
					`No deferred tools found matching "${query}". ` +
						`Available deferred tools: ${deferredTools.map((t) => t.name).join(", ")}`,
				)
				return
			}

			// 返回匹配工具的完整 schema
			const schemas = matches
				.map((name) => {
					const tool = allTools.find((t) => (t as any).function?.name === name)
					if (!tool) return null
					return JSON.stringify((tool as any).function, null, 2)
				})
				.filter(Boolean)

			let result = `Found ${matches.length} matching tool(s):\n\n`
			result += schemas.join("\n\n")
			result += `\n\nTotal deferred tools: ${deferredTools.length}`

			pushToolResult(result)
		} catch (error) {
			await handleError("tool_search", error instanceof Error ? error : new Error(String(error)))
		}
	}
}

/**
 * 在延迟工具列表中按关键词搜索。
 * 对工具名称和描述进行匹配，返回得分最高的结果。
 */
function searchDeferredTools(
	query: string,
	deferredTools: DeferredToolInfo[],
	allTools: any[],
	maxResults: number,
): string[] {
	const queryLower = query.toLowerCase().trim()
	const queryTerms = queryLower.split(/\s+/).filter((term) => term.length > 0)

	// 精确名称匹配优先
	const exactMatch = deferredTools.find((t) => t.name.toLowerCase() === queryLower)
	if (exactMatch) {
		return [exactMatch.name]
	}

	// 评分搜索
	const scored = deferredTools.map((tool) => {
		const nameLower = tool.name.toLowerCase()
		const descLower = tool.description.toLowerCase()

		// 解析工具名称为可搜索的部分（处理 mcp__server__action 和 camelCase）
		const nameParts = parseToolNameParts(nameLower)

		let score = 0
		for (const term of queryTerms) {
			// 名称部分精确匹配（高权重）
			if (nameParts.includes(term)) {
				score += 10
			} else if (nameParts.some((part) => part.includes(term))) {
				score += 5
			}

			// 完整名称包含
			if (nameLower.includes(term)) {
				score += 3
			}

			// 描述匹配
			if (descLower.includes(term)) {
				score += 2
			}
		}

		return { name: tool.name, score }
	})

	return scored
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, maxResults)
		.map((item) => item.name)
}

/**
 * 将工具名称解析为可搜索的部分。
 * 处理 MCP 工具名（mcp__server__action）和 camelCase 名称。
 */
function parseToolNameParts(name: string): string[] {
	// MCP 工具
	if (name.startsWith("mcp_")) {
		return name.replace(/^mcp_/, "").split("_").filter(Boolean)
	}

	// 普通工具 — 按下划线和 camelCase 分割
	return name
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/_/g, " ")
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
}

export const toolSearchTool = new ToolSearchToolHandler()

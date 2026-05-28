import type OpenAI from "openai"

/**
 * tool_search 工具定义
 *
 * 当可用工具总数超过阈值时启用，允许模型按关键词搜索并加载延迟工具。
 * 延迟工具在初始提示中只显示名称，不包含完整 schema，
 * 模型需要通过 tool_search 获取完整定义后才能调用。
 */
const toolSearch: OpenAI.Chat.ChatCompletionTool = {
	type: "function",
	function: {
		name: "tool_search",
		description: `Search and load deferred tools by keyword or exact name. Deferred tools are listed by name only in the system prompt — their full parameter schema is not available until fetched via this tool. Once fetched, the tool becomes callable like any other tool.

Query forms:
- "select:toolName1,toolName2" — fetch exact tools by name (comma-separated for multiple)
- "keyword1 keyword2" — keyword search, returns up to max_results best matches

Use this tool when you need a tool that is listed as deferred but not yet loaded.`,
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description:
						'Search query. Use "select:<tool_name>" for direct selection, or keywords to search. Supports comma-separated multi-select: "select:A,B,C".',
				},
				max_results: {
					type: "number",
					description: "Maximum number of results to return (default: 5)",
				},
			},
			required: ["query"],
			additionalProperties: false,
		},
	},
}

export default toolSearch

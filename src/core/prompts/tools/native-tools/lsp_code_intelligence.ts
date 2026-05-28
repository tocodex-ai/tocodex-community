import type OpenAI from "openai"

const LSP_DESCRIPTION = `Request to perform code intelligence operations using the Language Server Protocol (LSP). This tool provides precise, compiler-level code analysis including jump-to-definition, find-all-references, hover information, document symbols, and call hierarchy.

Use this tool instead of grep/search when you need to:
- Find the exact definition of a function, class, or variable
- Find all references to a symbol across the codebase
- Get type information or documentation for a symbol
- List all symbols (functions, classes, variables) in a file
- Trace call hierarchies (who calls this function, what does it call)

Parameters:
- operation: (required) The LSP operation to perform. One of: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, prepareCallHierarchy, incomingCalls, outgoingCalls
- filePath: (required) The file path (relative to workspace root)
- line: (required for most operations) The 1-based line number
- character: (required for most operations) The 1-based column number
- symbol: (optional) Search query for workspaceSymbol operation

Notes:
- documentSymbol only requires filePath (no line/character needed)
- workspaceSymbol only requires symbol (no filePath/line/character needed)
- All other operations require filePath, line, and character`

export default {
	type: "function",
	function: {
		name: "lsp_code_intelligence",
		description: LSP_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				operation: {
					type: "string",
					enum: [
						"goToDefinition",
						"findReferences",
						"hover",
						"documentSymbol",
						"workspaceSymbol",
						"prepareCallHierarchy",
						"incomingCalls",
						"outgoingCalls",
					],
					description: "The LSP operation to perform",
				},
				filePath: {
					type: ["string", "null"],
					description: "File path relative to workspace root",
				},
				line: {
					type: ["number", "null"],
					description: "1-based line number",
				},
				character: {
					type: ["number", "null"],
					description: "1-based column number",
				},
				symbol: {
					type: ["string", "null"],
					description: "Search query for workspaceSymbol operation",
				},
			},
			required: ["operation", "filePath", "line", "character", "symbol"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

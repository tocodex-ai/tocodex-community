/**
 * LspTool — LSP 代码智能工具
 *
 * 通过 VSCode 内置 LSP 命令提供精准的代码智能功能：
 * 跳转定义、查找引用、悬停提示、文档符号、调用层级等。
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

import * as vscode from "vscode"
import * as path from "path"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"

export type LspOperation =
	| "goToDefinition"
	| "findReferences"
	| "hover"
	| "documentSymbol"
	| "workspaceSymbol"
	| "prepareCallHierarchy"
	| "incomingCalls"
	| "outgoingCalls"

export interface LspToolParams {
	operation: LspOperation
	/** 文件路径（相对或绝对） */
	filePath: string | null
	/** 行号（1-based） */
	line?: number | null
	/** 列号（1-based） */
	character?: number | null
	/** workspaceSymbol 时的搜索关键词 */
	symbol?: string | null
}

/** VSCode LSP 命令映射 */
const LSP_COMMANDS: Record<LspOperation, string> = {
	goToDefinition: "vscode.executeDefinitionProvider",
	findReferences: "vscode.executeReferenceProvider",
	hover: "vscode.executeHoverProvider",
	documentSymbol: "vscode.executeDocumentSymbolProvider",
	workspaceSymbol: "vscode.executeWorkspaceSymbolProvider",
	prepareCallHierarchy: "vscode.prepareCallHierarchy",
	incomingCalls: "vscode.provideIncomingCalls",
	outgoingCalls: "vscode.provideOutgoingCalls",
}

export class LspTool extends BaseTool<"lsp_code_intelligence"> {
	readonly name = "lsp_code_intelligence" as const

	async execute(params: LspToolParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult, handleError } = callbacks

		try {
			const result = await this.runLspOperation(params, task.cwd)
			pushToolResult(result)
		} catch (error) {
			await handleError("LSP 操作", error as Error)
		}
	}

	private async runLspOperation(params: LspToolParams, cwd: string): Promise<string> {
		const { operation, filePath, line, character, symbol } = params

		// workspaceSymbol 不需要位置信息
		if (operation === "workspaceSymbol") {
			return this.executeWorkspaceSymbol(symbol ?? "")
		}

		// 其他操作需要文件路径
		if (!filePath) {
			return `错误：操作 ${operation} 需要提供 filePath 参数`
		}

		// 解析文件路径
		const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath)
		const uri = vscode.Uri.file(absolutePath)

		// documentSymbol 只需要文件路径
		if (operation === "documentSymbol") {
			return this.executeDocumentSymbol(uri)
		}

		// 其他操作需要位置信息
		if (line == null || character == null) {
			return `错误：操作 ${operation} 需要提供 line 和 character 参数`
		}

		// VSCode 使用 0-based 位置，用户输入 1-based
		const position = new vscode.Position(line - 1, character - 1)

		switch (operation) {
			case "goToDefinition":
				return this.executeDefinition(uri, position, cwd)
			case "findReferences":
				return this.executeReferences(uri, position, cwd)
			case "hover":
				return this.executeHover(uri, position)
			// documentSymbol 在 line 83 已提前处理并 return，此处不再涉及
			case "prepareCallHierarchy":
				return this.executeCallHierarchy(uri, position, cwd)
			case "incomingCalls":
				return this.executeIncomingCalls(uri, position, cwd)
			case "outgoingCalls":
				return this.executeOutgoingCalls(uri, position, cwd)
			default:
				return `不支持的操作: ${operation}`
		}
	}

	private async executeDefinition(uri: vscode.Uri, position: vscode.Position, cwd: string): Promise<string> {
		try {
			const locations = await vscode.commands.executeCommand<vscode.Location[]>(
				LSP_COMMANDS.goToDefinition,
				uri,
				position,
			)

			if (!locations || locations.length === 0) {
				return "未找到定义。建议使用 search_files 进行文本搜索作为替代。"
			}

			const lines = [`找到 ${locations.length} 个定义：`]
			for (const loc of locations) {
				const relPath = path.relative(cwd, loc.uri.fsPath)
				const line = loc.range.start.line + 1
				const col = loc.range.start.character + 1
				lines.push(`  ${relPath}:${line}:${col}`)
			}
			return lines.join("\n")
		} catch (error) {
			return this.formatLspError("goToDefinition", error)
		}
	}

	private async executeReferences(uri: vscode.Uri, position: vscode.Position, cwd: string): Promise<string> {
		try {
			const locations = await vscode.commands.executeCommand<vscode.Location[]>(
				LSP_COMMANDS.findReferences,
				uri,
				position,
				{ includeDeclaration: true },
			)

			if (!locations || locations.length === 0) {
				return "未找到引用。建议使用 search_files 进行文本搜索作为替代。"
			}

			const lines = [`找到 ${locations.length} 个引用：`]
			for (const loc of locations) {
				const relPath = path.relative(cwd, loc.uri.fsPath)
				const line = loc.range.start.line + 1
				const col = loc.range.start.character + 1
				lines.push(`  ${relPath}:${line}:${col}`)
			}
			return lines.join("\n")
		} catch (error) {
			return this.formatLspError("findReferences", error)
		}
	}

	private async executeHover(uri: vscode.Uri, position: vscode.Position): Promise<string> {
		try {
			const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(LSP_COMMANDS.hover, uri, position)

			if (!hovers || hovers.length === 0) {
				return "无悬停信息。该位置可能不是一个可识别的符号。"
			}

			const parts: string[] = []
			for (const hover of hovers) {
				for (const content of hover.contents) {
					if (typeof content === "string") {
						parts.push(content)
					} else if ("value" in content) {
						parts.push(content.value)
					}
				}
			}
			return parts.join("\n\n") || "无悬停信息"
		} catch (error) {
			return this.formatLspError("hover", error)
		}
	}

	private async executeDocumentSymbol(uri: vscode.Uri): Promise<string> {
		try {
			const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
				LSP_COMMANDS.documentSymbol,
				uri,
			)

			if (!symbols || symbols.length === 0) {
				return "未找到文档符号。该文件可能为空或语言服务器尚未索引。"
			}

			const lines = [`文档符号（${symbols.length} 个顶级符号）：`]
			this.formatSymbols(symbols, lines, 0)
			return lines.join("\n")
		} catch (error) {
			return this.formatLspError("documentSymbol", error)
		}
	}

	private formatSymbols(symbols: vscode.DocumentSymbol[], lines: string[], depth: number): void {
		const indent = "  ".repeat(depth)
		for (const sym of symbols) {
			const kindName = vscode.SymbolKind[sym.kind] ?? "Unknown"
			const line = sym.range.start.line + 1
			lines.push(`${indent}${kindName} ${sym.name} (行 ${line})`)
			if (sym.children && sym.children.length > 0) {
				this.formatSymbols(sym.children, lines, depth + 1)
			}
		}
	}

	private async executeWorkspaceSymbol(query: string): Promise<string> {
		try {
			const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
				LSP_COMMANDS.workspaceSymbol,
				query,
			)

			if (!symbols || symbols.length === 0) {
				return `未找到符号: "${query}"。建议使用 search_files 进行文本搜索作为替代。`
			}

			const lines = [`找到 ${symbols.length} 个工作区符号：`]
			for (const sym of symbols.slice(0, 20)) {
				const kindName = vscode.SymbolKind[sym.kind] ?? "Unknown"
				const filePath = sym.location.uri.fsPath
				const line = sym.location.range.start.line + 1
				lines.push(`  ${kindName} ${sym.name} — ${filePath}:${line}`)
			}
			if (symbols.length > 20) {
				lines.push(`  ... 还有 ${symbols.length - 20} 个结果`)
			}
			return lines.join("\n")
		} catch (error) {
			return this.formatLspError("workspaceSymbol", error)
		}
	}

	private async executeCallHierarchy(uri: vscode.Uri, position: vscode.Position, cwd: string): Promise<string> {
		try {
			const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
				LSP_COMMANDS.prepareCallHierarchy,
				uri,
				position,
			)

			if (!items || items.length === 0) {
				return "未找到调用层级信息。该位置可能不是一个函数/方法。"
			}

			const lines = [`调用层级（${items.length} 个入口）：`]
			for (const item of items) {
				const relPath = path.relative(cwd, item.uri.fsPath)
				const line = item.range.start.line + 1
				lines.push(`  ${item.name} — ${relPath}:${line}`)
			}
			return lines.join("\n")
		} catch (error) {
			return this.formatLspError("prepareCallHierarchy", error)
		}
	}

	private async executeIncomingCalls(uri: vscode.Uri, position: vscode.Position, cwd: string): Promise<string> {
		try {
			const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
				LSP_COMMANDS.prepareCallHierarchy,
				uri,
				position,
			)
			if (!items || items.length === 0) return "未找到调用层级信息。该位置可能不是一个函数/方法。"

			const calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
				LSP_COMMANDS.incomingCalls,
				items[0],
			)

			if (!calls || calls.length === 0) return "没有调用者（该函数未被其他代码调用）"

			const lines = [`调用者（${calls.length} 个）：`]
			for (const call of calls) {
				const relPath = path.relative(cwd, call.from.uri.fsPath)
				const line = call.from.range.start.line + 1
				lines.push(`  ${call.from.name} — ${relPath}:${line}`)
			}
			return lines.join("\n")
		} catch (error) {
			return this.formatLspError("incomingCalls", error)
		}
	}

	private async executeOutgoingCalls(uri: vscode.Uri, position: vscode.Position, cwd: string): Promise<string> {
		try {
			const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
				LSP_COMMANDS.prepareCallHierarchy,
				uri,
				position,
			)
			if (!items || items.length === 0) return "未找到调用层级信息。该位置可能不是一个函数/方法。"

			const calls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
				LSP_COMMANDS.outgoingCalls,
				items[0],
			)

			if (!calls || calls.length === 0) return "没有被调用者（该函数未调用其他函数）"

			const lines = [`被调用者（${calls.length} 个）：`]
			for (const call of calls) {
				const relPath = path.relative(cwd, call.to.uri.fsPath)
				const line = call.to.range.start.line + 1
				lines.push(`  ${call.to.name} — ${relPath}:${line}`)
			}
			return lines.join("\n")
		} catch (error) {
			return this.formatLspError("outgoingCalls", error)
		}
	}

	/**
	 * 格式化 LSP 错误信息，提供具体的失败原因和降级建议。
	 * 让 AI 能区分不同的失败类型并做出有效的重试或降级决策。
	 */
	private formatLspError(operation: string, error: unknown): string {
		const msg = error instanceof Error ? error.message : String(error)
		const lowerMsg = msg.toLowerCase()

		if (lowerMsg.includes("no provider") || lowerMsg.includes("not registered")) {
			return `LSP 错误 (${operation}): 该文件类型没有可用的语言服务器。请使用 search_files 进行文本搜索作为替代。`
		}
		if (lowerMsg.includes("not found") || lowerMsg.includes("enoent")) {
			return `LSP 错误 (${operation}): 文件不存在。请检查文件路径是否正确。`
		}
		if (lowerMsg.includes("timeout") || lowerMsg.includes("timed out")) {
			return `LSP 错误 (${operation}): 语言服务器响应超时。服务器可能正在初始化，请稍后重试或使用 search_files 作为替代。`
		}
		return `LSP 错误 (${operation}): ${msg}。请使用 search_files 进行文本搜索作为替代。`
	}
}

export const lspTool = new LspTool()

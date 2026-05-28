/**
 * NotebookEditTool — Jupyter Notebook 编辑工具
 *
 * 支持对 .ipynb 文件的单元格进行 replace/insert/delete 操作，
 * 保留原有的 outputs 不变。
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4
 */

import * as path from "path"
import fs from "fs/promises"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"

export type NotebookEditOperation = "replace" | "insert" | "delete"

export interface NotebookEditParams {
	path: string
	operation: string
	cellIndex: number
	cellType: string | null
	content: string | null
}

/** Jupyter Notebook 单元格结构 */
export interface JupyterCell {
	cell_type: "code" | "markdown" | "raw"
	source: string[]
	outputs?: unknown[]
	execution_count?: number | null
	metadata?: Record<string, unknown>
	id?: string
}

/** Jupyter Notebook 文件结构 */
export interface JupyterNotebook {
	nbformat: number
	nbformat_minor: number
	metadata: Record<string, unknown>
	cells: JupyterCell[]
}

/**
 * 验证文件是否为有效的 Jupyter Notebook 格式
 */
export function validateNotebook(data: unknown): data is JupyterNotebook {
	if (typeof data !== "object" || data === null) return false
	const nb = data as Record<string, unknown>
	if (typeof nb.nbformat !== "number") return false
	if (!Array.isArray(nb.cells)) return false
	return true
}

/**
 * 将字符串内容转换为 Jupyter source 数组格式
 * Jupyter 的 source 字段是按行分割的字符串数组，每行末尾保留 \n（最后一行除外）
 */
export function contentToSourceArray(content: string): string[] {
	if (!content) return [""]
	const lines = content.split("\n")
	return lines.map((line, i) => (i < lines.length - 1 ? line + "\n" : line))
}

export class NotebookEditTool extends BaseTool<"notebook_edit"> {
	readonly name = "notebook_edit" as const

	async execute(params: NotebookEditParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult } = callbacks
		const { path: relPath, operation, cellIndex, cellType, content } = params

		// 参数验证
		if (!relPath) {
			task.consecutiveMistakeCount++
			task.recordToolError("notebook_edit")
			const errorMsg = await task.sayAndCreateMissingParamError("notebook_edit", "path")
			pushToolResult(`Error: ${errorMsg}`)
			return
		}

		if (!operation) {
			task.consecutiveMistakeCount++
			task.recordToolError("notebook_edit")
			const errorMsg = await task.sayAndCreateMissingParamError("notebook_edit", "operation")
			pushToolResult(`Error: ${errorMsg}`)
			return
		}

		if (cellIndex == null || cellIndex < 0) {
			task.consecutiveMistakeCount++
			task.recordToolError("notebook_edit")
			pushToolResult("Error: cellIndex 必须是非负整数")
			return
		}

		// 验证操作类型
		if (operation !== "replace" && operation !== "insert" && operation !== "delete") {
			task.consecutiveMistakeCount++
			task.recordToolError("notebook_edit")
			pushToolResult(`Error: operation 必须是 replace、insert 或 delete，收到: ${operation}`)
			return
		}

		// replace 和 insert 需要 content
		if ((operation === "replace" || operation === "insert") && (content == null || content === "")) {
			task.consecutiveMistakeCount++
			task.recordToolError("notebook_edit")
			pushToolResult(`Error: ${operation} 操作需要提供 content 参数`)
			return
		}

		// insert 需要 cellType
		if (operation === "insert" && !cellType) {
			task.consecutiveMistakeCount++
			task.recordToolError("notebook_edit")
			pushToolResult("Error: insert 操作需要提供 cellType 参数（code 或 markdown）")
			return
		}

		// 验证文件扩展名
		if (!relPath.endsWith(".ipynb")) {
			task.consecutiveMistakeCount++
			task.recordToolError("notebook_edit")
			pushToolResult("Error: 文件必须是 Jupyter Notebook（.ipynb）格式。请使用 write_to_file 编辑其他文件类型。")
			return
		}

		// 检查 rooIgnore 权限
		const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)
		if (!accessAllowed) {
			await task.say("rooignore_error", relPath)
			pushToolResult(formatResponse.rooIgnoreError(relPath))
			return
		}

		task.consecutiveMistakeCount = 0

		// 解析绝对路径
		const absolutePath = path.isAbsolute(relPath) ? relPath : path.join(task.cwd, relPath)

		try {
			const result = await this.editNotebook(absolutePath, operation, cellIndex, cellType, content)
			pushToolResult(result)
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			task.didToolFailInCurrentTurn = true
			pushToolResult(`Error: 编辑 Notebook 失败 — ${errorMsg}`)
		}
	}

	/**
	 * 执行 Notebook 编辑操作
	 */
	private async editNotebook(
		absolutePath: string,
		operation: NotebookEditOperation,
		cellIndex: number,
		cellType?: string | null,
		content?: string | null,
	): Promise<string> {
		// 读取文件
		let rawContent: string
		try {
			rawContent = await fs.readFile(absolutePath, "utf8")
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new Error(`Notebook 文件不存在: ${absolutePath}`)
			}
			throw error
		}

		// 解析 JSON
		let notebook: JupyterNotebook
		try {
			const parsed = JSON.parse(rawContent)
			if (!validateNotebook(parsed)) {
				throw new Error("文件不是有效的 Jupyter Notebook 格式（缺少 nbformat 或 cells 字段）")
			}
			notebook = parsed
		} catch (error) {
			if (error instanceof SyntaxError) {
				throw new Error("文件不是有效的 JSON 格式")
			}
			throw error
		}

		const totalCells = notebook.cells.length

		switch (operation) {
			case "replace":
				return this.replaceCell(notebook, absolutePath, cellIndex, totalCells, cellType, content!)

			case "insert":
				return this.insertCell(notebook, absolutePath, cellIndex, totalCells, cellType!, content!)

			case "delete":
				return this.deleteCell(notebook, absolutePath, cellIndex, totalCells)

			default:
				throw new Error(`不支持的操作: ${operation}`)
		}
	}

	/**
	 * 替换单元格内容（Requirements: 14.2, 14.3 — 保留 outputs）
	 */
	private async replaceCell(
		notebook: JupyterNotebook,
		absolutePath: string,
		cellIndex: number,
		totalCells: number,
		cellType?: string | null,
		content: string = "",
	): Promise<string> {
		if (cellIndex >= totalCells) {
			throw new Error(
				`cellIndex ${cellIndex} 超出范围，Notebook 共有 ${totalCells} 个单元格（索引 0-${totalCells - 1}）`,
			)
		}

		const cell = notebook.cells[cellIndex]
		const sourceArray = contentToSourceArray(content)

		// 更新 source
		cell.source = sourceArray

		// 如果指定了 cellType 且与当前不同，更新类型
		if (cellType && (cellType === "code" || cellType === "markdown") && cellType !== cell.cell_type) {
			cell.cell_type = cellType
		}

		// Requirements 14.3: 代码单元格被修改时，保留 outputs 结构但清空执行计数
		// 注意：我们保留 outputs 数组本身不变，只重置 execution_count
		if (cell.cell_type === "code") {
			cell.execution_count = null
		}

		await this.writeNotebook(absolutePath, notebook)
		return `已替换单元格 ${cellIndex}（${cell.cell_type}），共 ${sourceArray.length} 行`
	}

	/**
	 * 插入新单元格（Requirements: 14.2）
	 */
	private async insertCell(
		notebook: JupyterNotebook,
		absolutePath: string,
		cellIndex: number,
		totalCells: number,
		cellType: string,
		content: string,
	): Promise<string> {
		// 允许在末尾插入（cellIndex == totalCells）
		if (cellIndex > totalCells) {
			throw new Error(
				`cellIndex ${cellIndex} 超出范围，Notebook 共有 ${totalCells} 个单元格（可插入位置 0-${totalCells}）`,
			)
		}

		const validCellType = cellType === "markdown" ? "markdown" : "code"
		const sourceArray = contentToSourceArray(content)

		const newCell: JupyterCell = {
			cell_type: validCellType,
			source: sourceArray,
			metadata: {},
		}

		// 代码单元格需要 outputs 和 execution_count
		if (validCellType === "code") {
			newCell.outputs = []
			newCell.execution_count = null
		}

		// 如果 notebook 版本 >= 4.5，生成 cell id
		if (notebook.nbformat > 4 || (notebook.nbformat === 4 && notebook.nbformat_minor >= 5)) {
			newCell.id = Math.random().toString(36).substring(2, 15)
		}

		notebook.cells.splice(cellIndex, 0, newCell)

		await this.writeNotebook(absolutePath, notebook)
		return `已在位置 ${cellIndex} 插入新的 ${validCellType} 单元格，共 ${sourceArray.length} 行`
	}

	/**
	 * 删除单元格（Requirements: 14.2）
	 */
	private async deleteCell(
		notebook: JupyterNotebook,
		absolutePath: string,
		cellIndex: number,
		totalCells: number,
	): Promise<string> {
		if (cellIndex >= totalCells) {
			throw new Error(
				`cellIndex ${cellIndex} 超出范围，Notebook 共有 ${totalCells} 个单元格（索引 0-${totalCells - 1}）`,
			)
		}

		const removedCell = notebook.cells[cellIndex]
		notebook.cells.splice(cellIndex, 1)

		await this.writeNotebook(absolutePath, notebook)
		return `已删除单元格 ${cellIndex}（${removedCell.cell_type}），剩余 ${notebook.cells.length} 个单元格`
	}

	/**
	 * 将修改后的 Notebook 写回文件
	 */
	private async writeNotebook(absolutePath: string, notebook: JupyterNotebook): Promise<void> {
		const updatedContent = JSON.stringify(notebook, null, 1)
		await fs.writeFile(absolutePath, updatedContent, "utf8")
	}
}

export const notebookEditTool = new NotebookEditTool()

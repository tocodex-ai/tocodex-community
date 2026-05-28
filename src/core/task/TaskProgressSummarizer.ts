/**
 * TaskProgressSummarizer — 实时任务进度摘要
 *
 * 追踪工具调用记录，定期生成 3-5 词的进度摘要文本，
 * 通过回调推送到前端显示。
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

export interface ToolCallRecord {
	toolName: string
	params: Record<string, unknown>
	timestamp: number
}

export interface TaskProgressSummarizerOptions {
	/** 摘要更新间隔（毫秒），默认 30000 */
	intervalMs?: number
	/** 任务运行多久后才开始显示摘要（毫秒），默认 10000 */
	showAfterMs?: number
}

/**
 * 从工具调用记录生成简短的进度摘要文本。
 * 当前使用基于规则的方式生成，未来可升级为轻量模型调用。
 */
export function generateSummaryFromToolCalls(recentToolCalls: ToolCallRecord[]): string | null {
	if (recentToolCalls.length === 0) {
		return null
	}

	const latest = recentToolCalls[recentToolCalls.length - 1]
	const toolName = latest.toolName
	const params = latest.params

	switch (toolName) {
		case "read_file": {
			const filePath = params.path as string | undefined
			if (filePath) {
				const fileName = filePath.split(/[/\\]/).pop() || filePath
				return `正在读取 ${fileName}`
			}
			return "正在读取文件"
		}
		case "write_to_file": {
			const filePath = params.path as string | undefined
			if (filePath) {
				const fileName = filePath.split(/[/\\]/).pop() || filePath
				return `正在写入 ${fileName}`
			}
			return "正在写入文件"
		}
		case "apply_diff":
		case "search_and_replace": {
			const filePath = params.path as string | undefined
			if (filePath) {
				const fileName = filePath.split(/[/\\]/).pop() || filePath
				return `正在修改 ${fileName}`
			}
			return "正在修改文件"
		}
		case "execute_command": {
			const command = params.command as string | undefined
			if (command) {
				// 截取命令前 30 个字符
				const short = command.length > 30 ? command.slice(0, 30) + "…" : command
				return `正在执行 ${short}`
			}
			return "正在执行命令"
		}
		case "search_files": {
			const regex = params.regex as string | undefined
			if (regex) {
				return `正在搜索 "${regex}"`
			}
			return "正在搜索文件"
		}
		case "list_files": {
			const dirPath = params.path as string | undefined
			if (dirPath) {
				const dirName = dirPath.split(/[/\\]/).pop() || dirPath
				return `正在浏览 ${dirName}`
			}
			return "正在浏览目录"
		}
		case "codebase_search": {
			const query = params.query as string | undefined
			if (query) {
				const short = query.length > 20 ? query.slice(0, 20) + "…" : query
				return `正在搜索 "${short}"`
			}
			return "正在搜索代码库"
		}
		case "lsp_code_intelligence": {
			const operation = params.operation as string | undefined
			if (operation === "goToDefinition") return "正在查找定义"
			if (operation === "findReferences") return "正在查找引用"
			if (operation === "hover") return "正在查看类型信息"
			if (operation === "documentSymbol") return "正在分析文件符号"
			return "正在分析代码"
		}
		case "web_fetch": {
			const url = params.url as string | undefined
			if (url) {
				try {
					const hostname = new URL(url).hostname
					return `正在抓取 ${hostname}`
				} catch {
					return "正在抓取网页"
				}
			}
			return "正在抓取网页"
		}
		case "attempt_completion":
			return "正在完成任务"
		case "ask_followup_question":
			return "正在等待回复"
		case "new_task":
			return "正在创建子任务"
		case "update_todo_list":
			return "正在更新任务列表"
		case "enter_plan_mode":
			return "正在进入规划模式"
		case "exit_plan_mode":
			return "正在提交执行方案"
		case "spawn_parallel_task":
			return "正在创建并行子任务"
		case "notebook_edit": {
			const nbPath = params.path as string | undefined
			const nbOp = params.operation as string | undefined
			if (nbPath) {
				const fileName = nbPath.split(/[/\\]/).pop() || nbPath
				return `正在${nbOp === "insert" ? "插入" : nbOp === "delete" ? "删除" : "编辑"} ${fileName} 单元格`
			}
			return "正在编辑 Notebook"
		}
		case "tool_search": {
			const query = params.query as string | undefined
			if (query) {
				return `正在搜索工具 "${query}"`
			}
			return "正在搜索可用工具"
		}
		case "generate_image":
			return "正在生成图片"
		case "switch_mode": {
			const modeSlug = params.mode_slug as string | undefined
			return modeSlug ? `正在切换到 ${modeSlug} 模式` : "正在切换模式"
		}
		default:
			return `正在使用 ${toolName}`
	}
}

export class TaskProgressSummarizer {
	private intervalMs: number
	private showAfterMs: number
	private timer: ReturnType<typeof setInterval> | null = null
	private recentToolCalls: ToolCallRecord[] = []
	private lastSummary: string | null = null
	private startTime: number = 0
	private onUpdate: ((summary: string | null) => void) | null = null
	private stopped = false

	constructor(options?: TaskProgressSummarizerOptions) {
		this.intervalMs = options?.intervalMs ?? 30_000
		this.showAfterMs = options?.showAfterMs ?? 10_000
	}

	/**
	 * 启动进度摘要器
	 * @param onUpdate 摘要更新回调，传 null 表示隐藏摘要
	 */
	start(onUpdate: (summary: string | null) => void): void {
		if (this.stopped) return

		this.onUpdate = onUpdate
		this.startTime = Date.now()
		this.recentToolCalls = []
		this.lastSummary = null

		this.timer = setInterval(() => {
			this.emitSummary()
		}, this.intervalMs)
	}

	/**
	 * 停止进度摘要器，通知前端隐藏摘要
	 */
	stop(): void {
		this.stopped = true

		if (this.timer) {
			clearInterval(this.timer)
			this.timer = null
		}

		// 通知前端隐藏摘要
		if (this.onUpdate) {
			this.onUpdate(null)
		}

		this.onUpdate = null
		this.recentToolCalls = []
		this.lastSummary = null
	}

	/**
	 * 记录一次工具调用，立即触发摘要更新
	 */
	recordToolCall(toolName: string, params: Record<string, unknown>): void {
		if (this.stopped) return

		const record: ToolCallRecord = {
			toolName,
			params,
			timestamp: Date.now(),
		}

		this.recentToolCalls.push(record)

		// 只保留最近 20 条记录
		if (this.recentToolCalls.length > 20) {
			this.recentToolCalls = this.recentToolCalls.slice(-20)
		}

		// 工具调用后立即更新摘要
		this.emitSummary()
	}

	/**
	 * 获取当前摘要文本
	 */
	getLastSummary(): string | null {
		return this.lastSummary
	}

	/**
	 * 检查是否已启动
	 */
	isRunning(): boolean {
		return this.timer !== null && !this.stopped
	}

	private emitSummary(): void {
		if (this.stopped || !this.onUpdate) return

		// 任务运行不足 showAfterMs 时不显示
		const elapsed = Date.now() - this.startTime
		if (elapsed < this.showAfterMs) return

		try {
			const summary = generateSummaryFromToolCalls(this.recentToolCalls)
			if (summary && summary !== this.lastSummary) {
				this.lastSummary = summary
				this.onUpdate(summary)
			}
		} catch (error) {
			// R3.5: 摘要生成失败时跳过，不影响主任务，但记录日志便于诊断
			console.warn(`[TaskProgressSummarizer] generateSummary failed:`, error)
		}
	}
}

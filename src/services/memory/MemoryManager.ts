/**
 * MemoryManager — 跨会话记忆系统（支持双作用域：项目级 / 全局级）
 *
 * - 项目级（默认 scope: "project"）：保存到 {cwd}/.tocodex/memory/<project-hash>/MEMORY.md
 *   仅当前工作区可见，存放与本项目强相关的架构、路径、bug 修复等。
 * - 全局级（scope: "global"）：保存到 {globalStoragePath}/memory/GLOBAL_MEMORY.md
 *   所有工作区共享，存放用户偏好、通用规则、跨项目知识。
 *
 * 反膨胀机制：
 *   1) 写入时按"归一化文本"去重，相同记忆不重复追加
 *   2) 条目支持类别标签 [rule|preference|fact|insight]，便于后续筛选
 *   3) 字符数超过 maxChars 时优先 LLM 压缩，降级则按 LRU 截断
 *   4) 全局作用域默认 maxTokens 更小（5K），避免污染上下文
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6 + 全局记忆扩展
 */

import * as fs from "fs/promises"
import * as path from "path"
import * as crypto from "crypto"

export type MemoryScope = "project" | "global"

export type MemoryCategory = "rule" | "preference" | "fact" | "insight"

export interface MemoryManagerOptions {
	/** 作用域。默认 "project" 保持向后兼容 */
	scope?: MemoryScope
	/** 工作区根目录（scope === "project" 时必填） */
	cwd?: string
	/** VS Code 全局存储路径（scope === "global" 时必填） */
	globalStoragePath?: string
	/** 记忆文件最大 token 数，超过则压缩（估算：1 token ≈ 4 字符） */
	maxTokens?: number
}

const DEFAULT_PROJECT_MAX_TOKENS = 10_000
const DEFAULT_GLOBAL_MAX_TOKENS = 5_000
const CHARS_PER_TOKEN = 4

/**
 * 把任意文本归一化用于"去重 hash"：去除两端空白、合并连续空白、转小写。
 */
function normalizeForDedup(text: string): string {
	return text.replace(/\s+/g, " ").trim().toLowerCase()
}

export class MemoryManager {
	private readonly memoryDir: string
	private readonly memoryFile: string
	private readonly maxChars: number
	private readonly scope: MemoryScope
	private inFlightExtraction = false

	constructor(options: MemoryManagerOptions) {
		const scope: MemoryScope = options.scope ?? "project"
		this.scope = scope

		if (scope === "global") {
			if (!options.globalStoragePath) {
				throw new Error("MemoryManager: globalStoragePath is required when scope='global'")
			}
			this.memoryDir = path.join(options.globalStoragePath, "memory")
			this.memoryFile = path.join(this.memoryDir, "GLOBAL_MEMORY.md")
			this.maxChars = (options.maxTokens ?? DEFAULT_GLOBAL_MAX_TOKENS) * CHARS_PER_TOKEN
		} else {
			if (!options.cwd) {
				throw new Error("MemoryManager: cwd is required when scope='project'")
			}
			const projectHash = crypto.createHash("md5").update(options.cwd).digest("hex").slice(0, 8)
			this.memoryDir = path.join(options.cwd, ".tocodex", "memory", projectHash)
			this.memoryFile = path.join(this.memoryDir, "MEMORY.md")
			this.maxChars = (options.maxTokens ?? DEFAULT_PROJECT_MAX_TOKENS) * CHARS_PER_TOKEN
		}
	}

	/** 当前作用域 */
	getScope(): MemoryScope {
		return this.scope
	}

	/** 当前记忆文件绝对路径 */
	getMemoryFilePath(): string {
		return this.memoryFile
	}

	/**
	 * 加载记忆文件内容，用于注入系统提示。
	 * 文件不存在时返回空字符串。
	 */
	async loadMemory(): Promise<string> {
		try {
			const content = await fs.readFile(this.memoryFile, "utf-8")
			return content.trim()
		} catch {
			return ""
		}
	}

	/**
	 * 追加新的记忆条目。
	 * 自动按 normalize 后字符串去重；可附带类别。追加后检查是否需要压缩。
	 *
	 * @param text 记忆正文
	 * @param category 可选类别，默认 "insight"
	 * @returns true 表示已写入；false 表示因重复而被跳过
	 */
	async appendMemory(text: string, category: MemoryCategory = "insight"): Promise<boolean> {
		const trimmed = text.trim()
		if (!trimmed) return false

		await this.ensureDir()

		// 去重：读取现有内容，按条目分割，检查是否已存在相同 normalize 文本
		try {
			const existing = await this.loadMemory()
			if (existing) {
				const entries = this.splitEntries(existing)
				const targetNorm = normalizeForDedup(trimmed)
				for (const entry of entries) {
					// 剥离 <!-- ... --> 头部后再比较
					const body = entry.replace(/^<!--[^>]*-->\s*/, "").trim()
					if (normalizeForDedup(body) === targetNorm) {
						return false
					}
				}
			}
		} catch {
			// 读取失败时不阻塞写入
		}

		const timestamp = new Date().toISOString()
		const entry = `\n<!-- ${timestamp} [${category}] -->\n${trimmed}\n`

		await fs.appendFile(this.memoryFile, entry, "utf-8")
		await this.compressIfNeeded()
		return true
	}

	/**
	 * 清空当前作用域的记忆文件。
	 */
	async clearMemory(): Promise<void> {
		try {
			await fs.writeFile(this.memoryFile, "", "utf-8")
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				console.error(
					`[MemoryManager:${this.scope}] clearMemory failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}
		}
	}

	/**
	 * 删除某一条记忆（按 0-based 索引，旧到新）。
	 * @returns 是否成功删除
	 */
	async removeEntryByIndex(index: number): Promise<boolean> {
		const content = await this.loadMemory()
		if (!content) return false
		const entries = this.splitEntries(content)
		if (index < 0 || index >= entries.length) return false
		entries.splice(index, 1)
		const next = entries.join("\n").trim()
		await this.ensureDir()
		await fs.writeFile(this.memoryFile, next ? next + "\n" : "", "utf-8")
		return true
	}

	/**
	 * 列出所有条目（去掉时间戳头，便于 UI 展示）。
	 */
	async listEntries(): Promise<Array<{ timestamp?: string; category?: string; body: string }>> {
		const content = await this.loadMemory()
		if (!content) return []
		return this.splitEntries(content).map((entry) => {
			const match = entry.match(/^<!--\s*([0-9T:.\-Z]+)?\s*(?:\[([^\]]+)\])?\s*-->\s*([\s\S]*)$/)
			if (match) {
				return {
					timestamp: match[1],
					category: match[2],
					body: match[3].trim(),
				}
			}
			return { body: entry.trim() }
		})
	}

	/**
	 * 从对话记录中异步提取关键记忆并保存。
	 *
	 * @param transcript 对话文本
	 * @param llmExtractor 可选的 LLM 提取函数
	 * @param category 写入时使用的类别（默认 "insight"）
	 */
	async extractAndSave(
		transcript: string,
		llmExtractor?: (text: string) => Promise<string>,
		category: MemoryCategory = "insight",
	): Promise<void> {
		if (this.inFlightExtraction) return
		this.inFlightExtraction = true

		try {
			let extracted: string

			if (llmExtractor) {
				try {
					extracted = await llmExtractor(transcript)
				} catch (error) {
					console.warn(
						`[MemoryManager:${this.scope}] LLM 提取失败，降级到关键词匹配: ${
							error instanceof Error ? error.message : String(error)
						}`,
					)
					extracted = this.extractKeyInsights(transcript)
				}
			} else {
				extracted = this.extractKeyInsights(transcript)
			}

			if (extracted) {
				await this.appendMemory(extracted, category)
			}
		} catch (error) {
			console.warn(
				`[MemoryManager:${this.scope}] extractAndSave failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		} finally {
			this.inFlightExtraction = false
		}
	}

	/**
	 * 在 condense 上下文时同步压缩记忆。
	 */
	async condenseMemory(
		llmCondenser?: (currentMemory: string) => Promise<string>,
		targetMaxChars?: number,
	): Promise<string> {
		const content = await this.loadMemory()
		if (!content) return ""

		const target = targetMaxChars ?? Math.floor(this.maxChars / 2)

		if (content.length <= target) return content

		if (llmCondenser) {
			try {
				const condensed = await llmCondenser(content)
				if (condensed && condensed.trim()) {
					const timestamp = new Date().toISOString()
					const newContent = `<!-- ${timestamp} [condensed] -->\n${condensed.trim()}\n`
					await this.ensureDir()
					await fs.writeFile(this.memoryFile, newContent, "utf-8")
					return condensed.trim()
				}
			} catch (error) {
				console.warn(
					`[MemoryManager:${this.scope}] LLM 记忆压缩失败，降级到简单截断: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}
		}

		// 降级：保留最近的条目直到达到目标字符数
		const entries = this.splitEntries(content)
		const kept: string[] = []
		let totalLength = 0
		for (let i = entries.length - 1; i >= 0; i--) {
			if (totalLength + entries[i].length > target && kept.length > 0) {
				break
			}
			kept.unshift(entries[i])
			totalLength += entries[i].length
		}

		const truncated = `<!-- 已压缩：保留最近 ${kept.length} 条记忆 -->\n` + kept.join("\n")
		await this.ensureDir()
		await fs.writeFile(this.memoryFile, truncated, "utf-8")
		return kept.join("\n").trim()
	}

	/**
	 * 如果记忆文件超过最大字符数，压缩保留最近的内容。
	 */
	async compressIfNeeded(): Promise<void> {
		try {
			const content = await fs.readFile(this.memoryFile, "utf-8")
			if (content.length <= this.maxChars) return

			const entries = this.splitEntries(content)

			let kept: string[] = []
			let totalLength = 0
			for (let i = entries.length - 1; i >= 0; i--) {
				if (totalLength + entries[i].length > this.maxChars && kept.length > 0) {
					break
				}
				kept.unshift(entries[i])
				totalLength += entries[i].length
			}

			const compressed = `<!-- 已压缩：保留最近 ${kept.length} 条记忆 -->\n` + kept.join("\n")
			await fs.writeFile(this.memoryFile, compressed, "utf-8")
		} catch (error) {
			console.warn(
				`[MemoryManager:${this.scope}] compressIfNeeded failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	/**
	 * 按条目分割记忆文本。
	 * 条目以 `<!-- ISO timestamp [...] -->` 或类似 `<!-- 已压缩... -->` 开头。
	 */
	private splitEntries(content: string): string[] {
		const entryPattern = /\n(?=<!--\s*(?:\d{4}-|已压缩))/
		return content.split(entryPattern).filter((e) => e.trim().length > 0)
	}

	/**
	 * 从对话记录中提取关键洞察（简单规则提取）。
	 */
	private extractKeyInsights(transcript: string): string {
		const keywords = ["架构", "路径", "问题", "决策", "注意", "重要", "architecture", "path", "issue", "decision"]
		const lines = transcript.split("\n")
		const relevant: string[] = []

		for (const line of lines) {
			const lower = line.toLowerCase()
			if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
				const trimmed = line.trim()
				if (trimmed.length > 10 && trimmed.length < 200) {
					relevant.push(trimmed)
				}
			}
		}

		if (relevant.length === 0) return ""
		return relevant.slice(0, 10).join("\n")
	}

	private async ensureDir(): Promise<void> {
		await fs.mkdir(this.memoryDir, { recursive: true })
	}
}

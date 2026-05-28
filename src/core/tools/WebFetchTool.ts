/**
 * WebFetchTool — URL 内容抓取工具
 *
 * 抓取 URL 内容并转换为 Markdown 格式返回给模型。
 * 支持安全域名白名单自动预批准、超时控制、内容截断。
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

import TurndownService from "turndown"

import { Task } from "../task/Task"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { summarizeIfNeeded } from "./helpers/toolResultSummarizer"

export interface WebFetchParams {
	url: string
	prompt?: string | null
	maxLength?: number | null
}

/** 安全域名白名单 — 自动预批准，不需要用户确认 (Requirements: 12.5) */
export const TRUSTED_DOMAINS = [
	"github.com",
	"docs.github.com",
	"raw.githubusercontent.com",
	"npmjs.com",
	"www.npmjs.com",
	"nodejs.org",
	"developer.mozilla.org",
	"stackoverflow.com",
	"registry.npmjs.org",
]

/** 不支持直接抓取的二进制扩展名 (Requirements: 12.3) */
const BINARY_EXTENSIONS = [
	".png",
	".jpg",
	".jpeg",
	".gif",
	".bmp",
	".webp",
	".svg",
	".ico",
	".pdf",
	".doc",
	".docx",
	".xls",
	".xlsx",
	".ppt",
	".pptx",
	".zip",
	".tar",
	".gz",
	".rar",
	".7z",
	".mp3",
	".mp4",
	".avi",
	".mov",
	".wav",
	".exe",
	".dll",
	".so",
	".dylib",
]

/** 默认最大内容长度 */
const DEFAULT_MAX_LENGTH = 100_000

/** 抓取超时（毫秒）(Requirements: 12.4) */
const FETCH_TIMEOUT_MS = 10_000

/**
 * 判断 URL 是否属于安全域名
 */
export function isTrustedDomain(url: string): boolean {
	try {
		const hostname = new URL(url).hostname
		return TRUSTED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
	} catch {
		return false
	}
}

/**
 * 判断 URL 是否指向二进制文件
 */
export function isBinaryUrl(url: string): boolean {
	try {
		const pathname = new URL(url).pathname.toLowerCase()
		return BINARY_EXTENSIONS.some((ext) => pathname.endsWith(ext))
	} catch {
		return false
	}
}

/**
 * 将 HTML 转换为 Markdown
 */
export function htmlToMarkdown(html: string): string {
	const turndown = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
	})

	// 移除 script、style、nav 等非内容标签
	turndown.remove(["script", "style", "nav", "footer", "header"])

	return turndown.turndown(html)
}

/**
 * 截断内容，保留头部和尾部 (Requirements: 12.2)
 */
export function truncateContent(content: string, maxLength: number): { content: string; truncated: boolean } {
	if (content.length <= maxLength) {
		return { content, truncated: false }
	}

	const headSize = Math.floor(maxLength * 0.7)
	const tailSize = Math.floor(maxLength * 0.2)
	const head = content.slice(0, headSize)
	const tail = content.slice(-tailSize)

	const truncatedContent =
		`${head}\n\n` +
		`--- [已截断：原始长度 ${content.length} 字符，显示头部 ${headSize} + 尾部 ${tailSize} 字符] ---\n\n` +
		tail

	return { content: truncatedContent, truncated: true }
}

export class WebFetchTool extends BaseTool<"web_fetch"> {
	readonly name = "web_fetch" as const

	async execute(params: WebFetchParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult, askApproval } = callbacks
		const { url, maxLength } = params

		// 验证 URL 参数
		if (!url) {
			task.consecutiveMistakeCount++
			task.recordToolError("web_fetch")
			const errorMsg = await task.sayAndCreateMissingParamError("web_fetch", "url")
			pushToolResult(`Error: ${errorMsg}`)
			return
		}

		// 验证 URL 格式
		try {
			const parsedUrl = new URL(url)
			if (!parsedUrl.protocol.startsWith("http")) {
				pushToolResult(`Error: 仅支持 http/https 协议，收到: ${parsedUrl.protocol}`)
				return
			}
		} catch {
			pushToolResult(`Error: 无效的 URL 格式: ${url}`)
			return
		}

		// 检查是否为二进制 URL (Requirements: 12.3)
		if (isBinaryUrl(url)) {
			const ext = new URL(url).pathname.split(".").pop() || "binary"
			pushToolResult(
				`该 URL 指向二进制文件（.${ext}），无法直接抓取内容。` +
					`请使用其他方式获取该文件，或提供文本格式的替代链接。`,
			)
			return
		}

		task.consecutiveMistakeCount = 0

		// 安全域名自动预批准，非安全域名需要用户确认 (Requirements: 12.5)
		const trusted = isTrustedDomain(url)

		if (!trusted) {
			const didApprove = await askApproval("tool", url)
			if (!didApprove) {
				return
			}
		}

		// 执行抓取
		try {
			const result = await this.fetchUrl(url, maxLength ?? DEFAULT_MAX_LENGTH)
			const { content: summarized } = summarizeIfNeeded("web_fetch", result)
			pushToolResult(summarized)
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			task.didToolFailInCurrentTurn = true
			pushToolResult(`Error: 抓取 ${url} 失败 — ${errorMsg}`)
		}
	}

	/**
	 * 抓取 URL 并转换为 Markdown
	 */
	private async fetchUrl(url: string, maxLength: number): Promise<string> {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

		try {
			const response = await fetch(url, {
				signal: controller.signal,
				headers: {
					"User-Agent": "Mozilla/5.0 (compatible; ToCodex/2.0; +https://github.com/tocodex)",
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
				},
				redirect: "follow",
			})

			if (!response.ok) {
				throw new Error(`HTTP ${response.status} ${response.statusText}`)
			}

			const contentType = response.headers.get("content-type") || ""

			// 检查 Content-Type 是否为二进制 (Requirements: 12.3)
			if (
				contentType.startsWith("image/") ||
				contentType === "application/pdf" ||
				contentType === "application/octet-stream"
			) {
				const type = contentType.split("/")[1] || "binary"
				return `该 URL 返回的是 ${type} 类型内容，无法转换为文本。请提供文本格式的替代链接。`
			}

			const rawText = await response.text()

			// HTML 内容转 Markdown (Requirements: 12.1)
			let markdown: string
			if (contentType.includes("html")) {
				markdown = htmlToMarkdown(rawText)
			} else {
				// 纯文本、JSON 等直接返回
				markdown = rawText
			}

			// 截断超长内容 (Requirements: 12.2)
			const { content } = truncateContent(markdown, maxLength)

			return `[来源: ${url}]\n\n${content}`
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error(`请求超时（${FETCH_TIMEOUT_MS / 1000}s）`)
			}
			throw error
		} finally {
			clearTimeout(timeout)
		}
	}
}

export const webFetchTool = new WebFetchTool()

/**
 * 上下文健康度面板
 *
 * 当上下文使用率 > 60% 时在 TaskHeader 展开视图中显示，
 * 展示工具结果占比、重复文件读取、大型输出等警告和优化建议，
 * 并提供"一键清理"按钮触发 condense。
 *
 * Requirements: 9.1, 9.5
 */

import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle, Lightbulb, Sparkles } from "lucide-react"

import type { ClineMessage } from "@roo-code/types"

import { Button } from "@/components/ui"

// ---- 类型定义（前端轻量版，与后端 contextAnalysis.ts 对应） ----

interface ToolResultBreakdown {
	toolName: string
	filePath?: string
	charCount: number
	percent: number
}

interface RepeatedFileRead {
	filePath: string
	readCount: number
}

interface ContextWarning {
	type: "high_usage" | "repeated_file" | "large_output"
	toolName?: string
	filePath?: string
	charCount: number
	percent: number
	readCount?: number
	sizeK?: number
}

interface ContextSuggestion {
	type: "compress" | "cache" | "condense"
	filePath?: string
	readCount?: number
	percent?: number
}

// ---- 常量 ----

const HIGH_USAGE_THRESHOLD_PERCENT = 15
const REPEATED_READ_THRESHOLD = 3
const LARGE_OUTPUT_CHAR_THRESHOLD = 30_000

// ---- 前端分析函数 ----

function parseToolInfo(text: string): { tool?: string; path?: string } {
	try {
		const parsed = JSON.parse(text)
		return { tool: parsed?.tool, path: parsed?.path }
	} catch {
		return {}
	}
}

function analyzeMessages(messages: ClineMessage[]): {
	warnings: ContextWarning[]
	suggestions: ContextSuggestion[]
} {
	// 提取工具结果
	const toolResults: ToolResultBreakdown[] = []
	const fileReadCounts = new Map<string, number>()

	for (const msg of messages) {
		if (msg.type !== "say") continue

		if (msg.say === "tool" && msg.text) {
			const { tool, path } = parseToolInfo(msg.text)
			toolResults.push({
				toolName: tool ?? "unknown",
				filePath: path,
				charCount: msg.text.length,
				percent: 0,
			})

			if (tool === "read_file" && path) {
				fileReadCounts.set(path, (fileReadCounts.get(path) ?? 0) + 1)
			}
		}

		if (msg.say === "command_output" && msg.text) {
			toolResults.push({
				toolName: "execute_command",
				charCount: msg.text.length,
				percent: 0,
			})
		}
	}

	// 计算总字符数
	const totalChars = messages.reduce((sum, msg) => sum + (msg.text?.length ?? 0), 0)
	for (const r of toolResults) {
		r.percent = totalChars > 0 ? (r.charCount / totalChars) * 100 : 0
	}

	const warnings: ContextWarning[] = []

	// 高占用
	for (const r of toolResults) {
		if (r.percent > HIGH_USAGE_THRESHOLD_PERCENT) {
			warnings.push({
				type: "high_usage",
				toolName: r.toolName,
				filePath: r.filePath,
				charCount: r.charCount,
				percent: r.percent,
			})
		}
	}

	// 大型输出
	for (const r of toolResults) {
		if (r.charCount > LARGE_OUTPUT_CHAR_THRESHOLD) {
			// 避免与 high_usage 重复
			if (
				!warnings.some((w) => w.type === "high_usage" && w.toolName === r.toolName && w.filePath === r.filePath)
			) {
				warnings.push({
					type: "large_output",
					toolName: r.toolName,
					filePath: r.filePath,
					charCount: r.charCount,
					percent: r.percent,
					sizeK: Math.round(r.charCount / 1000),
				})
			}
		}
	}

	// 重复文件读取
	const repeatedReads: RepeatedFileRead[] = []
	for (const [filePath, count] of fileReadCounts) {
		if (count >= REPEATED_READ_THRESHOLD) {
			repeatedReads.push({ filePath, readCount: count })
		}
	}
	for (const read of repeatedReads) {
		warnings.push({
			type: "repeated_file",
			filePath: read.filePath,
			charCount: 0,
			percent: 0,
			readCount: read.readCount,
		})
	}

	// 建议
	const suggestions: ContextSuggestion[] = []

	if (warnings.some((w) => w.type === "high_usage")) {
		suggestions.push({ type: "compress" })
	}

	for (const read of repeatedReads) {
		suggestions.push({
			type: "cache",
			filePath: read.filePath,
			readCount: read.readCount,
		})
	}

	return { warnings, suggestions }
}

// ---- 组件 ----

interface ContextHealthPanelProps {
	messages: ClineMessage[]
	contextTokens: number
	contextWindow: number
	onCondense: () => void
	buttonsDisabled: boolean
}

export const ContextHealthPanel = ({
	messages,
	contextTokens,
	contextWindow,
	onCondense,
	buttonsDisabled,
}: ContextHealthPanelProps) => {
	const { t } = useTranslation()

	const usagePercent = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0

	// 所有 hooks 必须在条件返回之前调用（React hooks 规则）
	const { warnings, suggestions } = useMemo(() => analyzeMessages(messages), [messages])

	const allSuggestions = useMemo(() => {
		const s = [...suggestions]
		s.push({ type: "condense", percent: Math.round(usagePercent) })
		return s
	}, [suggestions, usagePercent])

	// 只在使用率 > 60% 时显示
	if (usagePercent <= 60) {
		return null
	}

	const hasIssues = warnings.length > 0

	return (
		<div
			data-testid="context-health-panel"
			className="mt-2 pt-2 border-t border-vscode-sideBar-background text-xs space-y-2">
			<div className="flex items-center justify-between">
				<span className="font-medium text-vscode-foreground/80 flex items-center gap-1">
					<Sparkles className="size-3" />
					{t("chat:contextHealth.title")}
				</span>
				<Button
					variant="ghost"
					size="sm"
					disabled={buttonsDisabled}
					onClick={onCondense}
					data-testid="context-health-cleanup-btn"
					className="h-5 px-2 text-xs">
					{t("chat:contextHealth.cleanUpButton")}
				</Button>
			</div>

			{hasIssues ? (
				<div className="space-y-1.5">
					{/* 警告 */}
					{warnings.map((w, i) => (
						<div
							key={`warn-${i}`}
							className="flex items-start gap-1.5 text-vscode-editorWarning-foreground">
							<AlertTriangle className="size-3 mt-0.5 shrink-0" />
							<span>
								{w.type === "high_usage" &&
									t("chat:contextHealth.highUsage", {
										toolName: w.toolName ?? "unknown",
										percent: w.percent.toFixed(1),
									})}
								{w.type === "large_output" &&
									t("chat:contextHealth.largeOutput", {
										toolName: w.toolName ?? "unknown",
										size: w.sizeK ?? Math.round(w.charCount / 1000),
									})}
								{w.type === "repeated_file" &&
									t("chat:contextHealth.repeatedFile", {
										filePath: w.filePath ?? "unknown",
										count: w.readCount ?? 0,
									})}
							</span>
						</div>
					))}

					{/* 建议 */}
					{allSuggestions.map((s, i) => (
						<div key={`sug-${i}`} className="flex items-start gap-1.5 text-vscode-foreground/60">
							<Lightbulb className="size-3 mt-0.5 shrink-0" />
							<span>
								{s.type === "compress" && t("chat:contextHealth.suggestCompress")}
								{s.type === "cache" &&
									t("chat:contextHealth.suggestCache", {
										filePath: s.filePath ?? "",
										count: s.readCount ?? 0,
									})}
								{s.type === "condense" &&
									t("chat:contextHealth.suggestCondense", {
										percent: s.percent ?? Math.round(usagePercent),
									})}
							</span>
						</div>
					))}
				</div>
			) : (
				<div className="flex items-center gap-1.5 text-vscode-foreground/60">
					<Lightbulb className="size-3" />
					<span>
						{t("chat:contextHealth.suggestCondense", {
							percent: Math.round(usagePercent),
						})}
					</span>
				</div>
			)}
		</div>
	)
}

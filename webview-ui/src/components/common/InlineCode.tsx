import React, { memo, useCallback, useState, useMemo } from "react"
import { Copy, Check } from "lucide-react"
import { copyToClipboard } from "@src/utils/clipboard"
import { vscode } from "@src/utils/vscode"

interface InlineCodeProps {
	children: React.ReactNode
	className?: string
}

/**
 * 常见的源代码文件扩展名，用于检测行内代码是否看起来像文件路径。
 */
const FILE_EXTENSIONS = new Set([
	"ts", "tsx", "js", "jsx", "mjs", "cjs",
	"py", "rb", "go", "rs", "java", "kt", "scala", "swift",
	"c", "cpp", "cc", "h", "hpp", "cs",
	"vue", "svelte", "astro",
	"css", "scss", "less", "sass",
	"html", "htm", "xml", "svg",
	"json", "yaml", "yml", "toml", "ini", "conf",
	"md", "mdx", "txt", "rst",
	"sh", "bash", "zsh", "fish", "bat", "cmd", "ps1",
	"sql", "graphql", "gql",
	"proto", "wasm",
	"dockerfile", "makefile",
	"env", "gitignore", "editorconfig",
	"lua", "vim", "el", "ex", "exs", "erl", "hrl",
	"r", "jl", "m", "mm", "pl", "pm",
])

/**
 * 检测文本是否看起来像文件路径。
 * 匹配形如：src/core/xxx.ts, ./path/to/file.js, path/file.py:42 等。
 * 不匹配：纯文件名无路径（如 "file.ts"），命令（如 "npm install"），URL 等。
 */
function isLikelyFilePath(text: string): boolean {
	if (!text || text.length > 200) return false

	// 不匹配包含空格的内容（排除命令、英文句子）
	if (text.includes(" ")) return false

	// 不匹配 URL
	if (text.includes("://")) return false

	// 去掉可能的行号后缀 :123 或 :123-456
	const withoutLineNum = text.replace(/:\d+(-\d+)?$/, "")

	// 必须包含路径分隔符（至少一级目录），排除纯文件名
	if (!withoutLineNum.includes("/") && !withoutLineNum.includes("\\")) return false

	// 提取扩展名
	const lastDot = withoutLineNum.lastIndexOf(".")
	if (lastDot === -1) {
		// 没有扩展名但包含路径分隔符，也可能是路径（如 src/components）
		// 但保守起见，要求至少有已知扩展名
		return false
	}

	const ext = withoutLineNum.slice(lastDot + 1).toLowerCase()
	return FILE_EXTENSIONS.has(ext)
}

/**
 * 内联代码组件 — 悬停时在右侧显示复制图标。
 * 如果内容看起来像文件路径，则同时可点击打开文件。
 *
 * 用于替换 MarkdownBlock 中默认的 <code> 渲染，
 * 让用户可以快速复制命令行、路径、变量名等内联代码片段。
 */
const InlineCode = memo(({ children, className, ...props }: InlineCodeProps & Record<string, any>) => {
	const [copied, setCopied] = useState(false)

	// 提取纯文本内容
	const text = useMemo(() => {
		if (typeof children === "string") return children
		if (Array.isArray(children)) return children.filter((c) => typeof c === "string").join("")
		return String(children ?? "")
	}, [children])

	const isFilePath = useMemo(() => isLikelyFilePath(text), [text])

	const handleCopy = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation()
			e.preventDefault()

			if (!text.trim()) return

			const success = await copyToClipboard(text)
			if (success) {
				setCopied(true)
				setTimeout(() => setCopied(false), 1500)
			}
		},
		[text],
	)

	const handleFileClick = useCallback(
		(e: React.MouseEvent) => {
			// 如果点击的是复制按钮，不处理
			const target = e.target as HTMLElement
			if (target.closest(".inline-code-copy-btn")) return

			e.preventDefault()
			e.stopPropagation()

			let filePath = text
			// 提取行号
			let values: { line?: number } | undefined = undefined
			const match = filePath.match(/(.*):(\d+)(-\d+)?$/)
			if (match) {
				filePath = match[1]
				values = { line: parseInt(match[2]) }
			}

			// 添加 ./ 前缀
			if (!filePath.startsWith("/") && !filePath.startsWith("./")) {
				filePath = "./" + filePath
			}

			vscode.postMessage({
				type: "openFile",
				text: filePath,
				values,
			})
		},
		[text],
	)

	if (isFilePath) {
		return (
			<code
				className={`inline-code-with-copy ${className ?? ""}`}
				{...props}
				onClick={handleFileClick}
				style={{
					cursor: "pointer",
					textDecoration: "none",
					borderBottom: "1px dotted var(--vscode-textLink-foreground)",
				}}
				title={`Click to open ${text}`}>
				<span style={{ color: "var(--vscode-textLink-foreground)" }}>{children}</span>
				<span
					className="inline-code-copy-btn"
					onClick={handleCopy}
					role="button"
					tabIndex={0}
					aria-label="Copy code"
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							handleCopy(e as unknown as React.MouseEvent)
						}
					}}>
					{copied ? <Check size={12} /> : <Copy size={12} />}
				</span>
			</code>
		)
	}

	return (
		<code className={`inline-code-with-copy ${className ?? ""}`} {...props}>
			{children}
			<span
				className="inline-code-copy-btn"
				onClick={handleCopy}
				role="button"
				tabIndex={0}
				aria-label="Copy code"
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						handleCopy(e as unknown as React.MouseEvent)
					}
				}}>
				{copied ? <Check size={12} /> : <Copy size={12} />}
			</span>
		</code>
	)
})

InlineCode.displayName = "InlineCode"

export default InlineCode

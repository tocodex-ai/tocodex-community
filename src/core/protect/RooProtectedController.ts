import path from "path"
import ignore, { Ignore } from "ignore"

export const SHIELD_SYMBOL = "\u{1F6E1}"

/**
 * Controls write access to Roo configuration files by enforcing protection patterns.
 * Prevents auto-approved modifications to sensitive Roo configuration files.
 */
export class RooProtectedController {
	private cwd: string
	private ignoreInstance: Ignore

	// 错误风暴防护：catch 里降级日志 + 去重计数，避免同一类路径被 ignore 库
	// 抛 RangeError 时灌满 console.error → IPC 通道 → 拖死 webview 渲染。
	private static readonly MAX_ERROR_DETAILS = 3
	private static errorCount = 0

	// Predefined list of protected Roo configuration patterns
	private static readonly PROTECTED_PATTERNS = [
		".rooignore",
		".roomodes",
		".roorules*",
		".clinerules*",
		".tocodex/**",
		".vscode/**",
		"*.code-workspace",
		".tocodexprotected", // For future use
		"AGENTS.md",
		"AGENT.md",
	]

	constructor(cwd: string) {
		this.cwd = cwd
		// Initialize ignore instance with protected patterns
		this.ignoreInstance = ignore()
		this.ignoreInstance.add(RooProtectedController.PROTECTED_PATTERNS)
	}

	/**
	 * Check if a file is write-protected
	 * @param filePath - Path to check (relative to cwd)
	 * @returns true if file is write-protected, false otherwise
	 */
	isWriteProtected(filePath: string): boolean {
		try {
			// Normalize path to be relative to cwd and use forward slashes
			const absolutePath = path.resolve(this.cwd, filePath)
			const relativePath = path.relative(this.cwd, absolutePath).toPosix()

			// 不在 cwd 子树内的路径不可能匹配任何相对的保护模式（".rooignore" / ".vscode/**" 等）。
			// 三种"非子树"形态：
			//   1. 同盘符 cwd 上方       →  以 ".." 开头
			//   2. Windows 跨盘符        →  path.relative 原样保留盘符（如 "D:/..."）→ path.isAbsolute 为 true
			//   3. POSIX 绝对（理论冗余） →  以 "/" 开头
			// 这些形态送进 ignore.ignores() 会抛 RangeError，提前 false 兼具语义正确与性能。
			if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || relativePath.startsWith("/")) {
				return false
			}

			// Use ignore library to check if file matches any protected pattern
			return this.ignoreInstance.ignores(relativePath)
		} catch (error) {
			// 走到这里意味着上面的兜底没能识别（理论上不应发生）。
			// 只在前 MAX_ERROR_DETAILS 次打完整 stack，之后只 debug 计数，避免日志风暴。
			RooProtectedController.errorCount++
			if (RooProtectedController.errorCount <= RooProtectedController.MAX_ERROR_DETAILS) {
				console.error(`Error checking protection for ${filePath}:`, error)
			} else if (RooProtectedController.errorCount % 100 === 0) {
				console.debug(`[RooProtectedController] suppressed ${RooProtectedController.errorCount} similar errors`)
			}
			return false
		}
	}

	/**
	 * Get set of write-protected files from a list
	 * @param paths - Array of paths to filter (relative to cwd)
	 * @returns Set of protected file paths
	 */
	getProtectedFiles(paths: string[]): Set<string> {
		const protectedFiles = new Set<string>()

		for (const filePath of paths) {
			if (this.isWriteProtected(filePath)) {
				protectedFiles.add(filePath)
			}
		}

		return protectedFiles
	}

	/**
	 * Filter an array of paths, marking which ones are protected
	 * @param paths - Array of paths to check (relative to cwd)
	 * @returns Array of objects with path and protection status
	 */
	annotatePathsWithProtection(paths: string[]): Array<{ path: string; isProtected: boolean }> {
		return paths.map((filePath) => ({
			path: filePath,
			isProtected: this.isWriteProtected(filePath),
		}))
	}

	/**
	 * Get display message for protected file operations
	 */
	getProtectionMessage(): string {
		return "This is a Roo configuration file and requires approval for modifications"
	}

	/**
	 * Get formatted instructions about protected files for the LLM
	 * @returns Formatted instructions about file protection
	 */
	getInstructions(): string {
		const patterns = RooProtectedController.PROTECTED_PATTERNS.join(", ")
		return `# Protected Files\n\n(The following Roo configuration file patterns are write-protected and always require approval for modifications, regardless of autoapproval settings. When using list_files, you'll notice a ${SHIELD_SYMBOL} next to files that are write-protected.)\n\nProtected patterns: ${patterns}`
	}

	/**
	 * Get the list of protected patterns (for testing/debugging)
	 */
	static getProtectedPatterns(): readonly string[] {
		return RooProtectedController.PROTECTED_PATTERNS
	}
}

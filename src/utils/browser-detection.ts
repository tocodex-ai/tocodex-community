/**
 * Browser detection utilities for Playwright MCP configuration.
 *
 * 策略：**使用隔离持久化 profile**
 * - 在工作区 `.tocodex/browser-profiles/<channel>/` 下创建独立 profile 目录
 * - Profile 持久化保存，不会每次删除 → 登录态、cookies 自动保持
 * - 不占用用户真实 Chrome profile → 不需要 kill chrome，不冲突
 * - Playwright 对隔离 profile 的控制最稳定（无扩展干扰、无 session restore 问题）
 *
 * 用户首次使用浏览器模式时需要登录一次，之后自动保持。
 */

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

export type PlaywrightChannel = "chrome" | "msedge" | "chromium"

interface BrowserDetectionResult {
	channel: PlaywrightChannel
	executablePath?: string
	reason: string
}

/**
 * 返回隔离 profile 目录路径。
 * 路径格式：<workspacePath>/.tocodex/browser-profiles/<channel>/
 *
 * 该目录持久化保存，不会被自动清理，确保登录态保持。
 */
export function getIsolatedBrowserProfileDir(workspacePath: string, channel: PlaywrightChannel): string {
	return path.join(workspacePath, ".tocodex", "browser-profiles", channel)
}

/**
 * 返回用户当前操作系统下真实 Chrome 的 user-data-dir 路径。
 * 仅用于参考/检测，不再作为 Playwright 的 user-data-dir。
 */
export function getUserChromeProfileDir(): string {
	const platform = os.platform()
	if (platform === "win32") {
		const localAppData = process.env["LOCALAPPDATA"] || path.join(os.homedir(), "AppData", "Local")
		return path.join(localAppData, "Google", "Chrome", "User Data")
	}
	if (platform === "darwin") {
		return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome")
	}
	// Linux 及其它
	return path.join(os.homedir(), ".config", "google-chrome")
}

/**
 * 返回用户当前操作系统下真实 Edge 的 user-data-dir 路径。
 * 仅用于参考/检测，不再作为 Playwright 的 user-data-dir。
 */
export function getUserEdgeProfileDir(): string {
	const platform = os.platform()
	if (platform === "win32") {
		const localAppData = process.env["LOCALAPPDATA"] || path.join(os.homedir(), "AppData", "Local")
		return path.join(localAppData, "Microsoft", "Edge", "User Data")
	}
	if (platform === "darwin") {
		return path.join(os.homedir(), "Library", "Application Support", "Microsoft Edge")
	}
	return path.join(os.homedir(), ".config", "microsoft-edge")
}

/**
 * 检测用户已安装的浏览器，按优先级返回：Chrome > Edge > Chromium。
 */
export async function detectBestBrowser(): Promise<BrowserDetectionResult> {
	const platform = os.platform()

	const chromePath = await findChrome(platform)
	if (chromePath) {
		return { channel: "chrome", executablePath: chromePath, reason: `检测到 Chrome: ${chromePath}` }
	}

	const edgePath = await findEdge(platform)
	if (edgePath) {
		return { channel: "msedge", executablePath: edgePath, reason: `检测到 Edge: ${edgePath}` }
	}

	return { channel: "chromium", reason: "未检测到 Chrome/Edge，使用 Playwright 自带 Chromium" }
}

async function findChrome(platform: string): Promise<string | undefined> {
	const candidates: string[] = []
	if (platform === "win32") {
		const programFiles = process.env["ProgramFiles"] || "C:\\Program Files"
		const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"
		const localAppData = process.env["LOCALAPPDATA"] || path.join(os.homedir(), "AppData", "Local")
		candidates.push(
			path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
			path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
			path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
		)
	} else if (platform === "darwin") {
		candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
	} else {
		candidates.push("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/snap/bin/chromium")
	}

	for (const candidate of candidates) {
		if (await fileExists(candidate)) return candidate
	}
	return undefined
}

async function findEdge(platform: string): Promise<string | undefined> {
	const candidates: string[] = []
	if (platform === "win32") {
		const programFiles = process.env["ProgramFiles"] || "C:\\Program Files"
		const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"
		candidates.push(
			path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
			path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
		)
	} else if (platform === "darwin") {
		candidates.push("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")
	} else {
		candidates.push("/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable")
	}

	for (const candidate of candidates) {
		if (await fileExists(candidate)) return candidate
	}
	return undefined
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

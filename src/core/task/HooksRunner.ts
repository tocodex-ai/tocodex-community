/**
 * HooksRunner — 用户自定义 Hooks 系统
 *
 * 读取 `.tocodex/hooks.json` 配置，在工具执行前后和任务完成时
 * 运行用户指定的 shell 命令。
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5
 */

import * as path from "path"
import * as fs from "fs/promises"
import { exec } from "child_process"

// ── 类型定义 ──────────────────────────────────────────────

export interface HookEntry {
	/** 要执行的 shell 命令 */
	command: string
	/** 只对指定工具触发（为空或未设置则对所有工具触发） */
	toolFilter?: string[]
	/** 超时时间（毫秒），默认 30_000 */
	timeout?: number
}

export interface HookConfig {
	PreToolUse?: HookEntry[]
	PostToolUse?: HookEntry[]
	Stop?: HookEntry[]
}

export interface HookResult {
	exitCode: number
	stdout: string
	stderr: string
	/** 失败时注入对话上下文的文本 */
	injectedContext?: string
}

const DEFAULT_TIMEOUT = 30_000

// ── HooksRunner ──────────────────────────────────────────

export class HooksRunner {
	private config: HookConfig | null = null
	private configLoaded = false
	private readonly cwd: string

	constructor(cwd: string) {
		this.cwd = cwd
	}

	/**
	 * 从 `.tocodex/hooks.json` 加载配置（懒加载，只读一次）
	 */
	async loadConfig(): Promise<HookConfig | null> {
		if (this.configLoaded) {
			return this.config
		}
		this.configLoaded = true

		const configPath = path.join(this.cwd, ".tocodex", "hooks.json")
		try {
			const raw = await fs.readFile(configPath, "utf-8")
			this.config = JSON.parse(raw) as HookConfig
		} catch {
			// 文件不存在或解析失败，静默降级
			this.config = null
		}
		return this.config
	}

	/**
	 * 强制重新加载配置（用于测试或配置变更后）
	 */
	reloadConfig(): void {
		this.configLoaded = false
		this.config = null
	}

	/**
	 * 执行 PreToolUse hooks
	 * Requirements: 15.1
	 */
	async runPreToolUse(toolName: string, params: unknown): Promise<HookResult[]> {
		return this.runHooks("PreToolUse", toolName, {
			TOOL_NAME: toolName,
			TOOL_PARAMS: typeof params === "string" ? params : JSON.stringify(params ?? {}),
		})
	}

	/**
	 * 执行 PostToolUse hooks
	 * Requirements: 15.2
	 */
	async runPostToolUse(toolName: string, result: unknown): Promise<HookResult[]> {
		return this.runHooks("PostToolUse", toolName, {
			TOOL_NAME: toolName,
			TOOL_RESULT: typeof result === "string" ? result : JSON.stringify(result ?? {}),
		})
	}

	/**
	 * 执行 Stop hooks（任务完成时）
	 * Requirements: 15.3
	 */
	async runStop(taskId: string): Promise<HookResult[]> {
		return this.runHooks("Stop", undefined, {
			TASK_ID: taskId,
		})
	}

	// ── 内部方法 ──────────────────────────────────────────

	/**
	 * 运行指定阶段的所有匹配 hooks
	 */
	private async runHooks(
		phase: keyof HookConfig,
		toolName: string | undefined,
		envVars: Record<string, string>,
	): Promise<HookResult[]> {
		const config = await this.loadConfig()
		if (!config) {
			return []
		}

		const entries = config[phase]
		if (!entries || entries.length === 0) {
			return []
		}

		// 过滤匹配的 hooks
		const matched = entries.filter((entry) => {
			if (!entry.toolFilter || entry.toolFilter.length === 0) {
				return true
			}
			return toolName !== undefined && entry.toolFilter.includes(toolName)
		})

		const results: HookResult[] = []
		for (const entry of matched) {
			const result = await this.executeCommand(entry.command, entry.timeout ?? DEFAULT_TIMEOUT, envVars)
			results.push(result)
		}
		return results
	}

	/**
	 * 执行单个 shell 命令
	 * Requirements: 15.4, 15.5
	 */
	private executeCommand(command: string, timeout: number, envVars: Record<string, string>): Promise<HookResult> {
		return new Promise((resolve) => {
			const env = { ...process.env, ...envVars }

			const child = exec(command, { cwd: this.cwd, timeout, env }, (error, stdout, stderr) => {
				const exitCode = error ? ((error as any).code ?? 1) : 0
				const stdoutStr = (stdout ?? "").toString()
				const stderrStr = (stderr ?? "").toString()

				let injectedContext: string | undefined
				if (exitCode !== 0) {
					// Requirements: 15.4 — 失败时将错误输出注入对话上下文
					injectedContext = `[Hook 失败] 命令: ${command}\n退出码: ${exitCode}\nstderr: ${stderrStr}`
				}

				resolve({
					exitCode,
					stdout: stdoutStr,
					stderr: stderrStr,
					injectedContext,
				})
			})

			// 超时后强制终止
			child.on("error", () => {
				resolve({
					exitCode: 1,
					stdout: "",
					stderr: `Hook 命令执行出错: ${command}`,
					injectedContext: `[Hook 错误] 命令 "${command}" 执行出错`,
				})
			})
		})
	}
}

import * as fs from "fs/promises"
import * as path from "path"
import type { TodoItem } from "@roo-code/types"

/**
 * 任务进度持久化文件格式
 * 存储路径: .tocodex/progress/<task-id>.json
 * 归档路径: .tocodex/progress/archive/<task-id>.json
 */
export interface PersistedProgress {
	taskId: string
	todos: TodoItem[]
	lastUpdated: number
	status: "active" | "archived"
}

/**
 * 任务进度持久化管理器
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */
export class TaskProgressPersistence {
	private readonly progressDir: string
	private readonly archiveDir: string

	constructor(cwd: string) {
		this.progressDir = path.join(cwd, ".tocodex", "progress")
		this.archiveDir = path.join(cwd, ".tocodex", "progress", "archive")
	}

	/**
	 * 保存任务进度到 .tocodex/progress/<task-id>.json
	 * Requirements: 7.1
	 */
	async save(taskId: string, todos: TodoItem[]): Promise<void> {
		await fs.mkdir(this.progressDir, { recursive: true })

		const progress: PersistedProgress = {
			taskId,
			todos,
			lastUpdated: Date.now(),
			status: "active",
		}

		const filePath = path.join(this.progressDir, `${taskId}.json`)
		await fs.writeFile(filePath, JSON.stringify(progress, null, 2), "utf-8")
	}

	/**
	 * 从 .tocodex/progress/<task-id>.json 加载任务进度
	 * Requirements: 7.2, 7.5
	 */
	async load(taskId: string): Promise<PersistedProgress | null> {
		const filePath = path.join(this.progressDir, `${taskId}.json`)
		try {
			const raw = await fs.readFile(filePath, "utf-8")
			const progress: PersistedProgress = JSON.parse(raw)
			if (!progress.taskId || !Array.isArray(progress.todos)) {
				return null
			}
			return progress
		} catch {
			// 文件不存在或损坏，返回 null (Requirements: 7.5)
			return null
		}
	}

	/**
	 * 归档已完成的任务进度到 .tocodex/progress/archive/
	 * Requirements: 7.3
	 */
	async archive(taskId: string): Promise<void> {
		const srcPath = path.join(this.progressDir, `${taskId}.json`)

		try {
			const raw = await fs.readFile(srcPath, "utf-8")
			const progress: PersistedProgress = JSON.parse(raw)
			progress.status = "archived"
			progress.lastUpdated = Date.now()

			await fs.mkdir(this.archiveDir, { recursive: true })
			const destPath = path.join(this.archiveDir, `${taskId}.json`)
			await fs.writeFile(destPath, JSON.stringify(progress, null, 2), "utf-8")

			// 删除原始进度文件
			await fs.unlink(srcPath).catch(() => {})
		} catch {
			// 源文件不存在，静默忽略
		}
	}

	/**
	 * 列出所有进行中的任务进度
	 * Requirements: 7.4
	 */
	async listActive(): Promise<PersistedProgress[]> {
		const results: PersistedProgress[] = []

		try {
			const files = await fs.readdir(this.progressDir)
			for (const file of files) {
				if (!file.endsWith(".json")) continue
				const filePath = path.join(this.progressDir, file)

				// 跳过 archive 目录
				try {
					const stat = await fs.stat(filePath)
					if (stat.isDirectory()) continue
				} catch {
					continue
				}

				try {
					const raw = await fs.readFile(filePath, "utf-8")
					const progress: PersistedProgress = JSON.parse(raw)
					if (progress.taskId && Array.isArray(progress.todos) && progress.status === "active") {
						results.push(progress)
					}
				} catch {
					// 跳过损坏的文件 (Requirements: 7.5)
				}
			}
		} catch {
			// 目录不存在，返回空列表
		}

		return results
	}
}

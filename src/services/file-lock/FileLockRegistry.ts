/**
 * 文件锁注册表：防止并行子任务同时写入同一文件。
 * 每个子任务在派发时注册其操作的文件范围，写文件前检查锁。
 */
export class FileLockRegistry {
	// taskId → 锁定的文件路径集合
	private locks: Map<string, Set<string>> = new Map()

	/**
	 * 为指定任务注册文件锁。
	 * @param taskId 任务 ID
	 * @param files 该任务操作的文件路径列表（相对路径）
	 */
	register(taskId: string, files: string[]): void {
		const normalized = new Set(files.map((f) => this.normalize(f)))
		this.locks.set(taskId, normalized)
	}

	/**
	 * 检查指定文件是否被其他任务锁定。
	 * @param taskId 当前任务 ID
	 * @param filePath 要操作的文件路径
	 * @returns 锁定该文件的其他任务 ID，未锁定则返回 undefined
	 */
	isLockedByOther(taskId: string, filePath: string): string | undefined {
		const normalized = this.normalize(filePath)
		for (const [lockedTaskId, files] of this.locks) {
			if (lockedTaskId !== taskId && files.has(normalized)) {
				return lockedTaskId
			}
		}
		return undefined
	}

	/**
	 * 尝试获取文件写入锁。如果文件未被其他任务锁定，自动注册并返回 true。
	 * 如果已被其他任务锁定，返回 false。
	 * 用于并行子任务写文件时的动态锁定（无需提前声明 files）。
	 */
	tryAcquire(taskId: string, filePath: string): { acquired: boolean; lockedBy?: string } {
		const normalized = this.normalize(filePath)
		for (const [lockedTaskId, files] of this.locks) {
			if (lockedTaskId !== taskId && files.has(normalized)) {
				return { acquired: false, lockedBy: lockedTaskId }
			}
		}
		// 未被锁定，自动注册
		if (!this.locks.has(taskId)) {
			this.locks.set(taskId, new Set())
		}
		this.locks.get(taskId)!.add(normalized)
		return { acquired: true }
	}

	/**
	 * 释放指定任务的所有文件锁。
	 */
	release(taskId: string): void {
		this.locks.delete(taskId)
	}

	/**
	 * 清除所有文件锁。
	 */
	clear(): void {
		this.locks.clear()
	}

	/**
	 * 获取当前所有锁的快照（调试用）。
	 */
	snapshot(): Record<string, string[]> {
		const result: Record<string, string[]> = {}
		for (const [taskId, files] of this.locks) {
			result[taskId] = Array.from(files)
		}
		return result
	}

	private normalize(filePath: string): string {
		return filePath.replace(/\\/g, "/").toLowerCase()
	}
}

// 全局单例
export const fileLockRegistry = new FileLockRegistry()

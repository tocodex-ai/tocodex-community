/**
 * FileReadCache - 基于 mtime 的内存 LRU 文件读取缓存。
 *
 * 在同一任务中避免重复读取同一文件，减少 IO 和 token 消耗。
 * - key = 文件路径 + mtime
 * - 最多缓存 500 条，超出时按 LRU 淘汰
 * - 文件被写入后立即失效
 * - 任务结束时清空
 */

export interface CacheEntry {
	content: string
	mtime: number
	size: number
	cachedAt: number
}

/**
 * 简单的 LRU 缓存实现，利用 Map 的插入顺序特性。
 */
export class FileReadCache {
	private static instance: FileReadCache | null = null
	private cache: Map<string, CacheEntry>
	private readonly maxSize: number

	constructor(maxSize: number = 500) {
		this.maxSize = maxSize
		this.cache = new Map()
	}

	/**
	 * 获取单例实例。
	 */
	static getInstance(): FileReadCache {
		if (!FileReadCache.instance) {
			FileReadCache.instance = new FileReadCache()
		}
		return FileReadCache.instance
	}

	/**
	 * 重置单例（仅用于测试）。
	 */
	static resetInstance(): void {
		FileReadCache.instance = null
	}

	/**
	 * 查询缓存。如果路径存在且 mtime 匹配，返回缓存内容并刷新 LRU 位置。
	 */
	get(filePath: string, mtime: number): string | undefined {
		const entry = this.cache.get(filePath)
		if (!entry) {
			return undefined
		}

		// mtime 不匹配说明文件已被外部修改，缓存失效
		if (entry.mtime !== mtime) {
			this.cache.delete(filePath)
			return undefined
		}

		// 刷新 LRU 位置：删除后重新插入到末尾
		this.cache.delete(filePath)
		this.cache.set(filePath, entry)

		return entry.content
	}

	/**
	 * 写入缓存。超出容量时淘汰最久未使用的条目。
	 */
	set(filePath: string, content: string, mtime: number): void {
		// 如果已存在，先删除以刷新位置
		if (this.cache.has(filePath)) {
			this.cache.delete(filePath)
		}

		// LRU 淘汰：删除最早插入的条目
		while (this.cache.size >= this.maxSize) {
			const oldestKey = this.cache.keys().next().value
			if (oldestKey !== undefined) {
				this.cache.delete(oldestKey)
			} else {
				break
			}
		}

		this.cache.set(filePath, {
			content,
			mtime,
			size: content.length,
			cachedAt: Date.now(),
		})
	}

	/**
	 * 使指定文件的缓存失效（文件被写入后调用）。
	 */
	invalidate(filePath: string): void {
		this.cache.delete(filePath)
	}

	/**
	 * 清空所有缓存（任务结束时调用）。
	 */
	clear(): void {
		this.cache.clear()
	}

	/**
	 * 当前缓存条目数。
	 */
	get size(): number {
		return this.cache.size
	}

	/**
	 * 检查指定文件是否在缓存中。
	 */
	has(filePath: string): boolean {
		return this.cache.has(filePath)
	}
}

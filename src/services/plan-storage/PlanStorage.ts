/**
 * 计划持久化服务。
 * 将 Plan Mode 中 AI 生成的架构设计和执行计划保存到 .tocodex/plans/ 目录，
 * 供后续任务快速读取，帮助 AI 了解项目需求和设计决策。
 */
import fs from "fs/promises"
import path from "path"

const PLANS_DIR = "plans"
const ROO_DIR = ".tocodex"

/** 单个计划注入系统提示词的最大字符数 */
const MAX_PLAN_CHARS = 5000
/** 注入系统提示词的最大计划数量 */
const MAX_PLANS_IN_PROMPT = 1
/** 计划有效期（毫秒），超过此时间的计划不加载到上下文 */
const PLAN_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000 // 3 天

/** 计划状态 */
export type PlanStatus = "active" | "completed" | "superseded"

/**
 * 获取计划存储目录路径
 */
function getPlansDir(cwd: string): string {
	return path.join(cwd, ROO_DIR, PLANS_DIR)
}

/**
 * 确保计划目录存在
 */
async function ensurePlansDir(cwd: string): Promise<string> {
	const plansDir = getPlansDir(cwd)
	await fs.mkdir(plansDir, { recursive: true })
	return plansDir
}

/**
 * 生成计划文件名：YYYY-MM-DD_HH-MM-SS_<slug>.md
 */
function generatePlanFilename(title: string): string {
	const now = new Date()
	const timestamp = now.toISOString().replace(/[T]/g, "_").replace(/[:]/g, "-").slice(0, 19)
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 50)
	return `${timestamp}_${slug || "plan"}.md`
}

/**
 * 从文件名中解析创建时间。
 * 文件名格式：YYYY-MM-DD_HH-MM-SS_<slug>.md
 */
function parseTimestampFromFilename(filename: string): Date | null {
	const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/)
	if (!match) return null
	const [, year, month, day, hour, minute, second] = match
	return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`)
}

/**
 * 从计划内容中提取标题（第一个 # 标题或前30个字符）
 */
function extractTitle(content: string): string {
	const lines = content.split("\n")
	for (const line of lines) {
		const trimmed = line.trim()
		if (trimmed.startsWith("# ")) {
			return trimmed.slice(2).trim()
		}
	}
	return content.trim().slice(0, 30).replace(/\n/g, " ")
}

/**
 * 从计划文件内容中解析 front-matter 中的 status 字段。
 * 如果没有 front-matter 或没有 status 字段，返回 "active"（向后兼容旧文件）。
 */
function parsePlanStatus(content: string): PlanStatus {
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
	if (!fmMatch) return "active"
	const statusMatch = fmMatch[1].match(/^status:\s*(.+)$/m)
	if (!statusMatch) return "active"
	const status = statusMatch[1].trim()
	if (status === "completed" || status === "superseded") return status
	return "active"
}

/**
 * 截断计划内容，超出字符限制时添加省略提示
 */
function truncatePlanContent(content: string, maxChars: number): string {
	if (content.length <= maxChars) return content
	return content.slice(0, maxChars) + "\n\n... [truncated, see full plan in .tocodex/plans/]"
}

/**
 * 保存计划到 .tocodex/plans/ 目录。
 * 新保存的计划默认状态为 active。
 * @returns 保存的文件路径（相对于 cwd）
 */
export async function savePlan(cwd: string, planContent: string, reason?: string): Promise<string> {
	const plansDir = await ensurePlansDir(cwd)
	const title = extractTitle(planContent)
	const filename = generatePlanFilename(title)
	const filePath = path.join(plansDir, filename)

	const header = [
		"---",
		`created: ${new Date().toISOString()}`,
		`status: active`,
		reason ? `reason: ${reason}` : null,
		"---",
		"",
	]
		.filter((line) => line !== null)
		.join("\n")

	await fs.writeFile(filePath, header + planContent, "utf-8")

	return path.relative(cwd, filePath)
}

/**
 * 更新计划文件的 status 字段。
 * 如果文件有 front-matter，替换其中的 status；如果没有，添加 front-matter。
 */
export async function updatePlanStatus(cwd: string, filename: string, status: PlanStatus): Promise<void> {
	const plansDir = getPlansDir(cwd)
	const filePath = path.join(plansDir, filename)

	try {
		let content = await fs.readFile(filePath, "utf-8")
		const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---)/)

		if (fmMatch) {
			let frontMatter = fmMatch[2]
			if (/^status:\s*.+$/m.test(frontMatter)) {
				// 替换已有的 status
				frontMatter = frontMatter.replace(/^status:\s*.+$/m, `status: ${status}`)
			} else {
				// 添加 status 字段
				frontMatter += `\nstatus: ${status}`
			}
			content = `${fmMatch[1]}${frontMatter}${fmMatch[3]}${content.slice(fmMatch[0].length)}`
		} else {
			// 没有 front-matter，添加一个
			content = `---\nstatus: ${status}\n---\n${content}`
		}

		await fs.writeFile(filePath, content, "utf-8")
	} catch {
		// 文件不存在或写入失败，静默忽略
	}
}

/**
 * 将指定计划标记为已完成。
 */
export async function markPlanCompleted(cwd: string, filename: string): Promise<void> {
	await updatePlanStatus(cwd, filename, "completed")
}

/**
 * 读取所有已保存的计划（按时间倒序）
 * @returns 计划内容数组，包含文件名、内容和状态
 */
export async function loadPlans(
	cwd: string,
): Promise<Array<{ filename: string; content: string; status: PlanStatus }>> {
	const plansDir = getPlansDir(cwd)

	try {
		const entries = await fs.readdir(plansDir, { withFileTypes: true })
		const mdFiles = entries
			.filter((e) => e.isFile() && e.name.endsWith(".md"))
			.sort((a, b) => b.name.localeCompare(a.name))

		const plans: Array<{ filename: string; content: string; status: PlanStatus }> = []
		for (const file of mdFiles) {
			try {
				const content = await fs.readFile(path.join(plansDir, file.name), "utf-8")
				const status = parsePlanStatus(content)
				plans.push({ filename: file.name, content: content.trim(), status })
			} catch {
				// 跳过无法读取的文件
			}
		}
		return plans
	} catch {
		return []
	}
}

/**
 * 加载计划摘要，用于注入系统提示词。
 * 限制条件：最近 3 天内、仅 active 状态、最多 1 个、每个最多 5000 字符。
 * 已完成（completed）和被替代（superseded）的计划不会注入上下文。
 */
export async function loadPlansSummary(cwd: string, maxPlans: number = MAX_PLANS_IN_PROMPT): Promise<string> {
	const plans = await loadPlans(cwd)
	if (plans.length === 0) return ""

	const now = Date.now()

	// 过滤：只保留最近 3 天内且状态为 active 的计划
	const activePlans = plans.filter((p) => {
		if (p.status !== "active") return false
		const ts = parseTimestampFromFilename(p.filename)
		if (!ts) return false
		return now - ts.getTime() <= PLAN_MAX_AGE_MS
	})

	if (activePlans.length === 0) return ""

	const selected = activePlans.slice(0, maxPlans)
	const sections = selected.map((p) => `## ${p.filename}\n${truncatePlanContent(p.content, MAX_PLAN_CHARS)}`)

	return `\n# Saved Plans (.tocodex/plans/)\n\nThe following is the most recent active plan created within the last 3 days. Completed and superseded plans are excluded. For all plans, check .tocodex/plans/ directly.\n\n${sections.join("\n\n---\n\n")}\n`
}

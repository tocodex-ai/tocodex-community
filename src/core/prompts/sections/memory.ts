/**
 * 记忆注入模块 — 将跨会话记忆注入系统提示
 *
 * 加载两份记忆并分别注入：
 *  - 项目记忆：{cwd}/.tocodex/memory/<project-hash>/MEMORY.md，包裹在 <memory> 块
 *  - 全局记忆：{globalStoragePath}/memory/GLOBAL_MEMORY.md，包裹在 <global_memory> 块
 *
 * Requirements: 2.2 + 全局记忆扩展
 */

import { MemoryManager } from "../../../services/memory/MemoryManager"

/**
 * 获取记忆注入段落。
 * 全局记忆和项目记忆分别加载，互不影响；都为空时返回空字符串。
 *
 * @param cwd - 工作区根目录
 * @param globalStoragePath - VS Code 全局存储路径（可选；缺省则仅注入项目记忆）
 * @returns 格式化的 <global_memory> + <memory> 块，或空字符串
 */
export async function getMemorySection(cwd: string, globalStoragePath?: string): Promise<string> {
	let projectContent = ""
	let globalContent = ""

	// 项目记忆
	try {
		const projectMgr = new MemoryManager({ scope: "project", cwd })
		projectContent = await projectMgr.loadMemory()
	} catch {
		projectContent = ""
	}

	// 全局记忆
	if (globalStoragePath) {
		try {
			const globalMgr = new MemoryManager({ scope: "global", globalStoragePath })
			globalContent = await globalMgr.loadMemory()
		} catch {
			globalContent = ""
		}
	}

	const hasAny = !!projectContent || !!globalContent

	const parts: string[] = []

	if (globalContent) {
		parts.push(`<global_memory>
${globalContent}
</global_memory>`)
	}

	if (projectContent) {
		parts.push(`<memory>
${projectContent}
</memory>`)
	}

	// 引导：让模型知道两类记忆的边界以及如何让用户主动保存
	const guidance = `<memory_guidance>
- <global_memory> 中的条目是跨工作区的用户偏好/通用规则，必须始终遵守。
- <memory> 中的条目是当前工作区相关的项目知识，可作为优先参考。
- 当用户明确说"记住xxx"、"下次注意xxx"、"以后都xxx"等指令时：
	 * 若是与本项目相关的事实/路径/约定，建议用户用 /remember <内容>
	 * 若是跨项目通用偏好或规则，建议用户用 /remember-global <内容>
- 不要把用户敏感信息（密钥、密码、个人隐私）写入任何记忆。
</memory_guidance>`

	if (!hasAny) {
		// 即使尚无记忆也注入指引（轻量，~300 字），便于模型理解 /remember 系列命令
		return `

====

${guidance}`
	}

	return `

====

${parts.join("\n\n")}

${guidance}`
}

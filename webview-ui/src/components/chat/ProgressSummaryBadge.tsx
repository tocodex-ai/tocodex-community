/**
 * ProgressSummaryBadge — 实时任务进度摘要徽章
 *
 * 在 TaskHeader 下方显示当前 AI 正在做什么的简短摘要。
 * 任务运行 10s 后开始显示，任务完成后自动隐藏。
 *
 * Requirements: 3.1, 3.3
 */

import { memo } from "react"
import { Loader2 } from "lucide-react"

interface ProgressSummaryBadgeProps {
	summary: string | null
}

const ProgressSummaryBadge = ({ summary }: ProgressSummaryBadgeProps) => {
	if (!summary) {
		return null
	}

	return (
		<div
			className="flex items-center gap-1.5 px-3 py-1 text-xs text-vscode-descriptionForeground"
			data-testid="progress-summary-badge"
			role="status"
			aria-live="polite"
			aria-label={summary}>
			<Loader2 className="size-3 animate-spin shrink-0" />
			<span className="truncate">{summary}</span>
		</div>
	)
}

export default memo(ProgressSummaryBadge)

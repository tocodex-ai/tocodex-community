import React, { memo } from "react"
import { GitBranch, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react"
import { vscode } from "@src/utils/vscode"

/**
 * 单个并行子任务的状态
 */
export interface ParallelChildInfo {
	taskId: string
	description: string
	status: "pending" | "running" | "completed" | "failed"
	startedAt: number
	completedAt?: number
	files?: string[]
	result?: string
	error?: string
}

interface ParallelTasksPanelProps {
	children: ParallelChildInfo[]
}

/**
 * 并行任务状态面板组件。
 * 展示当前任务的各并行子任务状态和进度。
 */
const ParallelTasksPanel: React.FC<ParallelTasksPanelProps> = ({ children }) => {
	if (!children || children.length === 0) {
		return null
	}

	const runningCount = children.filter((c) => c.status === "running").length
	const completedCount = children.filter((c) => c.status === "completed").length
	const failedCount = children.filter((c) => c.status === "failed").length

	return (
		<div
			role="region"
			aria-label="Parallel tasks status"
			className="mt-2 -mx-2.5 px-2.5 pt-2 border-t border-vscode-sideBar-background">
			<div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-vscode-descriptionForeground">
				<GitBranch className="size-3.5" aria-hidden="true" />
				<span>
					并行子任务 ({completedCount + failedCount}/{children.length})
					{runningCount > 0 && <span className="ml-1 text-vscode-charts-blue">· {runningCount} 运行中</span>}
				</span>
			</div>
			<div className="flex flex-col gap-1">
				{children.map((child) => (
					<div key={child.taskId || child.description}>
						<div
							className="flex items-center gap-2 px-2 py-1 rounded text-xs text-left w-full
								bg-transparent border border-vscode-widget-border/30"
							aria-label={`${child.description} - ${statusLabel(child.status)}`}>
							<StatusIcon status={child.status} />
							<span className="flex-1 min-w-0 truncate">{child.description}</span>
							{child.status === "running" && child.startedAt > 0 && (
								<ElapsedTime startedAt={child.startedAt} />
							)}
							{child.status === "completed" && child.completedAt && child.startedAt > 0 && (
								<span className="text-vscode-descriptionForeground shrink-0">
									{formatDuration(child.completedAt - child.startedAt)}
								</span>
							)}
						</div>
						{child.files &&
							child.files.length > 0 &&
							(child.status === "completed" || child.status === "failed") && (
								<div className="pl-7 flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5 mb-0.5">
									{child.files.map((file, fi) => (
										<span
											key={fi}
											className="text-[11px] text-vscode-textLink-foreground cursor-pointer hover:underline"
											onClick={() => vscode.postMessage({ type: "openFile", text: file })}>
											{file.split("/").pop()}
										</span>
									))}
								</div>
							)}
						{child.status === "failed" && child.error && (
							<div className="pl-7 mt-0.5 mb-0.5 text-[11px] text-vscode-errorForeground break-words">
								{child.error}
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	)
}

function StatusIcon({ status }: { status: ParallelChildInfo["status"] }) {
	switch (status) {
		case "running":
			return <Loader2 className="size-3.5 shrink-0 text-vscode-charts-blue animate-spin" aria-hidden="true" />
		case "completed":
			return <CheckCircle2 className="size-3.5 shrink-0 text-vscode-charts-green" aria-hidden="true" />
		case "failed":
			return <XCircle className="size-3.5 shrink-0 text-vscode-errorForeground" aria-hidden="true" />
		case "pending":
		default:
			return <Clock className="size-3.5 shrink-0 text-vscode-descriptionForeground" aria-hidden="true" />
	}
}

function statusLabel(status: ParallelChildInfo["status"]): string {
	switch (status) {
		case "running":
			return "运行中"
		case "completed":
			return "已完成"
		case "failed":
			return "失败"
		case "pending":
		default:
			return "等待中"
	}
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000)
	if (seconds < 60) return `${seconds}s`
	const minutes = Math.floor(seconds / 60)
	const remainingSeconds = seconds % 60
	return `${minutes}m${remainingSeconds > 0 ? ` ${remainingSeconds}s` : ""}`
}

function ElapsedTime({ startedAt }: { startedAt: number }) {
	const [elapsed, setElapsed] = React.useState(() => Date.now() - startedAt)

	React.useEffect(() => {
		const timer = setInterval(() => {
			setElapsed(Date.now() - startedAt)
		}, 1000)
		return () => clearInterval(timer)
	}, [startedAt])

	return <span className="text-vscode-descriptionForeground shrink-0">{formatDuration(elapsed)}</span>
}

export default memo(ParallelTasksPanel)

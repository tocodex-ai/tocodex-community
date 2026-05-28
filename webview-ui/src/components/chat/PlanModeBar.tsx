import React from "react"
import { ClipboardList, Check, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { vscode } from "@src/utils/vscode"

interface PlanModeBarProps {
	isVisible: boolean
	/** 是否禁用按钮（如任务正在流式输出时） */
	buttonsDisabled?: boolean
}

/**
 * 规划模式状态栏组件。
 * 当任务处于规划模式时，在聊天界面顶部显示橙色横幅，
 * 提示用户当前处于规划模式，只允许只读操作。
 * 提供确认/拒绝按钮，让用户可以主动控制规划模式的退出。
 *
 * Requirements: 8.3, 8.5, 8.6
 */
const PlanModeBar: React.FC<PlanModeBarProps> = ({ isVisible, buttonsDisabled = false }) => {
	const { t } = useTranslation("chat")

	if (!isVisible) {
		return null
	}

	const handleConfirm = () => {
		if (buttonsDisabled) return
		// 发送消息让 AI 退出规划模式并执行计划
		vscode.postMessage({
			type: "askResponse",
			askResponse: "messageResponse",
			text: "Please exit plan mode and execute the plan now.",
		})
	}

	const handleReject = () => {
		if (buttonsDisabled) return
		// 发送消息让 AI 修改计划
		vscode.postMessage({
			type: "askResponse",
			askResponse: "messageResponse",
			text: "Please revise the plan. I have concerns about the current approach.",
		})
	}

	return (
		<div
			role="status"
			aria-label={t("planMode.ariaLabel")}
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "8px",
				padding: "6px 12px",
				backgroundColor: "rgba(255, 165, 0, 0.15)",
				borderBottom: "1px solid rgba(255, 165, 0, 0.4)",
				color: "var(--vscode-editor-foreground)",
				fontSize: "12px",
				fontWeight: 500,
			}}>
			<div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
				<ClipboardList
					className="w-4 h-4 shrink-0"
					style={{ color: "var(--vscode-charts-orange)" }}
					aria-hidden="true"
				/>
				<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
					{t("planMode.statusMessage")}
				</span>
			</div>
			<div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
				<button
					type="button"
					aria-label={t("planMode.confirmAriaLabel")}
					disabled={buttonsDisabled}
					onClick={handleConfirm}
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: "4px",
						padding: "2px 10px",
						fontSize: "11px",
						fontWeight: 600,
						border: "1px solid var(--vscode-charts-green, #4caf50)",
						borderRadius: "3px",
						backgroundColor: "rgba(76, 175, 80, 0.15)",
						color: "var(--vscode-charts-green, #4caf50)",
						cursor: buttonsDisabled ? "not-allowed" : "pointer",
						opacity: buttonsDisabled ? 0.5 : 1,
						lineHeight: "20px",
					}}>
					<Check className="w-3 h-3" aria-hidden="true" />
					{t("planMode.confirmButton")}
				</button>
				<button
					type="button"
					aria-label={t("planMode.rejectAriaLabel")}
					disabled={buttonsDisabled}
					onClick={handleReject}
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: "4px",
						padding: "2px 10px",
						fontSize: "11px",
						fontWeight: 600,
						border: "1px solid var(--vscode-errorForeground, #f44336)",
						borderRadius: "3px",
						backgroundColor: "rgba(244, 67, 54, 0.15)",
						color: "var(--vscode-errorForeground, #f44336)",
						cursor: buttonsDisabled ? "not-allowed" : "pointer",
						opacity: buttonsDisabled ? 0.5 : 1,
						lineHeight: "20px",
					}}>
					<X className="w-3 h-3" aria-hidden="true" />
					{t("planMode.rejectButton")}
				</button>
			</div>
		</div>
	)
}

export default PlanModeBar

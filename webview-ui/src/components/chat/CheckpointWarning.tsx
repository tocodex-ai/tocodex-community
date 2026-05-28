import { useEffect, useState } from "react"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Trans } from "react-i18next"

interface CheckpointWarningProps {
	warning: {
		type: "WAIT_TIMEOUT" | "INIT_TIMEOUT"
		timeout: number
	}
	onDismiss?: () => void
}

export const CheckpointWarning = ({ warning, onDismiss }: CheckpointWarningProps) => {
	const [visible, setVisible] = useState(true)

	// INIT_TIMEOUT 表示初始化彻底失败，只显示一次然后自动消失
	useEffect(() => {
		if (warning.type === "INIT_TIMEOUT") {
			const timer = setTimeout(() => {
				setVisible(false)
				onDismiss?.()
			}, 5000)
			return () => clearTimeout(timer)
		}
	}, [warning.type, onDismiss])

	// 重置 visible 状态当 warning 变化时
	useEffect(() => {
		setVisible(true)
	}, [warning.type, warning.timeout])

	if (!visible) {
		return null
	}

	const settingsLink = (
		<VSCodeLink
			href="#"
			onClick={(e) => {
				e.preventDefault()
				window.postMessage(
					{
						type: "action",
						action: "settingsButtonClicked",
						values: { section: "checkpoints" },
					},
					"*",
				)
			}}
			className="inline"
		/>
	)

	const isTimeout = warning.type === "INIT_TIMEOUT"

	// WAIT_TIMEOUT: 还在等待中，显示转圈
	// INIT_TIMEOUT: 已失败，显示警告图标，不转圈
	const i18nKey = isTimeout ? "errors.init_checkpoint_fail_long_time" : "errors.wait_checkpoint_long_time"

	return (
		<div
			className={`flex items-center p-3 my-3 rounded ${
				isTimeout
					? "bg-vscode-inputValidation-warningBackground border border-vscode-inputValidation-warningBorder opacity-90"
					: "bg-vscode-inputValidation-warningBackground border border-vscode-inputValidation-warningBorder"
			}`}>
			{isTimeout ? (
				<span className="codicon codicon-warning mr-2" />
			) : (
				<span className="codicon codicon-loading codicon-modifier-spin mr-2" />
			)}
			<span className="text-vscode-foreground">
				<Trans
					i18nKey={i18nKey}
					ns="common"
					values={{ timeout: warning.timeout }}
					components={{ settingsLink }}
				/>
			</span>
		</div>
	)
}

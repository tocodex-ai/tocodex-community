import React from "react"
import { useTranslation } from "react-i18next"
import { Package } from "@roo/package"
import { useExtensionState } from "@src/context/ExtensionStateContext"

interface VersionIndicatorProps {
	className?: string
}

const VersionIndicator: React.FC<VersionIndicatorProps> = ({ className = "" }) => {
	const { t } = useTranslation()
	// 优先使用后端动态推送的版本号，回退到编译时注入的版本
	const { version: extensionVersion } = useExtensionState()
	const displayVersion = extensionVersion || Package.version

	return (
		<a
			href="https://tocodex.com"
			target="_blank"
			rel="noopener noreferrer"
			className={`text-xs text-vscode-descriptionForeground rounded-full hover:text-vscode-foreground transition-colors cursor-pointer px-2 py-1 border no-underline ${className}`}
			aria-label={t("chat:versionIndicator.ariaLabel", { version: displayVersion })}>
			v{displayVersion}
		</a>
	)
}

export default VersionIndicator

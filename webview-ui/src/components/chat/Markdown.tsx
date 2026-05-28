import { memo, useState } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import { useCopyToClipboard } from "@src/utils/clipboard"
import { StandardTooltip } from "@src/components/ui"

import MarkdownBlock from "../common/MarkdownBlock"

export const Markdown = memo(({ markdown, partial }: { markdown?: string; partial?: boolean }) => {
	const [isHovering, setIsHovering] = useState(false)
	const [copied, setCopied] = useState(false)

	// Shorter feedback duration for copy button flash.
	const { copyWithFeedback } = useCopyToClipboard(200)

	if (!markdown || markdown.length === 0) {
		return null
	}

	return (
		<div
			onMouseEnter={() => setIsHovering(true)}
			onMouseLeave={() => setIsHovering(false)}
			style={{ position: "relative" }}>
			<div style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
				<MarkdownBlock markdown={markdown} />
			</div>
			{markdown && !partial && (
				<div
					style={{
						position: "absolute",
						top: "0px",
						right: "8px",
						opacity: isHovering ? 1 : 0.25,
						transition: "opacity 0.15s ease-in-out",
						borderRadius: "4px",
					}}>
					<StandardTooltip content="Copy as markdown">
						<VSCodeButton
							className="copy-button"
							appearance="icon"
							style={{
								height: "24px",
								border: "none",
								background: isHovering ? "var(--vscode-editor-background)" : "transparent",
								transition: "background 0.2s ease-in-out",
							}}
							onClick={async () => {
								const success = await copyWithFeedback(markdown)
								if (success) {
									setCopied(true)
									setTimeout(() => setCopied(false), 1000)
								}
							}}>
							<span className={`codicon codicon-${copied ? "check" : "copy"}`} />
						</VSCodeButton>
					</StandardTooltip>
				</div>
			)}
		</div>
	)
})

/**
 * 返回 Markdown 格式规范段落。
 * 首轮返回完整规范，后续轮次返回精简版以节省 token。
 *
 * @param isFirstTurn - 是否为对话的首轮（默认 true，保持向后兼容）
 */
export function markdownFormattingSection(isFirstTurn: boolean = true): string {
	if (!isFirstTurn) {
		return `====

MARKDOWN RULES

Show \`language constructs\` and filenames as clickable: [\`name\`](relative/path.ext:line).`
	}

	return `====

MARKDOWN RULES

ALL responses MUST show ANY \`language construct\` OR filename reference as clickable, exactly as [\`filename OR language.declaration()\`](relative/file/path.ext:line); line is required for \`syntax\` and optional for filename links. This applies to ALL markdown responses and ALSO those in attempt_completion`
}

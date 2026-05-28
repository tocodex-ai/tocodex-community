/**
 * Settings passed to system prompt generation functions
 */
export interface SystemPromptSettings {
	todoListEnabled: boolean
	useAgentRules: boolean
	/** When true, recursively discover and load .tocodex/rules from subdirectories */
	enableSubfolderRules?: boolean
	newTaskRequireTodos: boolean
	/** When true, model should hide vendor/company identity in responses */
	isStealthModel?: boolean
	/** When true, load recent plans from .tocodex/plans/ into context for architect/code modes (default: true) */
	loadRecentPlans?: boolean
	/** When true, auto-generate task memos and include task-memo rules in system prompt (default: true) */
	autoGenerateTaskMemo?: boolean
}

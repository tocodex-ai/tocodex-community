import { SECRET_STATE_KEYS, GLOBAL_SECRET_KEYS, ProviderSettings } from "@roo-code/types"

export function checkExistKey(config: ProviderSettings | undefined) {
	if (!config) {
		return false
	}

	// Special case for fake-ai, openai-codex, and qwen-code providers which don't need any configuration.
	// Roo/ToCodex must not be treated as configuration-complete by provider alone:
	// the webview additionally checks cloudIsAuthenticated, and manual key binding
	// must drive that state explicitly instead of making stale/anonymous Roo configs
	// appear usable.
	if (config.apiProvider && ["fake-ai", "openai-codex", "qwen-code"].includes(config.apiProvider)) {
		return true
	}

	if (config.apiProvider === "roo") {
		return !!config.rooApiKey
	}

	// Check all secret keys from the centralized SECRET_STATE_KEYS array.
	// Filter out keys that are not part of ProviderSettings (global secrets are stored separately)
	const providerSecretKeys = SECRET_STATE_KEYS.filter((key) => !GLOBAL_SECRET_KEYS.includes(key as any))
	const hasSecretKey = providerSecretKeys.some((key) => config[key as keyof ProviderSettings] !== undefined)

	// Check additional non-secret configuration properties
	const hasOtherConfig = [
		config.awsRegion,
		config.vertexProjectId,
		config.ollamaModelId,
		config.lmStudioModelId,
		config.vsCodeLmModelSelector,
	].some((value) => value !== undefined)

	return hasSecretKey || hasOtherConfig
}

import * as vscode from "vscode"
import * as dotenvx from "@dotenvx/dotenvx"
import * as fs from "fs"
import * as path from "path"

// Load environment variables from .env file
// The extension-level .env is optional (not shipped in production builds).
// Avoid calling dotenvx when the file doesn't exist, otherwise dotenvx emits
// a noisy [MISSING_ENV_FILE] error to the extension host console.
const envPath = path.join(__dirname, "..", ".env")
if (fs.existsSync(envPath)) {
	try {
		dotenvx.config({ path: envPath })
	} catch (e) {
		// Best-effort only: never fail extension activation due to optional env loading.
		console.warn("Failed to load environment variables:", e)
	}
}

import type { CloudUserInfo, AuthState } from "@roo-code/types"
import { CloudService } from "@roo-code/cloud"
import { TelemetryService, NoopTelemetryClient } from "@roo-code/telemetry"
import { customToolRegistry } from "@roo-code/core"

import "./utils/path" // Necessary to have access to String.prototype.toPosix.
import { createOutputChannelLogger, createDualLogger } from "./utils/outputChannelLogger"
import { initializeNetworkProxy } from "./utils/networkProxy"

import { Package } from "./shared/package"
import { formatLanguage } from "./shared/language"
import { ContextProxy } from "./core/config/ContextProxy"
import { ClineProvider } from "./core/webview/ClineProvider"
import { DIFF_VIEW_URI_SCHEME } from "./integrations/editor/DiffViewProvider"
import { TerminalRegistry } from "./integrations/terminal/TerminalRegistry"
import { openAiCodexOAuthManager } from "./integrations/openai-codex/oauth"
import { McpServerManager } from "./services/mcp/McpServerManager"
import { CodeIndexManager } from "./services/code-index/manager"
import { MdmService } from "./services/mdm/MdmService"
import { migrateSettings } from "./utils/migrateSettings"
import { autoImportSettings } from "./utils/autoImportSettings"
import { API } from "./extension/api"

import {
	handleUri,
	registerCommands,
	registerCodeActions,
	registerTerminalActions,
	CodeActionProvider,
} from "./activate"
import { initializeI18n } from "./i18n"
import { DEFAULT_TOCODEX_API_URL } from "./api/providers/constants"
import { flushModels, refreshModels } from "./api/providers/fetchers/modelCache"

/**
 * Built using https://github.com/microsoft/vscode-webview-ui-toolkit
 *
 * Inspired by:
 *  - https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/default/weather-webview
 *  - https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-cra
 */

let outputChannel: vscode.OutputChannel
let extensionContext: vscode.ExtensionContext
let cloudService: CloudService | undefined

let authStateChangedHandler: ((data: { state: AuthState; previousState: AuthState }) => Promise<void>) | undefined
let settingsUpdatedHandler: (() => void) | undefined
let userInfoHandler: ((data: { userInfo: CloudUserInfo }) => Promise<void>) | undefined

/**
 * Check if we should auto-open the ToCodex sidebar after switching to a worktree.
 * This is called during extension activation to handle the worktree auto-open flow.
 */
async function checkWorktreeAutoOpen(
	context: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
): Promise<void> {
	try {
		const worktreeAutoOpenPath = context.globalState.get<string>("worktreeAutoOpenPath")
		if (!worktreeAutoOpenPath) {
			return
		}

		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return
		}

		const currentPath = workspaceFolders[0].uri.fsPath

		// Normalize paths for comparison
		const normalizePath = (p: string) => p.replace(/\/+$/, "").replace(/\\+/g, "/").toLowerCase()

		// Check if current workspace matches the worktree path
		if (normalizePath(currentPath) === normalizePath(worktreeAutoOpenPath)) {
			// Clear the state first to prevent re-triggering
			await context.globalState.update("worktreeAutoOpenPath", undefined)

			outputChannel.appendLine(`[Worktree] Auto-opening ToCodex sidebar for worktree: ${worktreeAutoOpenPath}`)

			// Open the ToCodex sidebar with a slight delay to ensure UI is ready
			setTimeout(async () => {
				try {
					await vscode.commands.executeCommand(`${Package.name}.plusButtonClicked`)
				} catch (error) {
					outputChannel.appendLine(
						`[Worktree] Error auto-opening sidebar: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}, 500)
		}
	} catch (error) {
		outputChannel.appendLine(
			`[Worktree] Error checking worktree auto-open: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

// This method is called when your extension is activated.
// Your extension is activated the very first time the command is executed.
export async function activate(context: vscode.ExtensionContext) {
	extensionContext = context
	outputChannel = vscode.window.createOutputChannel(Package.outputChannel)
	context.subscriptions.push(outputChannel)
	outputChannel.appendLine(`${Package.name} extension activated - ${JSON.stringify(Package)}`)

	// Initialize network proxy configuration early, before any network requests.
	// When proxyUrl is configured, all HTTP/HTTPS traffic will be routed through it.
	// Only applied in debug mode (F5).
	await initializeNetworkProxy(context, outputChannel)

	// Set extension path for custom tool registry to find bundled esbuild
	customToolRegistry.setExtensionPath(context.extensionPath)

	// Migrate old settings to new
	await migrateSettings(context, outputChannel)

	// Initialize telemetry service.
	const telemetryService = TelemetryService.createInstance()

	try {
		telemetryService.register(new NoopTelemetryClient())
	} catch (error) {
		console.warn("Failed to register no-op telemetry client:", error)
	}

	// Create logger for cloud services.
	const cloudLogger = createDualLogger(createOutputChannelLogger(outputChannel))

	// Initialize MDM service
	const mdmService = await MdmService.createInstance(cloudLogger)

	// Initialize i18n for internationalization support.
	initializeI18n(context.globalState.get("language") ?? formatLanguage(vscode.env.language))

	// Initialize terminal shell execution handlers.
	TerminalRegistry.initialize()

	// Initialize OpenAI Codex OAuth manager for ChatGPT subscription-based access.
	openAiCodexOAuthManager.initialize(context, (message) => outputChannel.appendLine(message))

	// Get default commands from configuration.
	const defaultCommands = vscode.workspace.getConfiguration(Package.name).get<string[]>("allowedCommands") || []

	// Initialize global state if not already set.
	if (!context.globalState.get("allowedCommands")) {
		context.globalState.update("allowedCommands", defaultCommands)
	}

	const contextProxy = await ContextProxy.getInstance(context)

	// 首次安装时设置默认模型为 gpt-5.4（仅当从未设置过 apiModelId 时）
	if (!contextProxy.getGlobalState("apiModelId") && !contextProxy.getGlobalState("apiProvider")) {
		await contextProxy.updateGlobalState("apiProvider", "roo")
		await contextProxy.updateGlobalState("apiModelId", "gpt-5.4")
	}

	// Initialize code index managers for all workspace folders.
	const codeIndexManagers: CodeIndexManager[] = []

	if (vscode.workspace.workspaceFolders) {
		for (const folder of vscode.workspace.workspaceFolders) {
			const manager = CodeIndexManager.getInstance(context, folder.uri.fsPath)

			if (manager) {
				codeIndexManagers.push(manager)

				// Initialize in background; do not block extension activation
				void manager.initialize(contextProxy).catch((error) => {
					const message = error instanceof Error ? error.message : String(error)
					outputChannel.appendLine(
						`[CodeIndexManager] Error during background CodeIndexManager configuration/indexing for ${folder.uri.fsPath}: ${message}`,
					)
				})

				context.subscriptions.push(manager)
			}
		}
	}

	// Initialize the provider *before* the ToCodex Cloud service.
	const provider = new ClineProvider(context, outputChannel, "sidebar", contextProxy, mdmService)

	// Initialize scheduled tasks system (background, non-blocking).
	provider.initializeScheduledTasks().catch((error) => {
		outputChannel.appendLine(
			`[ScheduledTasks] Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
		)
	})

	// Initialize ToCodex Cloud service.
	// 上一版登录正常时通过可见 webview 投递 state。这里保留上一版行为，
	// 仅在 OAuth 切回时 visible 尚未恢复的情况下才回退到启动时创建的 sidebar provider。
	const postStateListener = async () => {
		try {
			const targetProvider = ClineProvider.getVisibleInstance() ?? provider
			await targetProvider.postStateToWebviewWithoutClineMessages()
		} catch (error) {
			cloudLogger(
				`[authStateChangedHandler] Failed to post state: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	authStateChangedHandler = async (data: { state: AuthState; previousState: AuthState }) => {
		cloudLogger(
			`[Diag#authStateChanged] state=${data.state}, previous=${data.previousState}, currentProvider=${provider.contextProxy.getGlobalState("apiProvider")}, currentModel=${provider.contextProxy.getGlobalState("apiModelId")}, currentProfile=${provider.contextProxy.getGlobalState("currentApiConfigName")}`,
		)

		// 关键：OAuth 登录把 key 存到 tocodex-api-key secret，但 ContextProxy 的 rooApiKey
		// 缓存不会自动同步。checkExistKey 依赖 rooApiKey 判断配置是否完整，
		// 如果此处不同步，前端会收到 rooApiKey 为空的 state → showWelcome = true → 抖动。
		if (data.state === "active-session") {
			const sessionToken = CloudService.hasInstance()
				? CloudService.instance.authService?.getSessionToken()
				: undefined
			if (sessionToken && !provider.contextProxy.getSecret("rooApiKey")) {
				await provider.contextProxy.storeSecret("rooApiKey", sessionToken)
				cloudLogger(`[authStateChangedHandler] Synced session token to rooApiKey in ContextProxy`)
			}
		} else if (data.state === "logged-out") {
			// 登出时清除 rooApiKey
			if (provider.contextProxy.getSecret("rooApiKey")) {
				await provider.contextProxy.storeSecret("rooApiKey", undefined)
				cloudLogger(`[authStateChangedHandler] Cleared rooApiKey from ContextProxy on logout`)
			}
		}

		await postStateListener()

		// Handle Roo models cache based on auth state (ROO-202)
		const handleRooModelsCache = async () => {
			try {
				if (data.state === "active-session") {
					// Refresh with auth token to get authenticated models
					const sessionToken = CloudService.hasInstance()
						? CloudService.instance.authService?.getSessionToken()
						: undefined
					const models = await refreshModels({
						provider: "roo",
						baseUrl: DEFAULT_TOCODEX_API_URL,
						apiKey: sessionToken,
					})

					// 新用户首次未选择模型时默认使用 gpt-5.4，如不存在则用第 1 个模型
					if (models && Object.keys(models).length > 0) {
						const currentModelId = provider.contextProxy.getGlobalState("apiModelId")
						const currentRooApiKey = provider.contextProxy.getSecret("rooApiKey")
						if (!currentModelId) {
							const preferredModelId = "gpt-5.4"
							const firstModelId = preferredModelId in models ? preferredModelId : Object.keys(models)[0]
							cloudLogger(`[authStateChangedHandler] Auto-selecting first model: ${firstModelId}`)
							const currentConfigName =
								provider.contextProxy.getGlobalState("currentApiConfigName") || "default"
							await provider.upsertProviderProfile(currentConfigName, {
								apiProvider: "roo",
								...(currentRooApiKey ? { rooApiKey: currentRooApiKey } : {}),
								apiModelId: firstModelId,
							})
						}
					}
				} else {
					// Flush without refresh on logout
					await flushModels({ provider: "roo" }, false)
				}
			} catch (error) {
				cloudLogger(
					`[authStateChangedHandler] Failed to handle Roo models cache: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		if (data.state === "active-session" || data.state === "logged-out") {
			await handleRooModelsCache()
			cloudLogger(
				`[Diag#authStateChanged] afterModelCache state=${data.state}, provider=${provider.contextProxy.getGlobalState("apiProvider")}, model=${provider.contextProxy.getGlobalState("apiModelId")}`,
			)

			// OAuth 登录成功：无条件重置供应商为官方 roo，清除第三方配置
			if (data.state === "active-session") {
				try {
					const currentConfigName = provider.contextProxy.getGlobalState("currentApiConfigName") || "default"

					// Apply stored provider model to API configuration if present
					const storedModel = context.globalState.get<string>("roo-provider-model")
					if (storedModel) {
						cloudLogger(`[authStateChangedHandler] Applying stored provider model: ${storedModel}`)
						await provider.upsertProviderProfile(currentConfigName, {
							apiProvider: "roo",
							apiModelId: storedModel,
						})
						// Clear the stored model after applying
						await context.globalState.update("roo-provider-model", undefined)
						cloudLogger(`[authStateChangedHandler] Applied and cleared stored provider model`)
					} else {
						// 无论是否有已存的模型，OAuth 登录时都重置供应商为 roo（清除第三方配置）
						// 但保留手动绑定的 rooApiKey，避免 auth-state-changed 与 rooCloudManualApiKey
						// 竞态时把刚写入的 key 从 ContextProxy/当前任务 handler 中清掉。
						const currentRooApiKey = provider.contextProxy.getSecret("rooApiKey")
						cloudLogger(`[authStateChangedHandler] Resetting provider to roo on OAuth login`)
						await provider.upsertProviderProfile(currentConfigName, {
							apiProvider: "roo",
							...(currentRooApiKey ? { rooApiKey: currentRooApiKey } : {}),
						})
					}
				} catch (error) {
					cloudLogger(
						`[authStateChangedHandler] Failed to reset provider on OAuth login: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}

			// 登录/登出相关的模型和供应商配置处理完成后，再投递一次最终状态。
			// 否则 webview 可能只收到登录瞬间的中间态，CloudView 仍停留在转圈状态。
			await postStateListener()
		}
	}

	settingsUpdatedHandler = async () => {
		postStateListener()
	}

	userInfoHandler = async ({ userInfo }: { userInfo: CloudUserInfo }) => {
		postStateListener()
	}

	cloudService = await CloudService.createInstance(context, cloudLogger, {
		"auth-state-changed": authStateChangedHandler,
		"settings-updated": settingsUpdatedHandler,
		"user-info": userInfoHandler,
	}).catch((error) => {
		outputChannel.appendLine(
			`[CloudService] Failed to create CloudService: ${error instanceof Error ? error.message : String(error)}`,
		)
		return null as unknown as CloudService
	})

	try {
		if (cloudService?.telemetryClient) {
			TelemetryService.instance.register(cloudService.telemetryClient)
		}
	} catch (error) {
		outputChannel.appendLine(
			`[CloudService] Failed to register TelemetryClient: ${error instanceof Error ? error.message : String(error)}`,
		)
	}

	// Add to subscriptions for proper cleanup on deactivate.
	if (cloudService) {
		context.subscriptions.push(cloudService)
	}

	// Trigger initial cloud profile sync now that CloudService is ready.
	try {
		await provider.initializeCloudProfileSyncWhenReady()
	} catch (error) {
		outputChannel.appendLine(
			`[CloudService] Failed to initialize cloud profile sync: ${error instanceof Error ? error.message : String(error)}`,
		)
	}

	// Finish initializing the provider.
	TelemetryService.instance.setProvider(provider)

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ClineProvider.sideBarId, provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	// Check for worktree auto-open path (set when switching to a worktree)
	try {
		await checkWorktreeAutoOpen(context, outputChannel)
	} catch (error) {
		outputChannel.appendLine(
			`[Worktree] Error during worktree auto-open: ${error instanceof Error ? error.message : String(error)}`,
		)
	}

	// Auto-import configuration if specified in settings.
	try {
		await autoImportSettings(outputChannel, {
			providerSettingsManager: provider.providerSettingsManager,
			contextProxy: provider.contextProxy,
			customModesManager: provider.customModesManager,
		})
	} catch (error) {
		outputChannel.appendLine(
			`[AutoImport] Error during auto-import: ${error instanceof Error ? error.message : String(error)}`,
		)
	}

	registerCommands({ context, outputChannel, provider })

	/**
	 * We use the text document content provider API to show the left side for diff
	 * view by creating a virtual document for the original content. This makes it
	 * readonly so users know to edit the right side if they want to keep their changes.
	 *
	 * This API allows you to create readonly documents in VSCode from arbitrary
	 * sources, and works by claiming an uri-scheme for which your provider then
	 * returns text contents. The scheme must be provided when registering a
	 * provider and cannot change afterwards.
	 *
	 * Note how the provider doesn't create uris for virtual documents - its role
	 * is to provide contents given such an uri. In return, content providers are
	 * wired into the open document logic so that providers are always considered.
	 *
	 * https://code.visualstudio.com/api/extension-guides/virtual-documents
	 */
	const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return Buffer.from(uri.query, "base64").toString("utf-8")
		}
	})()

	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider),
	)

	context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

	// Register code actions provider.
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider({ pattern: "**/*" }, new CodeActionProvider(), {
			providedCodeActionKinds: CodeActionProvider.providedCodeActionKinds,
		}),
	)

	registerCodeActions(context)
	registerTerminalActions(context)

	// Allows other extensions to activate once Roo is ready.
	vscode.commands.executeCommand(`${Package.name}.activationCompleted`)

	// Implements the `RooCodeAPI` interface.
	const socketPath = process.env.ROO_CODE_IPC_SOCKET_PATH
	const enableLogging = typeof socketPath === "string"

	// Watch the core files and automatically reload the extension host.
	if (process.env.NODE_ENV === "development") {
		const watchPaths = [
			{ path: context.extensionPath, pattern: "**/*.ts" },
			{ path: path.join(context.extensionPath, "../packages/types"), pattern: "**/*.ts" },
			{ path: path.join(context.extensionPath, "../packages/telemetry"), pattern: "**/*.ts" },
			{ path: path.join(context.extensionPath, "node_modules/@roo-code/cloud"), pattern: "**/*" },
		]

		console.log(
			`♻️♻️♻️ Core auto-reloading: Watching for changes in ${watchPaths.map(({ path }) => path).join(", ")}`,
		)

		// Create a debounced reload function to prevent excessive reloads
		let reloadTimeout: NodeJS.Timeout | undefined
		const DEBOUNCE_DELAY = 1_000

		const debouncedReload = (uri: vscode.Uri) => {
			if (reloadTimeout) {
				clearTimeout(reloadTimeout)
			}

			console.log(`♻️ ${uri.fsPath} changed; scheduling reload...`)

			reloadTimeout = setTimeout(() => {
				console.log(`♻️ Reloading host after debounce delay...`)
				vscode.commands.executeCommand("workbench.action.reloadWindow")
			}, DEBOUNCE_DELAY)
		}

		watchPaths.forEach(({ path: watchPath, pattern }) => {
			const relPattern = new vscode.RelativePattern(vscode.Uri.file(watchPath), pattern)
			const watcher = vscode.workspace.createFileSystemWatcher(relPattern, false, false, false)

			// Listen to all change types to ensure symlinked file updates trigger reloads.
			watcher.onDidChange(debouncedReload)
			watcher.onDidCreate(debouncedReload)
			watcher.onDidDelete(debouncedReload)

			context.subscriptions.push(watcher)
		})

		// Clean up the timeout on deactivation
		context.subscriptions.push({
			dispose: () => {
				if (reloadTimeout) {
					clearTimeout(reloadTimeout)
				}
			},
		})
	}

	// Initialize background model cache refresh
	// 扩展激活后延迟1秒刷新 roo 模型缓存，并在成功后通知 UI 更新
	setTimeout(() => {
		refreshModels({
			provider: "roo",
			baseUrl: DEFAULT_TOCODEX_API_URL,
		})
			.then((models) => {
				const modelCount = Object.keys(models).length
				if (modelCount > 0) {
					// 刷新成功后推送新模型列表给 webview UI
					ClineProvider.getVisibleInstance()?.postMessageToWebview({
						type: "routerModels",
						routerModels: { roo: models } as any,
						values: { provider: "roo" },
					})
				}
			})
			.catch(() => {
				// Silent fail - fallback models already shown to user
			})
	}, 1000)

	return new API(outputChannel, provider, socketPath, enableLogging)
}

// This method is called when your extension is deactivated.
export async function deactivate() {
	outputChannel.appendLine(`${Package.name} extension deactivated`)

	if (cloudService && CloudService.hasInstance()) {
		try {
			if (authStateChangedHandler) {
				CloudService.instance.off("auth-state-changed", authStateChangedHandler)
			}

			if (settingsUpdatedHandler) {
				CloudService.instance.off("settings-updated", settingsUpdatedHandler)
			}

			if (userInfoHandler) {
				CloudService.instance.off("user-info", userInfoHandler as any)
			}

			outputChannel.appendLine("CloudService event handlers cleaned up")
		} catch (error) {
			outputChannel.appendLine(
				`Failed to clean up CloudService event handlers: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	await McpServerManager.cleanup(extensionContext)
	TelemetryService.instance.shutdown()
	TerminalRegistry.cleanup()
}

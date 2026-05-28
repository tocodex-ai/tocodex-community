import os from "os"
import * as path from "path"
import fs from "fs/promises"
import EventEmitter from "events"

import { Anthropic } from "@anthropic-ai/sdk"
import delay from "delay"
import axios from "axios"
import pWaitFor from "p-wait-for"
import * as vscode from "vscode"

import {
	type TaskProviderLike,
	type TaskProviderEvents,
	type GlobalState,
	type ProviderName,
	type ProviderSettings,
	type RooCodeSettings,
	type ProviderSettingsEntry,
	type StaticAppProperties,
	type DynamicAppProperties,
	type CloudAppProperties,
	type TaskProperties,
	type GitProperties,
	type TelemetryProperties,
	type TelemetryPropertiesProvider,
	type CodeActionId,
	type CodeActionName,
	type TerminalActionId,
	type TerminalActionPromptType,
	type HistoryItem,
	type CloudUserInfo,
	type CloudOrganizationMembership,
	type CreateTaskOptions,
	type TokenUsage,
	type ToolUsage,
	type ExtensionMessage,
	type ExtensionState,
	type MarketplaceInstalledMetadata,
	RooCodeEventName,
	requestyDefaultModelId,
	openRouterDefaultModelId,
	DEFAULT_WRITE_DELAY_MS,
	ORGANIZATION_ALLOW_ALL,
	DEFAULT_MODES,
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	getModelId,
	isRetiredProvider,
	parseImageGenerationModels,
	DEFAULT_IMAGE_GENERATION_MODELS,
} from "@roo-code/types"
import { aggregateTaskCostsRecursive, type AggregatedCosts } from "./aggregateTaskCosts"
import { TelemetryService } from "@roo-code/telemetry"
import { CloudService, getRooCodeApiUrl } from "@roo-code/cloud"

import { Package } from "../../shared/package"
import bundledImageModels from "../../config/image-models.json"
import { findLast } from "../../shared/array"
import { supportPrompt } from "../../shared/support-prompt"
import { GlobalFileNames } from "../../shared/globalFileNames"
import { Mode, defaultModeSlug, getModeBySlug } from "../../shared/modes"
import { experimentDefault } from "../../shared/experiments"
import { formatLanguage } from "../../shared/language"
import { WebviewMessage } from "../../shared/WebviewMessage"
import { EMBEDDING_MODEL_PROFILES } from "../../shared/embeddingModels"
import { ProfileValidator } from "../../shared/ProfileValidator"

import { Terminal } from "../../integrations/terminal/Terminal"
import { downloadTask, getTaskFileName } from "../../integrations/misc/export-markdown"
import { resolveDefaultSaveUri, saveLastExportPath } from "../../utils/export"
import { getTheme } from "../../integrations/theme/getTheme"
import WorkspaceTracker from "../../integrations/workspace/WorkspaceTracker"

import { McpHub } from "../../services/mcp/McpHub"
import { McpServerManager } from "../../services/mcp/McpServerManager"
import { MarketplaceManager } from "../../services/marketplace"
import { ShadowCheckpointService } from "../../services/checkpoints/ShadowCheckpointService"
import { CodeIndexManager } from "../../services/code-index/manager"
import type { IndexProgressUpdate } from "../../services/code-index/interfaces/manager"
import { MdmService } from "../../services/mdm/MdmService"
import { SkillsManager } from "../../services/skills/SkillsManager"

import { fileExistsAtPath } from "../../utils/fs"
import { setTtsEnabled, setTtsSpeed } from "../../utils/tts"
import { getWorkspaceGitInfo } from "../../utils/git"
import { getWorkspacePath } from "../../utils/path"
import { OrganizationAllowListViolationError } from "../../utils/errors"

import { setPanel } from "../../activate/registerCommands"

import { t } from "../../i18n"

import { buildApiHandler } from "../../api"
import { forceFullModelDetailsLoad, hasLoadedFullDetails } from "../../api/providers/fetchers/lmstudio"

import { ContextProxy } from "../config/ContextProxy"
import { ProviderSettingsManager } from "../config/ProviderSettingsManager"
import { CustomModesManager } from "../config/CustomModesManager"
import { Task } from "../task/Task"
import { MemoryManager } from "../../services/memory/MemoryManager"

import { webviewMessageHandler } from "./webviewMessageHandler"
import type { ClineMessage, TodoItem } from "@roo-code/types"
import { readApiMessages, saveApiMessages, saveTaskMessages, TaskHistoryStore } from "../task-persistence"
import { readTaskMessages } from "../task-persistence/taskMessages"
import { getNonce } from "./getNonce"
import { getUri } from "./getUri"
import { REQUESTY_BASE_URL } from "../../shared/utils/requesty"
import { validateAndFixToolResultIds } from "../task/validateToolResultIds"

/**
 * https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts
 * https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
 */

export type ClineProviderEvents = {
	clineCreated: [cline: Task]
}

/**
 * 解析 LLM 输出的 [PROJECT]/[GLOBAL] 双段记忆。
 * 容错：缺失段、顺序颠倒、未带方括号头都尽量提取。
 */
function splitProjectAndGlobalSections(raw: string): { project: string; global: string } {
	if (!raw) return { project: "", global: "" }
	const text = raw.replace(/\r\n/g, "\n").trim()

	const projectMatch = text.match(/\[PROJECT\]\s*([\s\S]*?)(?=\[GLOBAL\]|$)/i)
	const globalMatch = text.match(/\[GLOBAL\]\s*([\s\S]*?)$/i)

	const clean = (s: string | undefined): string => {
		if (!s) return ""
		const t = s.trim()
		if (!t || /^\(none\)$/i.test(t)) return ""
		return t
	}

	let project = clean(projectMatch?.[1])
	let global = clean(globalMatch?.[1])

	// 兜底：没有任何标头时全部归项目级
	if (!projectMatch && !globalMatch) {
		project = text
	}

	return { project, global }
}

interface PendingEditOperation {
	messageTs: number
	editedContent: string
	images?: string[]
	messageIndex: number
	apiConversationHistoryIndex: number
	timeoutId: NodeJS.Timeout
	createdAt: number
}

export class ClineProvider
	extends EventEmitter<TaskProviderEvents>
	implements vscode.WebviewViewProvider, TelemetryPropertiesProvider, TaskProviderLike
{
	// Used in package.json as the view's id. This value cannot be changed due
	// to how VSCode caches views based on their id, and updating the id would
	// break existing instances of the extension.
	public static readonly sideBarId = `${Package.name}.SidebarProvider`
	public static readonly tabPanelId = `${Package.name}.TabPanelProvider`
	private static activeInstances: Set<ClineProvider> = new Set()
	private disposables: vscode.Disposable[] = []
	private webviewDisposables: vscode.Disposable[] = []
	private view?: vscode.WebviewView | vscode.WebviewPanel
	private clineStack: Task[] = []
	// 并行子任务实例池：父 Task 派发的子任务在此运行，不入 clineStack
	private parallelTasks: Map<string, Task> = new Map()
	private codeIndexStatusSubscription?: vscode.Disposable
	private codeIndexManager?: CodeIndexManager
	private _workspaceTracker?: WorkspaceTracker // workSpaceTracker read-only for access outside this class
	protected mcpHub?: McpHub // Change from private to protected
	protected skillsManager?: SkillsManager
	private marketplaceManager: MarketplaceManager
	private mdmService?: MdmService
	private taskCreationCallback: (task: Task) => void
	private taskEventListeners: WeakMap<Task, Array<() => void>> = new WeakMap()
	private currentWorkspacePath: string | undefined
	private _disposed = false

	private recentTasksCache?: string[]
	public readonly taskHistoryStore: TaskHistoryStore
	private taskHistoryStoreInitialized = false
	private globalStateWriteThroughTimer: ReturnType<typeof setTimeout> | null = null
	private static readonly GLOBAL_STATE_WRITE_THROUGH_DEBOUNCE_MS = 5000 // 5 seconds
	private pendingOperations: Map<string, PendingEditOperation> = new Map()
	private static readonly PENDING_OPERATION_TIMEOUT_MS = 30000 // 30 seconds

	// ─── Scheduled Tasks Subsystem ────────────────────────────────────────
	private scheduledTaskStore?: import("../../services/scheduled-tasks").ScheduledTaskStore
	private scheduledTaskScheduler?: import("../../services/scheduled-tasks").ScheduledTaskScheduler
	private scheduledTaskExecutor?: import("../../services/scheduled-tasks").ScheduledTaskExecutor

	private cloudOrganizationsCache: CloudOrganizationMembership[] | null = null
	private cloudOrganizationsCacheTimestamp: number | null = null
	private static readonly CLOUD_ORGANIZATIONS_CACHE_DURATION_MS = 5 * 1000 // 5 seconds

	/**
	 * Monotonically increasing sequence number for clineMessages state pushes.
	 * Used by the frontend to reject stale state that arrives out-of-order.
	 */
	private clineMessagesSeq = 0

	public isViewLaunched = false
	public settingsImportedAt?: number
	public readonly latestAnnouncementId = "mar-2026-v3.51.0-gpt-54-slash-skills" // v3.51.0 OpenAI GPT-5.4 support and slash command skills
	public readonly providerSettingsManager: ProviderSettingsManager
	public readonly customModesManager: CustomModesManager

	constructor(
		readonly context: vscode.ExtensionContext,
		private readonly outputChannel: vscode.OutputChannel,
		private readonly renderContext: "sidebar" | "editor" = "sidebar",
		public readonly contextProxy: ContextProxy,
		mdmService?: MdmService,
	) {
		super()
		this.currentWorkspacePath = getWorkspacePath()

		ClineProvider.activeInstances.add(this)

		this.mdmService = mdmService
		this.updateGlobalState("codebaseIndexModels", EMBEDDING_MODEL_PROFILES)

		// Initialize the per-task file-based history store.
		// The globalState write-through is debounced separately (not on every mutation)
		// since per-task files are authoritative and globalState is only for downgrade compat.
		this.taskHistoryStore = new TaskHistoryStore(this.contextProxy.globalStorageUri.fsPath, {
			onWrite: async () => {
				this.scheduleGlobalStateWriteThrough()
			},
		})
		this.initializeTaskHistoryStore().catch((error) => {
			this.log(`Failed to initialize TaskHistoryStore: ${error}`)
		})

		// Start configuration loading (which might trigger indexing) in the background.
		// Don't await, allowing activation to continue immediately.

		// Register this provider with the telemetry service to enable it to add
		// properties like mode and provider.
		TelemetryService.instance.setProvider(this)

		this._workspaceTracker = new WorkspaceTracker(this)

		this.providerSettingsManager = new ProviderSettingsManager(this.context)

		this.customModesManager = new CustomModesManager(this.context, async () => {
			await this.postStateToWebviewWithoutClineMessages()
		})

		// Initialize MCP Hub through the singleton manager.
		// apps/desktop 的 Electron 壳暂不提供完整 VSCode/MCP 运行环境；后台初始化 MCP 会阻塞首条 API 请求。
		if (process.env.TOCODEX_DESKTOP_SHELL !== "1") {
			McpServerManager.getInstance(this.context, this)
				.then((hub) => {
					this.mcpHub = hub
					this.mcpHub.registerClient()
				})
				.catch((error) => {
					this.log(`Failed to initialize MCP Hub: ${error}`)
				})
		}

		// Initialize Skills Manager for skill discovery
		this.skillsManager = new SkillsManager(this)
		this.skillsManager.initialize().catch((error) => {
			this.log(`Failed to initialize Skills Manager: ${error}`)
		})

		this.marketplaceManager = new MarketplaceManager(this.context, this.customModesManager)

		// Forward <most> task events to the provider.
		// We do something fairly similar for the IPC-based API.
		this.taskCreationCallback = (instance: Task) => {
			this.emit(RooCodeEventName.TaskCreated, instance)

			// Create named listener functions so we can remove them later.
			const onTaskStarted = () => this.emit(RooCodeEventName.TaskStarted, instance.taskId)
			const onTaskCompleted = (taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage) => {
				this.emit(RooCodeEventName.TaskCompleted, taskId, tokenUsage, toolUsage)

				// 异步触发记忆提取（fire-and-forget），不阻塞主任务
				// Requirements: 2.1, 2.6
				this.triggerMemoryExtraction(instance).catch((error) => {
					console.error(
						`[ClineProvider] 记忆提取失败: ${error instanceof Error ? error.message : String(error)}`,
					)
				})

				// 任务完成时执行 Stop hooks（fire-and-forget）
				// Requirements: 15.3
				instance.hooksRunner.runStop(taskId).catch((error) => {
					console.error(
						`[ClineProvider] Stop hooks 执行失败: ${error instanceof Error ? error.message : String(error)}`,
					)
				})
			}
			const onTaskAborted = async () => {
				this.emit(RooCodeEventName.TaskAborted, instance.taskId)

				// 任务中止时执行 Stop hooks（fire-and-forget）
				// Requirements: 15.3
				instance.hooksRunner.runStop(instance.taskId).catch((error) => {
					console.error(
						`[ClineProvider] Stop hooks 执行失败（abort）: ${error instanceof Error ? error.message : String(error)}`,
					)
				})

				try {
					// Only rehydrate on genuine streaming failures.
					// User-initiated cancels are handled by cancelTask().
					if (instance.abortReason === "streaming_failed") {
						// Defensive safeguard: if another path already replaced this instance, skip
						const current = this.getCurrentTask()
						if (current && current.instanceId !== instance.instanceId) {
							this.log(
								`[onTaskAborted] Skipping rehydrate: current instance ${current.instanceId} != aborted ${instance.instanceId}`,
							)
							return
						}

						const { historyItem } = await this.getTaskWithId(instance.taskId)
						const rootTask = instance.rootTask
						const parentTask = instance.parentTask
						await this.createTaskWithHistoryItem({ ...historyItem, rootTask, parentTask })
					}
				} catch (error) {
					this.log(
						`[onTaskAborted] Failed to rehydrate after streaming failure: ${
							error instanceof Error ? error.message : String(error)
						}`,
					)
				}
			}
			const onTaskFocused = () => this.emit(RooCodeEventName.TaskFocused, instance.taskId)
			const onTaskUnfocused = () => this.emit(RooCodeEventName.TaskUnfocused, instance.taskId)
			const onTaskActive = (taskId: string) => this.emit(RooCodeEventName.TaskActive, taskId)
			const onTaskInteractive = (taskId: string) => this.emit(RooCodeEventName.TaskInteractive, taskId)
			const onTaskResumable = (taskId: string) => this.emit(RooCodeEventName.TaskResumable, taskId)
			const onTaskIdle = (taskId: string) => this.emit(RooCodeEventName.TaskIdle, taskId)
			const onTaskPaused = (taskId: string) => this.emit(RooCodeEventName.TaskPaused, taskId)
			const onTaskUnpaused = (taskId: string) => this.emit(RooCodeEventName.TaskUnpaused, taskId)
			const onTaskSpawned = (taskId: string) => this.emit(RooCodeEventName.TaskSpawned, taskId)
			const onTaskUserMessage = (taskId: string) => this.emit(RooCodeEventName.TaskUserMessage, taskId)
			const onTaskTokenUsageUpdated = (taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage) =>
				this.emit(RooCodeEventName.TaskTokenUsageUpdated, taskId, tokenUsage, toolUsage)

			// Attach the listeners.
			instance.on(RooCodeEventName.TaskStarted, onTaskStarted)
			instance.on(RooCodeEventName.TaskCompleted, onTaskCompleted)
			instance.on(RooCodeEventName.TaskAborted, onTaskAborted)
			instance.on(RooCodeEventName.TaskFocused, onTaskFocused)
			instance.on(RooCodeEventName.TaskUnfocused, onTaskUnfocused)
			instance.on(RooCodeEventName.TaskActive, onTaskActive)
			instance.on(RooCodeEventName.TaskInteractive, onTaskInteractive)
			instance.on(RooCodeEventName.TaskResumable, onTaskResumable)
			instance.on(RooCodeEventName.TaskIdle, onTaskIdle)
			instance.on(RooCodeEventName.TaskPaused, onTaskPaused)
			instance.on(RooCodeEventName.TaskUnpaused, onTaskUnpaused)
			instance.on(RooCodeEventName.TaskSpawned, onTaskSpawned)
			instance.on(RooCodeEventName.TaskUserMessage, onTaskUserMessage)
			instance.on(RooCodeEventName.TaskTokenUsageUpdated, onTaskTokenUsageUpdated)

			// Store the cleanup functions for later removal.
			this.taskEventListeners.set(instance, [
				() => instance.off(RooCodeEventName.TaskStarted, onTaskStarted),
				() => instance.off(RooCodeEventName.TaskCompleted, onTaskCompleted),
				() => instance.off(RooCodeEventName.TaskAborted, onTaskAborted),
				() => instance.off(RooCodeEventName.TaskFocused, onTaskFocused),
				() => instance.off(RooCodeEventName.TaskUnfocused, onTaskUnfocused),
				() => instance.off(RooCodeEventName.TaskActive, onTaskActive),
				() => instance.off(RooCodeEventName.TaskInteractive, onTaskInteractive),
				() => instance.off(RooCodeEventName.TaskResumable, onTaskResumable),
				() => instance.off(RooCodeEventName.TaskIdle, onTaskIdle),
				() => instance.off(RooCodeEventName.TaskUserMessage, onTaskUserMessage),
				() => instance.off(RooCodeEventName.TaskPaused, onTaskPaused),
				() => instance.off(RooCodeEventName.TaskUnpaused, onTaskUnpaused),
				() => instance.off(RooCodeEventName.TaskSpawned, onTaskSpawned),
				() => instance.off(RooCodeEventName.TaskTokenUsageUpdated, onTaskTokenUsageUpdated),
			])
		}

		// Initialize ToCodex profile sync.
		if (CloudService.hasInstance()) {
			this.initializeCloudProfileSync().catch((error) => {
				this.log(`Failed to initialize cloud profile sync: ${error}`)
			})
		} else {
			this.log("CloudService not ready, deferring cloud profile sync")
		}
	}

	/**
	 * Initialize the TaskHistoryStore and migrate from globalState if needed.
	 */
	private async initializeTaskHistoryStore(): Promise<void> {
		try {
			await this.taskHistoryStore.initialize()

			// Migration: backfill per-task files from globalState on first run
			const migrationKey = "taskHistoryMigratedToFiles"
			const alreadyMigrated = this.context.globalState.get<boolean>(migrationKey)

			if (!alreadyMigrated) {
				const legacyHistory = this.context.globalState.get<HistoryItem[]>("taskHistory") ?? []

				if (legacyHistory.length > 0) {
					this.log(`[initializeTaskHistoryStore] Migrating ${legacyHistory.length} entries from globalState`)
					await this.taskHistoryStore.migrateFromGlobalState(legacyHistory)
				}

				await this.context.globalState.update(migrationKey, true)
				this.log("[initializeTaskHistoryStore] Migration complete")
			}

			this.taskHistoryStoreInitialized = true
		} catch (error) {
			this.log(`[initializeTaskHistoryStore] Error: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * Override EventEmitter's on method to match TaskProviderLike interface
	 */
	override on<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this {
		return super.on(event, listener as any)
	}

	/**
	 * Override EventEmitter's off method to match TaskProviderLike interface
	 */
	override off<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this {
		return super.off(event, listener as any)
	}

	/**
	 * Initialize cloud profile synchronization
	 */
	private async initializeCloudProfileSync() {
		try {
			// Check if authenticated and sync profiles
			if (CloudService.hasInstance() && CloudService.instance.isAuthenticated()) {
				await this.syncCloudProfiles()
			}

			// Set up listener for future updates
			if (CloudService.hasInstance()) {
				CloudService.instance.on("settings-updated", this.handleCloudSettingsUpdate)
			}
		} catch (error) {
			this.log(`Error in initializeCloudProfileSync: ${error}`)
		}
	}

	/**
	 * Handle cloud settings updates
	 */
	private handleCloudSettingsUpdate = async () => {
		try {
			await this.syncCloudProfiles()
		} catch (error) {
			this.log(`Error handling cloud settings update: ${error}`)
		}
	}

	/**
	 * Synchronize cloud profiles with local profiles.
	 */
	private async syncCloudProfiles() {
		try {
			const settings = CloudService.instance.getOrganizationSettings()

			if (!settings?.providerProfiles) {
				return
			}

			const currentApiConfigName = this.getGlobalState("currentApiConfigName")

			const result = await this.providerSettingsManager.syncCloudProfiles(
				settings.providerProfiles,
				currentApiConfigName,
			)

			if (result.hasChanges) {
				// Update list.
				await this.updateGlobalState("listApiConfigMeta", await this.providerSettingsManager.listConfig())

				if (result.activeProfileChanged && result.activeProfileId) {
					// Reload full settings for new active profile.
					const profile = await this.providerSettingsManager.getProfile({
						id: result.activeProfileId,
					})
					await this.activateProviderProfile({ name: profile.name })
				}

				await this.postStateToWebviewWithoutClineMessages()
			}
		} catch (error) {
			this.log(`Error syncing cloud profiles: ${error}`)
		}
	}

	/**
	 * Initialize cloud profile synchronization when CloudService is ready
	 * This method is called externally after CloudService has been initialized
	 */
	public async initializeCloudProfileSyncWhenReady(): Promise<void> {
		try {
			if (CloudService.hasInstance() && CloudService.instance.isAuthenticated()) {
				await this.syncCloudProfiles()
			}

			if (CloudService.hasInstance()) {
				CloudService.instance.off("settings-updated", this.handleCloudSettingsUpdate)
				CloudService.instance.on("settings-updated", this.handleCloudSettingsUpdate)
			}
		} catch (error) {
			this.log(`Failed to initialize cloud profile sync when ready: ${error}`)
		}
	}

	// Adds a new Task instance to clineStack, marking the start of a new task.
	// The instance is pushed to the top of the stack (LIFO order).
	// When the task is completed, the top instance is removed, reactivating the
	// previous task.
	async addClineToStack(task: Task) {
		// Add this cline instance into the stack that represents the order of
		// all the called tasks.
		this.clineStack.push(task)
		task.emit(RooCodeEventName.TaskFocused)

		// Perform special setup provider specific tasks.
		await this.performPreparationTasks(task)

		// Ensure getState() resolves correctly.
		const state = await this.getState()

		if (!state || typeof state.mode !== "string") {
			throw new Error(t("common:errors.retrieve_current_mode"))
		}
	}

	async performPreparationTasks(cline: Task) {
		// LMStudio: We need to force model loading in order to read its context
		// size; we do it now since we're starting a task with that model selected.
		if (cline.apiConfiguration && cline.apiConfiguration.apiProvider === "lmstudio") {
			try {
				if (!hasLoadedFullDetails(cline.apiConfiguration.lmStudioModelId!)) {
					await forceFullModelDetailsLoad(
						cline.apiConfiguration.lmStudioBaseUrl ?? "http://localhost:1234",
						cline.apiConfiguration.lmStudioModelId!,
					)
				}
			} catch (error) {
				this.log(`Failed to load full model details for LM Studio: ${error}`)
				vscode.window.showErrorMessage(error.message)
			}
		}
	}

	// Removes and destroys the top Cline instance (the current finished task),
	// activating the previous one (resuming the parent task).
	async removeClineFromStack(options?: { skipDelegationRepair?: boolean }) {
		if (this.clineStack.length === 0) {
			return
		}

		// Pop the top Cline instance from the stack.
		let task = this.clineStack.pop()

		if (task) {
			// Capture delegation metadata before abort/dispose, since abortTask(true)
			// is async and the task reference is cleared afterwards.
			const childTaskId = task.taskId
			const parentTaskId = task.parentTaskId

			task.emit(RooCodeEventName.TaskUnfocused)

			try {
				// Abort the running task and set isAbandoned to true so
				// all running promises will exit as well.
				await task.abortTask(true)
			} catch (e) {
				this.log(
					`[ClineProvider#removeClineFromStack] abortTask() failed ${task.taskId}.${task.instanceId}: ${e.message}`,
				)
			}

			// Remove event listeners before clearing the reference.
			const cleanupFunctions = this.taskEventListeners.get(task)

			if (cleanupFunctions) {
				cleanupFunctions.forEach((cleanup) => cleanup())
				this.taskEventListeners.delete(task)
			}

			// Make sure no reference kept, once promises end it will be
			// garbage collected.
			task = undefined

			// Delegation-aware parent metadata repair:
			// If the popped task was a delegated child, repair the parent's metadata
			// so it transitions from "delegated" back to "active" and becomes resumable
			// from the task history list.
			// Skip when called from delegateParentAndOpenChild() during nested delegation
			// transitions (A→B→C), where the caller intentionally replaces the active
			// child and will update the parent to point at the new child.
			if (parentTaskId && childTaskId && !options?.skipDelegationRepair) {
				try {
					const { historyItem: parentHistory } = await this.getTaskWithId(parentTaskId)

					if (parentHistory.status === "delegated" && parentHistory.awaitingChildId === childTaskId) {
						await this.updateTaskHistory({
							...parentHistory,
							status: "active",
							awaitingChildId: undefined,
						})
						this.log(
							`[ClineProvider#removeClineFromStack] Repaired parent ${parentTaskId} metadata: delegated → active (child ${childTaskId} removed)`,
						)
					}
				} catch (err) {
					// Non-fatal: log but do not block the pop operation.
					this.log(
						`[ClineProvider#removeClineFromStack] Failed to repair parent metadata for ${parentTaskId} (non-fatal): ${
							err instanceof Error ? err.message : String(err)
						}`,
					)
				}
			}
		}
	}

	getTaskStackSize(): number {
		return this.clineStack.length
	}

	public getCurrentTaskStack(): string[] {
		return this.clineStack.map((cline) => cline.taskId)
	}

	// ── 并行子任务管理 ──────────────────────────────────────────

	/**
	 * 创建一个并行子任务实例并启动执行。
	 * 子任务不入 clineStack，在 parallelTasks Map 中独立运行。
	 */
	public async spawnParallelChild(params: {
		parentTask: Task
		message: string
		mode: string
		description: string
		files?: string[]
	}): Promise<Task> {
		const { parentTask, message, mode, description, files } = params
		const { apiConfiguration, experiments } = await this.getState()

		// 创建独立的子 Task 实例（不入 clineStack）
		const child = new Task({
			provider: this,
			apiConfiguration,
			enableCheckpoints: false, // 子任务禁用检查点
			consecutiveMistakeLimit: apiConfiguration.consecutiveMistakeLimit,
			task: message,
			images: [],
			experiments,
			rootTask: parentTask.rootTask || parentTask,
			parentTask,
			taskNumber: this.clineStack.length + this.parallelTasks.size + 1,
			onCreated: this.taskCreationCallback,
			startTask: false,
		})

		// 手动设置子任务的 mode（Task 构造函数从 provider state 获取，但并行子任务需要独立 mode）
		;(child as any)._taskMode = mode
		;(child as any).taskModeReady = Promise.resolve()

		// 禁用检查点（子任务不需要独立检查点，由父任务统一管理）
		child.enableCheckpoints = false

		// 标识为并行子任务，避免 AttemptCompletionTool 走 delegation 流程
		child.isParallelChild = true
		// 记录创建时间，用于硬性超时兜底
		;(child as any)._spawnedAt = Date.now()

		// P1: 注册文件锁
		if (files && files.length > 0) {
			const { fileLockRegistry } = await import("../../services/file-lock/FileLockRegistry")
			fileLockRegistry.register(child.taskId, files)
		}

		// 注册到 parallelTasks Map
		this.parallelTasks.set(child.taskId, child)

		// 注册到父任务的并行子任务追踪
		parentTask.addParallelChild(child.taskId, description, files)

		// 通知 UI 更新并行子任务状态（显示"运行中"）
		this.postStateToWebviewWithoutClineMessages()

		// 防重复标记：确保 handleParallelChildDone 只被调用一次
		let childDoneHandled = false
		const markChildDone = (status: "completed" | "failed") => {
			if (childDoneHandled) return
			childDoneHandled = true
			this.log(`[spawnParallelChild] markChildDone: child ${child.taskId} → ${status}`)
			try {
				this.handleParallelChildDone(parentTask, child.taskId, status)
			} catch (err) {
				this.log(`[spawnParallelChild] handleParallelChildDone error for ${child.taskId}: ${err}`)
			}
			// 无论成功还是失败，都要切断子任务后续执行
			setTimeout(() => {
				if (!child.abort) {
					child.abortTask(true).catch(() => {})
				}
			}, 1000)
		}

		// 子任务 ask 拦截策略：
		// 所有自动批准已在前置条件中验证开启，checkAutoApproval 会处理大部分 ask。
		// 这里只处理两种边界情况：
		// 1. api_req_failed：允许 Task 内部重试机制工作（backoffAndAnnounce），但限制最多 3 次
		// 2. mistake_limit_reached：直接标记失败
		// 3. 子任务已结束时拒绝请求
		const MAX_CHILD_API_RETRIES = 3
		let apiRetryCount = 0

		const originalAsk = child.ask.bind(child)
		;(child as any).ask = async (type: any, text?: string, partial?: any, ...rest: any[]) => {
			// 子任务已结束，拒绝一切请求
			if (childDoneHandled) {
				throw new Error(`[parallelChild] task ${child.taskId} already done, rejecting ask: ${type}`)
			}

			// API 失败：让 Task 内部重试机制正常工作，但限制总重试次数
			if (type === "api_req_failed") {
				apiRetryCount++
				this.log(
					`[spawnParallelChild] child ${child.taskId} api_req_failed #${apiRetryCount}/${MAX_CHILD_API_RETRIES}`,
				)
				if (apiRetryCount > MAX_CHILD_API_RETRIES) {
					markChildDone("failed")
					throw new Error(
						`[parallelChild] task ${child.taskId} exceeded max API retries (${MAX_CHILD_API_RETRIES})`,
					)
				}
				// 允许 Task 内部的 backoffAndAnnounce + 递归重试正常执行
			}

			// API 请求成功时重置重试计数
			if (type === "api_req_started" || (type === "tool" && !partial)) {
				apiRetryCount = 0
			}

			// 连续错误达到上限
			if (type === "mistake_limit_reached") {
				this.log(`[spawnParallelChild] child ${child.taskId} mistake_limit_reached, marking failed`)
				markChildDone("failed")
				throw new Error(`[parallelChild] task ${child.taskId} mistake limit reached`)
			}

			// 直接调用原始 ask，依赖 checkAutoApproval 自动批准
			return originalAsk(type, text, partial, ...rest)
		}

		// 监听事件检测子任务完成
		child.on(RooCodeEventName.TaskCompleted, (_taskId: string) => {
			markChildDone("completed")
		})

		child.on(RooCodeEventName.TaskAborted, () => {
			markChildDone("failed")
		})

		// 兜底：监听 say 消息，检测完成和错误
		const originalSay = child.say.bind(child)
		;(child as any).say = async (type: any, ...args: any[]) => {
			const result = await originalSay(type, ...args)
			if (childDoneHandled) return result

			// completion_result say（非 partial）= 子任务已完成工作
			// 8 秒后如果正常流程没处理，强制标记完成（给文件保存等操作留足时间）
			const partial = args[2]
			if (type === "completion_result" && !partial) {
				this.log(`[spawnParallelChild] child ${child.taskId} say completion_result (non-partial)`)
				setTimeout(() => {
					if (!childDoneHandled) {
						this.log(`[spawnParallelChild] child ${child.taskId} forcing done via completion_result say`)
						markChildDone("completed")
					}
				}, 8000)
			}

			if (type === "error") {
				const errorText = args[0] as string | undefined
				// MODEL_NO_ASSISTANT_MESSAGES 和 MODEL_NO_TOOLS_USED 有内置重试机制，
				// 不要立即终止子任务，让重试逻辑正常工作
				const retryableErrors = ["MODEL_NO_ASSISTANT_MESSAGES", "MODEL_NO_TOOLS_USED"]
				if (errorText && retryableErrors.some((e) => errorText.includes(e))) {
					this.log(
						`[spawnParallelChild] child ${child.taskId} say retryable error: ${errorText}, allowing retry`,
					)
				} else {
					this.log(`[spawnParallelChild] child ${child.taskId} say error, marking failed`)
					markChildDone("failed")
				}
			}

			return result
		}

		// 心跳检测：每 3 秒检查确定性状态
		const MAX_NUDGE_COUNT = 3
		let nudgeCount = 0
		let lastNudgeTime = 0

		const heartbeat = setInterval(() => {
			if (childDoneHandled) {
				clearInterval(heartbeat)
				return
			}

			const msgs = child.clineMessages

			// 事实 1：子任务已被 abort
			if (child.abort) {
				this.log(`[heartbeat] child ${child.taskId} is aborted, marking failed`)
				clearInterval(heartbeat)
				markChildDone("failed")
				return
			}

			// 事实 2：子任务已不在 parallelTasks 中
			if (!this.parallelTasks.has(child.taskId)) {
				this.log(`[heartbeat] child ${child.taskId} removed from parallelTasks, marking failed`)
				clearInterval(heartbeat)
				markChildDone("failed")
				return
			}

			// 事实 3：消息中已有 completion_result
			const hasCompletion = msgs.some(
				(m) =>
					(m.type === "say" && m.say === "completion_result" && !m.partial) ||
					(m.type === "ask" && m.ask === "completion_result"),
			)
			if (hasCompletion) {
				this.log(`[heartbeat] child ${child.taskId} has completion_result, forcing done`)
				clearInterval(heartbeat)
				markChildDone("completed")
				return
			}

			// 事实 4：最后消息是 error
			if (msgs.length > 0) {
				const lastMsg = msgs[msgs.length - 1]
				if (lastMsg.type === "say" && lastMsg.say === "error" && !lastMsg.partial) {
					const retryableErrors = ["MODEL_NO_ASSISTANT_MESSAGES", "MODEL_NO_TOOLS_USED"]
					const isRetryable = lastMsg.text && retryableErrors.some((e) => lastMsg.text!.includes(e))
					if (!isRetryable) {
						this.log(`[heartbeat] child ${child.taskId} has error message, marking failed`)
						clearInterval(heartbeat)
						markChildDone("failed")
						return
					}
				}
			}

			// 事实 5：连续错误达到上限
			if (child.consecutiveMistakeLimit > 0 && child.consecutiveMistakeCount >= child.consecutiveMistakeLimit) {
				this.log(`[heartbeat] child ${child.taskId} consecutiveMistakeCount >= limit, marking failed`)
				clearInterval(heartbeat)
				markChildDone("failed")
				return
			}

			// 事实 6：子任务卡在 ask 上（idle/resumable/interactive），催促
			if (msgs.length > 0) {
				const lastMsg = msgs[msgs.length - 1]
				const elapsed = Date.now() - lastMsg.ts

				if (elapsed > 30000 && (child.idleAsk || child.resumableAsk || child.interactiveAsk)) {
					if (Date.now() - lastNudgeTime > 30000) {
						nudgeCount++
						lastNudgeTime = Date.now()
						this.log(
							`[heartbeat] child ${child.taskId} stuck on ask, nudge #${nudgeCount}/${MAX_NUDGE_COUNT}`,
						)

						if (nudgeCount >= MAX_NUDGE_COUNT) {
							this.log(`[heartbeat] child ${child.taskId} max nudges reached, forcing completed`)
							clearInterval(heartbeat)
							markChildDone("completed")
							return
						}

						// 强制响应当前 ask
						child.handleWebviewAskResponse(
							"messageResponse",
							"请立即调用 attempt_completion 工具来结束任务。",
						)
					}
				}
			}

			// 事实 7：硬性超时
			const childRunTime = Date.now() - (child as any)._spawnedAt

			// 7a: 绝对超时（无论是否有活动，超过 7 分钟直接结束）
			if (childRunTime > 420_000) {
				this.log(
					`[heartbeat] child ${child.taskId} absolute timeout (${Math.round(childRunTime / 1000)}s), forcing completed`,
				)
				clearInterval(heartbeat)
				markChildDone("completed")
				return
			}

			// 7b: 无活动超时（运行 > 3 分钟且 60 秒无新消息）
			if (childRunTime > 180_000 && msgs.length > 0) {
				const lastMsg = msgs[msgs.length - 1]
				if (Date.now() - lastMsg.ts > 60_000) {
					this.log(`[heartbeat] child ${child.taskId} idle timeout, forcing completed`)
					clearInterval(heartbeat)
					markChildDone("completed")
					return
				}
			}

			this.postStateToWebviewWithoutClineMessages()
		}, 3000)

		// 启动子任务（后台执行）
		child.start()

		this.log(`[spawnParallelChild] spawned child ${child.taskId} for parent ${parentTask.taskId}: ${description}`)

		return child
	}

	/**
	 * 并行子任务完成或失败时的回调处理。
	 */
	private handleParallelChildDone(parentTask: Task, childTaskId: string, status: "completed" | "failed") {
		// 防重复：如果子任务已经不在 parallelTasks 中，说明已经处理过
		const childTask = this.parallelTasks.get(childTaskId)
		if (
			!childTask &&
			!parentTask.getParallelChildrenSnapshot().find((c) => c.taskId === childTaskId && c.status === "running")
		) {
			this.log(`[handleParallelChildDone] child ${childTaskId} already handled, skipping`)
			return
		}

		// 更新父任务中的子任务状态
		const resultSummary = childTask ? this.extractChildResult(childTask) : `Child task ${childTaskId} ${status}`

		parentTask.updateParallelChildStatus(childTaskId, status, resultSummary)

		// P2: 子任务费用汇总到父任务
		if (childTask?.costTracker) {
			const childSummary = childTask.costTracker.getSummary()
			if (childSummary.totalCostUSD > 0) {
				;(parentTask.costTracker as any)?.addExternalCost(
					childSummary.totalCostUSD,
					`parallel-child:${childTaskId}`,
				)
			}
		}

		// P2: 保存子任务对话历史快照（用于后续查看）
		if (childTask) {
			const childSnapshot = {
				taskId: childTaskId,
				description:
					parentTask.getParallelChildrenSnapshot().find((c) => c.taskId === childTaskId)?.description || "",
				messages: childTask.clineMessages.slice(), // 浅拷贝
				costSummary: childTask.costTracker?.getSummary(),
			}
			if (!(parentTask as any).parallelChildrenHistory) {
				;(parentTask as any).parallelChildrenHistory = []
			}
			;(parentTask as any).parallelChildrenHistory.push(childSnapshot)
		}

		// P1: 释放文件锁
		import("../../services/file-lock/FileLockRegistry")
			.then(({ fileLockRegistry }) => {
				fileLockRegistry.release(childTaskId)
			})
			.catch(() => {})

		// 清理子任务实例
		if (childTask) {
			const cleanupFunctions = this.taskEventListeners.get(childTask)
			if (cleanupFunctions) {
				cleanupFunctions.forEach((cleanup) => cleanup())
				this.taskEventListeners.delete(childTask)
			}
		}
		this.parallelTasks.delete(childTaskId)

		// 每次子任务完成/失败时都更新消息中的快照，确保历史消息独立于实时状态
		// 这样即使后续重新派发并行任务，前一批的状态也不会被覆盖
		this.updateParallelTaskMessageSnapshot(parentTask)

		// 通知 UI 更新
		this.postStateToWebviewWithoutClineMessages()

		// 检查是否所有并行子任务都已完成
		const runningCount = parentTask.getRunningParallelChildrenCount()
		this.log(`[handleParallelChildDone] child ${childTaskId} → ${status}, remaining running: ${runningCount}`)
		if (runningCount === 0) {
			this.onAllParallelChildrenDone(parentTask).catch((err) => {
				this.log(`[handleParallelChildDone] onAllParallelChildrenDone error: ${err}`)
				// 兜底：即使 onAllParallelChildrenDone 出错，也要 resolve 父任务
				if (parentTask.parallelResolve) {
					parentTask.parallelResolve(`[Parallel Task Results]\n\n所有子任务已完成，但汇总过程出错: ${err}`)
					parentTask.parallelResolve = undefined
				}
				parentTask.parallelChildren.clear()
				this.postStateToWebviewWithoutClineMessages()
			})
		}
	}

	/**
	 * 所有并行子任务完成后，将结果注入父任务对话历史并恢复父任务。
	 */
	private async onAllParallelChildrenDone(parentTask: Task) {
		const snapshot = parentTask.getParallelChildrenSnapshot()
		const lines = ["[Parallel Task Results]", ""]

		for (const child of snapshot) {
			const icon = child.status === "completed" ? "✓" : "✗"
			lines.push(`${icon} ${child.description} — ${child.status === "completed" ? "完成" : "失败"}`)
			if (child.result) {
				lines.push(`  结果: ${child.result}`)
			}
			if (child.error) {
				lines.push(`  错误: ${child.error}`)
			}
			lines.push("")
		}

		const completedCount = snapshot.filter((c) => c.status === "completed").length
		const failedCount = snapshot.filter((c) => c.status === "failed").length
		lines.push(`总计: ${completedCount} 个完成, ${failedCount} 个失败`)

		// P2: 费用汇总
		if ((parentTask as any).parallelChildrenHistory && (parentTask as any).parallelChildrenHistory.length > 0) {
			let totalChildCost = 0
			for (const hist of (parentTask as any).parallelChildrenHistory) {
				if (hist.costSummary?.totalCostUSD) {
					totalChildCost += hist.costSummary.totalCostUSD
				}
			}
			if (totalChildCost > 0) {
				lines.push(`并行子任务总费用: $${totalChildCost.toFixed(4)}`)
			}
		}

		// 子任务失败不自动重试，直接将结果交给主任务处理

		lines.push("")
		lines.push("请检查结果并决定下一步操作。")

		// 更新消息中的最终快照
		this.updateParallelTaskMessageSnapshot(parentTask)

		// 将结果作为工具返回值注入父任务
		if (parentTask.parallelResolve) {
			this.log(`[onAllParallelChildrenDone] resolving parent task with ${lines.length} lines`)
			parentTask.parallelResolve(lines.join("\n"))
			parentTask.parallelResolve = undefined
		} else {
			this.log(`[onAllParallelChildrenDone] WARNING: parallelResolve is undefined, parent task may be stuck`)
		}

		// 先推送最终状态（所有子任务都显示完成/失败），再延迟清除
		this.postStateToWebviewWithoutClineMessages()

		// 延迟清除并行子任务状态，让 UI 有时间显示最终状态
		// 记录当前快照大小，避免清除新批次的数据（竞态保护）
		const snapshotSize = parentTask.getParallelChildrenSnapshot().length
		setTimeout(() => {
			// 只有当 parallelChildren 没有被新批次覆盖时才清除
			if (parentTask.getParallelChildrenSnapshot().length === snapshotSize) {
				parentTask.parallelChildren.clear()
				this.postStateToWebviewWithoutClineMessages()
			}
		}, 3000)

		this.log(`[onAllParallelChildrenDone] all children done for parent ${parentTask.taskId}`)
	}

	/**
	 * 更新父任务消息中的并行子任务快照，确保历史消息独立于实时状态。
	 */
	private updateParallelTaskMessageSnapshot(parentTask: Task): void {
		const snapshot = parentTask.getParallelChildrenSnapshot()
		const completedSnapshot = snapshot.map((c) => ({
			taskId: c.taskId,
			description: c.description,
			status: c.status,
			startedAt: c.startedAt,
			completedAt: c.completedAt,
			files: c.files,
			result: c.result,
			error: c.error,
		}))
		for (let i = parentTask.clineMessages.length - 1; i >= 0; i--) {
			const msg = parentTask.clineMessages[i]
			// 消息可能是 say/tool 或 ask/tool，两种都要匹配
			const isSpawnMsg =
				msg.text?.includes('"spawnParallelTask"') &&
				((msg.type === "say" && msg.say === "tool") || (msg.type === "ask" && msg.ask === "tool"))
			if (isSpawnMsg) {
				try {
					const parsed = JSON.parse(msg.text!)
					parsed.completedChildren = completedSnapshot
					msg.text = JSON.stringify(parsed)
				} catch {
					// 非致命
				}
				break
			}
		}
	}

	/**
	 * 从子任务中提取执行结果摘要。
	 */
	private extractChildResult(childTask: Task): string {
		// 从子任务的对话历史中提取最后的 completion_result 或错误信息
		const messages = childTask.clineMessages
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i]
			if (msg.say === "completion_result" || msg.ask === "completion_result") {
				return msg.text || "任务完成"
			}
			if (msg.say === "error") {
				return `错误: ${msg.text || "未知错误"}`
			}
		}
		return "任务执行完毕（无明确结果）"
	}

	/**
	 * 清理所有并行子任务（用于父任务取消或 dispose 时）。
	 */
	private async cleanupParallelTasks() {
		for (const [taskId, task] of this.parallelTasks) {
			try {
				await task.abortTask(true)
			} catch (err) {
				this.log(`[cleanupParallelTasks] failed to abort ${taskId}: ${err}`)
			}
			const cleanupFunctions = this.taskEventListeners.get(task)
			if (cleanupFunctions) {
				cleanupFunctions.forEach((cleanup) => cleanup())
				this.taskEventListeners.delete(task)
			}
		}
		this.parallelTasks.clear()

		// P1: 清理所有文件锁
		try {
			const { fileLockRegistry } = await import("../../services/file-lock/FileLockRegistry")
			fileLockRegistry.clear()
		} catch {
			// 非致命
		}
	}

	// Pending Edit Operations Management

	/**
	 * Sets a pending edit operation with automatic timeout cleanup
	 */
	public setPendingEditOperation(
		operationId: string,
		editData: {
			messageTs: number
			editedContent: string
			images?: string[]
			messageIndex: number
			apiConversationHistoryIndex: number
		},
	): void {
		// Clear any existing operation with the same ID
		this.clearPendingEditOperation(operationId)

		// Create timeout for automatic cleanup
		const timeoutId = setTimeout(() => {
			this.clearPendingEditOperation(operationId)
			this.log(`[setPendingEditOperation] Automatically cleared stale pending operation: ${operationId}`)
		}, ClineProvider.PENDING_OPERATION_TIMEOUT_MS)

		// Store the operation
		this.pendingOperations.set(operationId, {
			...editData,
			timeoutId,
			createdAt: Date.now(),
		})

		this.log(`[setPendingEditOperation] Set pending operation: ${operationId}`)
	}

	/**
	 * Gets a pending edit operation by ID
	 */
	private getPendingEditOperation(operationId: string): PendingEditOperation | undefined {
		return this.pendingOperations.get(operationId)
	}

	/**
	 * Clears a specific pending edit operation
	 */
	private clearPendingEditOperation(operationId: string): boolean {
		const operation = this.pendingOperations.get(operationId)
		if (operation) {
			clearTimeout(operation.timeoutId)
			this.pendingOperations.delete(operationId)
			this.log(`[clearPendingEditOperation] Cleared pending operation: ${operationId}`)
			return true
		}
		return false
	}

	/**
	 * Clears all pending edit operations
	 */
	private clearAllPendingEditOperations(): void {
		for (const [operationId, operation] of this.pendingOperations) {
			clearTimeout(operation.timeoutId)
		}
		this.pendingOperations.clear()
		this.log(`[clearAllPendingEditOperations] Cleared all pending operations`)
	}

	/*
	VSCode extensions use the disposable pattern to clean up resources when the sidebar/editor tab is closed by the user or system. This applies to event listening, commands, interacting with the UI, etc.
	- https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
	- https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	*/
	private clearWebviewResources() {
		while (this.webviewDisposables.length) {
			const x = this.webviewDisposables.pop()
			if (x) {
				x.dispose()
			}
		}
	}

	async dispose() {
		if (this._disposed) {
			return
		}

		this._disposed = true
		this.log("Disposing ClineProvider...")

		// Clear all tasks from the stack.
		while (this.clineStack.length > 0) {
			await this.removeClineFromStack()
		}

		// 清理所有并行子任务
		await this.cleanupParallelTasks()

		this.log("Cleared all tasks")

		// Clear all pending edit operations to prevent memory leaks
		this.clearAllPendingEditOperations()
		this.log("Cleared pending operations")

		if (this.view && "dispose" in this.view) {
			this.view.dispose()
			this.log("Disposed webview")
		}

		this.clearWebviewResources()

		// Clean up cloud service event listener
		if (CloudService.hasInstance()) {
			CloudService.instance.off("settings-updated", this.handleCloudSettingsUpdate)
		}

		while (this.disposables.length) {
			const x = this.disposables.pop()

			if (x) {
				x.dispose()
			}
		}

		this._workspaceTracker?.dispose()
		this._workspaceTracker = undefined
		await this.mcpHub?.unregisterClient()
		this.mcpHub = undefined
		await this.skillsManager?.dispose()
		this.skillsManager = undefined
		this.disposeScheduledTasks()
		this.marketplaceManager?.cleanup()
		this.customModesManager?.dispose()
		this.taskHistoryStore.dispose()
		this.flushGlobalStateWriteThrough()
		this.log("Disposed all disposables")
		ClineProvider.activeInstances.delete(this)

		// Clean up any event listeners attached to this provider
		this.removeAllListeners()

		McpServerManager.unregisterProvider(this)
	}

	public static getVisibleInstance(): ClineProvider | undefined {
		return findLast(Array.from(this.activeInstances), (instance) => instance.view?.visible === true)
	}

	public static async getInstance(): Promise<ClineProvider | undefined> {
		let visibleProvider = ClineProvider.getVisibleInstance()

		// If no visible provider, try to show the sidebar view
		if (!visibleProvider) {
			await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
			// Wait briefly for the view to become visible
			await delay(100)
			visibleProvider = ClineProvider.getVisibleInstance()
		}

		// If still no visible provider, return
		if (!visibleProvider) {
			return
		}

		return visibleProvider
	}

	public static async isActiveTask(): Promise<boolean> {
		const visibleProvider = await ClineProvider.getInstance()

		if (!visibleProvider) {
			return false
		}

		// Check if there is a cline instance in the stack (if this provider has an active task)
		if (visibleProvider.getCurrentTask()) {
			return true
		}

		return false
	}

	public static async handleCodeAction(
		command: CodeActionId,
		promptType: CodeActionName,
		params: Record<string, string | any[]>,
	): Promise<void> {
		// Capture telemetry for code action usage
		TelemetryService.instance.captureCodeActionUsed(promptType)

		const visibleProvider = await ClineProvider.getInstance()

		if (!visibleProvider) {
			return
		}

		const { customSupportPrompts } = await visibleProvider.getState()

		// TODO: Improve type safety for promptType.
		const prompt = supportPrompt.create(promptType, params, customSupportPrompts)

		if (command === "addToContext") {
			await visibleProvider.postMessageToWebview({
				type: "invoke",
				invoke: "setChatBoxMessage",
				text: `${prompt}\n\n`,
			})
			await visibleProvider.postMessageToWebview({ type: "action", action: "focusInput" })
			return
		}

		await visibleProvider.createTask(prompt)
	}

	public static async handleTerminalAction(
		command: TerminalActionId,
		promptType: TerminalActionPromptType,
		params: Record<string, string | any[]>,
	): Promise<void> {
		TelemetryService.instance.captureCodeActionUsed(promptType)

		const visibleProvider = await ClineProvider.getInstance()

		if (!visibleProvider) {
			return
		}

		const { customSupportPrompts } = await visibleProvider.getState()
		const prompt = supportPrompt.create(promptType, params, customSupportPrompts)

		if (command === "terminalAddToContext") {
			await visibleProvider.postMessageToWebview({
				type: "invoke",
				invoke: "setChatBoxMessage",
				text: `${prompt}\n\n`,
			})
			await visibleProvider.postMessageToWebview({ type: "action", action: "focusInput" })
			return
		}

		try {
			await visibleProvider.createTask(prompt)
		} catch (error) {
			if (error instanceof OrganizationAllowListViolationError) {
				// Errors from terminal commands seem to get swallowed / ignored.
				vscode.window.showErrorMessage(error.message)
			}

			throw error
		}
	}

	async resolveWebviewView(webviewView: vscode.WebviewView | vscode.WebviewPanel) {
		this.view = webviewView
		const inTabMode = "onDidChangeViewState" in webviewView

		if (inTabMode) {
			setPanel(webviewView, "tab")
		} else if ("onDidChangeVisibility" in webviewView) {
			setPanel(webviewView, "sidebar")
		}

		// Initialize out-of-scope variables that need to receive persistent
		// global state values.
		this.getState().then(
			({
				terminalShellIntegrationTimeout = Terminal.defaultShellIntegrationTimeout,
				terminalShellIntegrationDisabled = false,
				terminalCommandDelay = 0,
				terminalZshClearEolMark = true,
				terminalZshOhMy = false,
				terminalZshP10k = false,
				terminalPowershellCounter = false,
				terminalZdotdir = false,
				ttsEnabled,
				ttsSpeed,
			}) => {
				Terminal.setShellIntegrationTimeout(terminalShellIntegrationTimeout)
				Terminal.setShellIntegrationDisabled(terminalShellIntegrationDisabled)
				Terminal.setCommandDelay(terminalCommandDelay)
				Terminal.setTerminalZshClearEolMark(terminalZshClearEolMark)
				Terminal.setTerminalZshOhMy(terminalZshOhMy)
				Terminal.setTerminalZshP10k(terminalZshP10k)
				Terminal.setPowershellCounter(terminalPowershellCounter)
				Terminal.setTerminalZdotdir(terminalZdotdir)
				setTtsEnabled(ttsEnabled ?? false)
				setTtsSpeed(ttsSpeed ?? 1)
			},
		)

		// Set up webview options with proper resource roots
		const resourceRoots = [this.contextProxy.extensionUri]

		// Add workspace folders to allow access to workspace files
		if (vscode.workspace.workspaceFolders) {
			resourceRoots.push(...vscode.workspace.workspaceFolders.map((folder) => folder.uri))
		}

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: resourceRoots,
		}

		webviewView.webview.html =
			this.contextProxy.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent(webviewView.webview)
				: await this.getHtmlContent(webviewView.webview)

		// Sets up an event listener to listen for messages passed from the webview view context
		// and executes code based on the message that is received.
		this.setWebviewMessageListener(webviewView.webview)

		// 启动 webview 心跳监视器（与 App.tsx 5s 心跳配套）
		this.startWebviewHeartbeatWatchdog()

		// Initialize code index status subscription for the current workspace.
		this.updateCodeIndexStatusSubscription()

		// Listen for active editor changes to update code index status for the
		// current workspace.
		const activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor(() => {
			// Update subscription when workspace might have changed.
			this.updateCodeIndexStatusSubscription()
		})
		this.webviewDisposables.push(activeEditorSubscription)

		// Listen for when the panel becomes visible.
		// https://github.com/microsoft/vscode-discussions/discussions/840
		if ("onDidChangeViewState" in webviewView) {
			// WebviewView and WebviewPanel have all the same properties except
			// for this visibility listener panel.
			const viewStateDisposable = webviewView.onDidChangeViewState(() => {
				if (this.view?.visible) {
					this.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
				}
			})

			this.webviewDisposables.push(viewStateDisposable)
		} else if ("onDidChangeVisibility" in webviewView) {
			// sidebar
			const visibilityDisposable = webviewView.onDidChangeVisibility(() => {
				if (this.view?.visible) {
					this.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
					// 当 sidebar 重新变为可见时，刷新完整状态到 webview
					// 这对 OAuth 登录回调尤为重要：浏览器登录成功后回到 VSCode，
					// sidebar 可能刚刚从不可见变为可见，需要同步最新认证状态
					this.postStateToWebview().catch((err) => {
						console.warn("[ClineProvider] Failed to refresh state on visibility change:", err)
					})
				}
			})

			this.webviewDisposables.push(visibilityDisposable)
		}

		// Listen for when the view is disposed
		// This happens when the user closes the view or when the view is closed programmatically
		webviewView.onDidDispose(
			async () => {
				this.stopWebviewHeartbeatWatchdog()
				if (inTabMode) {
					this.log("Disposing ClineProvider instance for tab view")
					await this.dispose()
				} else {
					this.log("Clearing webview resources for sidebar view")
					this.clearWebviewResources()
					// Reset current workspace manager reference when view is disposed
					this.codeIndexManager = undefined
				}
			},
			null,
			this.disposables,
		)

		// Listen for when color changes
		const configDisposable = vscode.workspace.onDidChangeConfiguration(async (e) => {
			if (e && e.affectsConfiguration("workbench.colorTheme")) {
				// Sends latest theme name to webview
				await this.postMessageToWebview({ type: "theme", text: JSON.stringify(await getTheme()) })
			}
		})
		this.webviewDisposables.push(configDisposable)

		// If the extension is starting a new session, clear previous task state.
		// But don't clear if there's already an active task (e.g., resumed via IPC/bridge).
		const currentTask = this.getCurrentTask()
		if (!currentTask || currentTask.abandoned || currentTask.abort) {
			await this.removeClineFromStack()
		}
	}

	public async createTaskWithHistoryItem(
		historyItem: HistoryItem & { rootTask?: Task; parentTask?: Task },
		options?: { startTask?: boolean },
	) {
		const isCliRuntime = process.env.ROO_CLI_RUNTIME === "1"
		// CLI injects runtime provider settings from command flags/env at startup.
		// Restoring provider profiles from task history can overwrite those
		// runtime settings with stale/incomplete persisted profiles.
		const skipProfileRestoreFromHistory = isCliRuntime

		// Check if we're rehydrating the current task to avoid flicker
		const currentTask = this.getCurrentTask()
		const isRehydratingCurrentTask = currentTask && currentTask.taskId === historyItem.id

		if (!isRehydratingCurrentTask) {
			await this.removeClineFromStack()
		}

		// If the history item has a saved mode, restore it and its associated API configuration.
		if (historyItem.mode) {
			// Validate that the mode still exists
			const customModes = await this.customModesManager.getCustomModes()
			const modeExists = getModeBySlug(historyItem.mode, customModes) !== undefined

			if (!modeExists) {
				// Mode no longer exists, fall back to default mode.
				this.log(
					`Mode '${historyItem.mode}' from history no longer exists. Falling back to default mode '${defaultModeSlug}'.`,
				)
				historyItem.mode = defaultModeSlug
			}

			await this.updateGlobalState("mode", historyItem.mode)

			// Load the saved API config for the restored mode if it exists.
			// Skip mode-based profile activation if historyItem.apiConfigName exists,
			// since the task's specific provider profile will override it anyway.
			const lockApiConfigAcrossModes = this.context.workspaceState.get("lockApiConfigAcrossModes", false)

			if (!historyItem.apiConfigName && !lockApiConfigAcrossModes && !skipProfileRestoreFromHistory) {
				const savedConfigId = await this.providerSettingsManager.getModeConfigId(historyItem.mode)
				const listApiConfig = await this.providerSettingsManager.listConfig()

				// Update listApiConfigMeta first to ensure UI has latest data.
				await this.updateGlobalState("listApiConfigMeta", listApiConfig)

				// If this mode has a saved config, use it.
				if (savedConfigId) {
					const profile = listApiConfig.find(({ id }) => id === savedConfigId)

					if (profile?.name) {
						try {
							// Check if the profile has actual API configuration (not just an id).
							// In CLI mode, the ProviderSettingsManager may return empty default profiles
							// that only contain 'id' and 'name' fields. Activating such a profile would
							// overwrite the CLI's working API configuration with empty settings.
							const fullProfile = await this.providerSettingsManager.getProfile({ name: profile.name })
							const hasActualSettings = !!fullProfile.apiProvider

							if (hasActualSettings) {
								await this.activateProviderProfile({ name: profile.name })
							} else {
								// The task will continue with the current/default configuration.
							}
						} catch (error) {
							// Log the error but continue with task restoration.
							this.log(
								`Failed to restore API configuration for mode '${historyItem.mode}': ${
									error instanceof Error ? error.message : String(error)
								}. Continuing with default configuration.`,
							)
							// The task will continue with the current/default configuration.
						}
					}
				}
			}
		}

		// If the history item has a saved API config name (provider profile), restore it.
		// This overrides any mode-based config restoration above, because the task's
		// specific provider profile takes precedence over mode defaults.
		if (historyItem.apiConfigName && !skipProfileRestoreFromHistory) {
			const listApiConfig = await this.providerSettingsManager.listConfig()
			// Keep global state/UI in sync with latest profiles for parity with mode restoration above.
			await this.updateGlobalState("listApiConfigMeta", listApiConfig)
			const profile = listApiConfig.find(({ name }) => name === historyItem.apiConfigName)

			if (profile?.name) {
				try {
					await this.activateProviderProfile(
						{ name: profile.name },
						{ persistModeConfig: false, persistTaskHistory: false },
					)
				} catch (error) {
					// Log the error but continue with task restoration.
					this.log(
						`Failed to restore API configuration '${historyItem.apiConfigName}' for task: ${
							error instanceof Error ? error.message : String(error)
						}. Continuing with current configuration.`,
					)
				}
			} else {
				// Profile no longer exists, log warning but continue
				this.log(
					`Provider profile '${historyItem.apiConfigName}' from history no longer exists. Using current configuration.`,
				)
			}
		} else if (historyItem.apiConfigName && skipProfileRestoreFromHistory) {
			this.log(
				`Skipping restore of provider profile '${historyItem.apiConfigName}' for task ${historyItem.id} in CLI runtime.`,
			)
		}

		const { apiConfiguration, enableCheckpoints, checkpointTimeout, experiments, cloudUserInfo, taskSyncEnabled } =
			await this.getState()

		// 从持久化文件恢复 todo 列表 (Requirements: 7.2)
		let persistedTodos: import("@roo-code/types").TodoItem[] | undefined
		try {
			const { TaskProgressPersistence } = await import("../tools/TaskProgressPersistence")
			const cwd = historyItem.workspace || this.cwd
			const persistence = new TaskProgressPersistence(cwd)
			const progress = await persistence.load(historyItem.id)
			if (progress && progress.todos.length > 0) {
				persistedTodos = progress.todos
			}
		} catch {
			// 持久化加载失败，静默忽略 (Requirements: 7.5)
		}

		const task = new Task({
			provider: this,
			apiConfiguration,
			enableCheckpoints,
			checkpointTimeout,
			consecutiveMistakeLimit: apiConfiguration.consecutiveMistakeLimit,
			historyItem,
			experiments,
			rootTask: historyItem.rootTask,
			parentTask: historyItem.parentTask,
			taskNumber: historyItem.number,
			workspacePath: historyItem.workspace,
			onCreated: this.taskCreationCallback,
			startTask: options?.startTask ?? true,
			// Preserve the status from the history item to avoid overwriting it when the task saves messages
			initialStatus: historyItem.status,
			initialTodos: persistedTodos,
		})

		if (isRehydratingCurrentTask) {
			// Replace the current task in-place to avoid UI flicker
			const stackIndex = this.clineStack.length - 1

			// Properly dispose of the old task to ensure garbage collection
			const oldTask = this.clineStack[stackIndex]

			// Abort the old task to stop running processes and mark as abandoned
			try {
				await oldTask.abortTask(true)
			} catch (e) {
				this.log(
					`[createTaskWithHistoryItem] abortTask() failed for old task ${oldTask.taskId}.${oldTask.instanceId}: ${e.message}`,
				)
			}

			// Remove event listeners from the old task
			const cleanupFunctions = this.taskEventListeners.get(oldTask)
			if (cleanupFunctions) {
				cleanupFunctions.forEach((cleanup) => cleanup())
				this.taskEventListeners.delete(oldTask)
			}

			// Replace the task in the stack
			this.clineStack[stackIndex] = task
			task.emit(RooCodeEventName.TaskFocused)

			// Perform preparation tasks and set up event listeners
			await this.performPreparationTasks(task)

			this.log(
				`[createTaskWithHistoryItem] rehydrated task ${task.taskId}.${task.instanceId} in-place (flicker-free)`,
			)
		} else {
			await this.addClineToStack(task)

			this.log(
				`[createTaskWithHistoryItem] ${task.parentTask ? "child" : "parent"} task ${task.taskId}.${task.instanceId} instantiated`,
			)
		}

		// Check if there's a pending edit after checkpoint restoration
		const operationId = `task-${task.taskId}`
		const pendingEdit = this.getPendingEditOperation(operationId)
		if (pendingEdit) {
			this.clearPendingEditOperation(operationId) // Clear the pending edit

			this.log(`[createTaskWithHistoryItem] Processing pending edit after checkpoint restoration`)

			// Process the pending edit after a short delay to ensure the task is fully initialized
			setTimeout(async () => {
				try {
					// Find the message index in the restored state
					const { messageIndex, apiConversationHistoryIndex } = (() => {
						const messageIndex = task.clineMessages.findIndex((msg) => msg.ts === pendingEdit.messageTs)
						const apiConversationHistoryIndex = task.apiConversationHistory.findIndex(
							(msg) => msg.ts === pendingEdit.messageTs,
						)
						return { messageIndex, apiConversationHistoryIndex }
					})()

					if (messageIndex !== -1) {
						// Remove the target message and all subsequent messages
						await task.overwriteClineMessages(task.clineMessages.slice(0, messageIndex))

						if (apiConversationHistoryIndex !== -1) {
							await task.overwriteApiConversationHistory(
								task.apiConversationHistory.slice(0, apiConversationHistoryIndex),
							)
						}

						// Process the edited message
						await task.handleWebviewAskResponse(
							"messageResponse",
							pendingEdit.editedContent,
							pendingEdit.images,
						)
					}
				} catch (error) {
					this.log(`[createTaskWithHistoryItem] Error processing pending edit: ${error}`)
				}
			}, 100) // Small delay to ensure task is fully ready
		}

		return task
	}

	// ─── Diagnostic: postMessage 体积/慢路径监控 ───────────────────────────
	// 用于排查 webview "中途白屏"。当 IPC payload 过大或 postMessage 阻塞过久时
	// 主线程会卡住，最终 webview 看起来是空白的。这里只在超阈值时打日志，
	// 避免污染正常输出。复现后查看 ToCodex 输出面板即可拿到 size+耗时+type。
	private static readonly POST_MESSAGE_SIZE_WARN = 1 * 1024 * 1024 // 1MB
	private static readonly POST_MESSAGE_DURATION_WARN_MS = 200
	private postMessageStats = { total: 0, oversize: 0, slow: 0 }

	public async postMessageToWebview(message: ExtensionMessage) {
		if (this._disposed) {
			return
		}

		// 只在超阈值时序列化测量 size，避免每条消息都付出 JSON.stringify 代价。
		// 先看 type 名做粗筛——只有 state/messageUpdated/scheduledTasksLoaded 这类
		// 可能携带大 payload 的消息才测 size。
		const type = (message as any)?.type as string | undefined
		const sizeProneTypes = new Set(["state", "messageUpdated", "scheduledTasksLoaded", "taskHistoryUpdated"])
		const measure = type ? sizeProneTypes.has(type) : false

		const start = measure ? Date.now() : 0
		let size = 0
		if (measure) {
			try {
				size = JSON.stringify(message).length
			} catch {
				size = -1
			}
		}

		this.postMessageStats.total++
		if (size > ClineProvider.POST_MESSAGE_SIZE_WARN) {
			this.postMessageStats.oversize++
			this.log(
				`[postMessage] OVERSIZE type=${type} size=${(size / 1024 / 1024).toFixed(2)}MB total=${this.postMessageStats.total} oversize=${this.postMessageStats.oversize}`,
			)
		}

		try {
			await this.view?.webview.postMessage(message)
		} catch {
			// View disposed, drop message silently
		}

		if (measure) {
			const elapsed = Date.now() - start
			if (elapsed > ClineProvider.POST_MESSAGE_DURATION_WARN_MS) {
				this.postMessageStats.slow++
				this.log(
					`[postMessage] SLOW type=${type} ${elapsed}ms size=${(size / 1024).toFixed(0)}KB slow=${this.postMessageStats.slow}/${this.postMessageStats.total}`,
				)
			}
		}
	}

	private async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
		let localPort = "5173"

		try {
			const fs = require("fs")
			const path = require("path")
			const portFilePath = path.resolve(__dirname, "../../.vite-port")

			if (fs.existsSync(portFilePath)) {
				localPort = fs.readFileSync(portFilePath, "utf8").trim()
				console.log(`[ClineProvider:Vite] Using Vite server port from ${portFilePath}: ${localPort}`)
			} else {
				console.log(
					`[ClineProvider:Vite] Port file not found at ${portFilePath}, using default port: ${localPort}`,
				)
			}
		} catch (err) {
			console.error("[ClineProvider:Vite] Failed to read Vite port file:", err)
		}

		const localServerUrl = `localhost:${localPort}`

		// Check if local dev server is running.
		try {
			await axios.get(`http://${localServerUrl}`, { timeout: 3000 })
		} catch (error) {
			vscode.window.showErrorMessage(t("common:errors.hmr_not_running"))
			return this.getHtmlContent(webview)
		}

		const nonce = getNonce()

		// Get the OpenRouter base URL from configuration
		const { apiConfiguration } = await this.getState()
		const openRouterBaseUrl = apiConfiguration.openRouterBaseUrl || "https://openrouter.ai"
		// Extract the domain for CSP
		const openRouterDomain = openRouterBaseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai"

		const stylesUri = getUri(webview, this.contextProxy.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"index.css",
		])

		const codiconsUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "codicons", "codicon.css"])
		const materialIconsUri = getUri(webview, this.contextProxy.extensionUri, [
			"assets",
			"vscode-material-icons",
			"icons",
		])
		const imagesUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "images"])
		const audioUri = getUri(webview, this.contextProxy.extensionUri, ["webview-ui", "audio"])

		const file = "src/index.tsx"
		const scriptUri = `http://${localServerUrl}/${file}`

		const reactRefresh = /*html*/ `
			<script nonce="${nonce}" type="module">
				import RefreshRuntime from "http://localhost:${localPort}/@react-refresh"
				RefreshRuntime.injectIntoGlobalHook(window)
				window.$RefreshReg$ = () => {}
				window.$RefreshSig$ = () => (type) => type
				window.__vite_plugin_react_preamble_installed__ = true
			</script>
		`

		const csp = [
			"default-src 'none'",
			`font-src ${webview.cspSource} data:`,
			`style-src ${webview.cspSource} 'unsafe-inline' https://* http://${localServerUrl} http://0.0.0.0:${localPort}`,
			`img-src ${webview.cspSource} https://storage.googleapis.com data:`,
			`media-src ${webview.cspSource}`,
			`script-src 'unsafe-eval' ${webview.cspSource} https://* http://${localServerUrl} http://0.0.0.0:${localPort} 'nonce-${nonce}'`,
			`connect-src ${webview.cspSource} ${openRouterDomain} https://* ws://${localServerUrl} ws://0.0.0.0:${localPort} http://${localServerUrl} http://0.0.0.0:${localPort}`,
		]

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<link href="${codiconsUri}" rel="stylesheet" />
					<script nonce="${nonce}">
						window.IMAGES_BASE_URI = "${imagesUri}"
						window.AUDIO_BASE_URI = "${audioUri}"
						window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
					</script>
					<title>ToCodex</title>
				</head>
				<body>
					<div id="root"></div>
					${reactRefresh}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
	}

	/**
	 * Defines and returns the HTML that should be rendered within the webview panel.
	 *
	 * @remarks This is also the place where references to the React webview build files
	 * are created and inserted into the webview HTML.
	 *
	 * @param webview A reference to the extension webview
	 * @param extensionUri The URI of the directory containing the extension
	 * @returns A template string literal containing the HTML that should be
	 * rendered within the webview panel
	 */
	private async getHtmlContent(webview: vscode.Webview): Promise<string> {
		// Get the local path to main script run in the webview,
		// then convert it to a uri we can use in the webview.

		// The CSS file from the React build output
		const stylesUri = getUri(webview, this.contextProxy.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"index.css",
		])

		const scriptUri = getUri(webview, this.contextProxy.extensionUri, ["webview-ui", "build", "assets", "index.js"])
		const codiconsUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "codicons", "codicon.css"])
		const materialIconsUri = getUri(webview, this.contextProxy.extensionUri, [
			"assets",
			"vscode-material-icons",
			"icons",
		])
		const imagesUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "images"])
		const audioUri = getUri(webview, this.contextProxy.extensionUri, ["webview-ui", "audio"])

		// Use a nonce to only allow a specific script to be run.
		/*
		content security policy of your webview to only allow scripts that have a specific nonce
		create a content security policy meta tag so that only loading scripts with a nonce is allowed
		As your extension grows you will likely want to add custom styles, fonts, and/or images to your webview. If you do, you will need to update the content security policy meta tag to explicitly allow for these resources. E.g.
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
		- 'unsafe-inline' is required for styles due to vscode-webview-toolkit's dynamic style injection
		- since we pass base64 images to the webview, we need to specify img-src ${webview.cspSource} data:;

		in meta tag we add nonce attribute: A cryptographic nonce (only used once) to allow scripts. The server must generate a unique nonce value each time it transmits a policy. It is critical to provide a nonce that cannot be guessed as bypassing a resource's policy is otherwise trivial.
		*/
		const nonce = getNonce()

		// Get the OpenRouter base URL from configuration
		const { apiConfiguration } = await this.getState()
		const openRouterBaseUrl = apiConfiguration.openRouterBaseUrl || "https://openrouter.ai"
		// Extract the domain for CSP
		const openRouterDomain = openRouterBaseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai"

		// Tip: Install the es6-string-html VS Code extension to enable code highlighting below
		return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
            <meta name="theme-color" content="#000000">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https://storage.googleapis.com data:; media-src ${webview.cspSource}; script-src ${webview.cspSource} 'unsafe-inline' 'wasm-unsafe-eval'; connect-src ${webview.cspSource} ${openRouterDomain} https://api.requesty.ai;">
            <link rel="stylesheet" type="text/css" href="${stylesUri}">
			<link href="${codiconsUri}" rel="stylesheet" />
			<script nonce="${nonce}">
				window.IMAGES_BASE_URI = "${imagesUri}"
				window.AUDIO_BASE_URI = "${audioUri}"
				window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
			</script>
            <title>ToCodex</title>
          </head>
          <body>
            <noscript>You need to enable JavaScript to run this app.</noscript>
            <div id="root"></div>
            <div id="debug-loading" style="color: #ccc; padding: 20px; font-family: sans-serif;">Loading ToCodex...</div>
            <script nonce="${nonce}">
              window.onerror = function(msg, url, line, col, error) {
                var d = document.getElementById('debug-loading');
                if (d) d.innerHTML = '<pre style="color:red;">JS Error: ' + msg + '\\n' + url + ':' + line + '</pre>';
              };
            </script>
            <script nonce="${nonce}" type="module" src="${scriptUri}" onerror="document.getElementById('debug-loading').innerHTML='<pre style=color:red>Failed to load script</pre>'"></script>
            <script nonce="${nonce}">
              // 如果 React 成功渲染，隐藏调试信息
              var checkInterval = setInterval(function() {
                var root = document.getElementById('root');
                if (root && root.children.length > 0) {
                  var dbg = document.getElementById('debug-loading');
                  if (dbg) dbg.style.display = 'none';
                  clearInterval(checkInterval);
                }
              }, 500);
              // 10秒后如果还没渲染，显示超时信息
              setTimeout(function() {
                var root = document.getElementById('root');
                var dbg = document.getElementById('debug-loading');
                if (root && root.children.length === 0 && dbg) {
                  dbg.innerHTML = '<pre style="color:orange;">ToCodex webview timed out waiting for state.\\nRoot element is empty after 10s.\\nCheck Output panel for errors.</pre>';
                }
                clearInterval(checkInterval);
              }, 10000);
            </script>
          </body>
        </html>
      `
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview context and
	 * executes code based on the message that is received.
	 *
	 * @param webview A reference to the extension webview
	 */
	private setWebviewMessageListener(webview: vscode.Webview) {
		const onReceiveMessage = async (message: WebviewMessage) =>
			webviewMessageHandler(this, message, this.marketplaceManager)

		const messageDisposable = webview.onDidReceiveMessage(onReceiveMessage)
		this.webviewDisposables.push(messageDisposable)
	}

	/**
	 * Handle switching to a new mode, including updating the associated API configuration
	 * @param newMode The mode to switch to
	 */
	public async handleModeSwitch(newMode: Mode) {
		const task = this.getCurrentTask()

		if (task) {
			TelemetryService.instance.captureModeSwitch(task.taskId, newMode)
			task.emit(RooCodeEventName.TaskModeSwitched, task.taskId, newMode)

			try {
				// Update the task history with the new mode first.
				const taskHistoryItem =
					this.taskHistoryStore.get(task.taskId) ??
					(this.getGlobalState("taskHistory") ?? []).find((item) => item.id === task.taskId)

				if (taskHistoryItem) {
					await this.updateTaskHistory({ ...taskHistoryItem, mode: newMode })
				}

				// Only update the task's mode after successful persistence.
				;(task as any)._taskMode = newMode
			} catch (error) {
				// If persistence fails, log the error but don't update the in-memory state.
				this.log(
					`Failed to persist mode switch for task ${task.taskId}: ${error instanceof Error ? error.message : String(error)}`,
				)

				// Optionally, we could emit an event to notify about the failure.
				// This ensures the in-memory state remains consistent with persisted state.
				throw error
			}
		}

		await this.updateGlobalState("mode", newMode)

		this.emit(RooCodeEventName.ModeChanged, newMode)

		// If workspace lock is on, keep the current API config — don't load mode-specific config
		const lockApiConfigAcrossModes = this.context.workspaceState.get("lockApiConfigAcrossModes", false)
		if (lockApiConfigAcrossModes) {
			await this.postStateToWebview()
			return
		}

		// Load the saved API config for the new mode if it exists.
		const savedConfigId = await this.providerSettingsManager.getModeConfigId(newMode)
		const listApiConfig = await this.providerSettingsManager.listConfig()

		// Update listApiConfigMeta first to ensure UI has latest data.
		await this.updateGlobalState("listApiConfigMeta", listApiConfig)

		// If this mode has a saved config, use it.
		if (savedConfigId) {
			const profile = listApiConfig.find(({ id }) => id === savedConfigId)

			if (profile?.name) {
				// Check if the profile has actual API configuration (not just an id).
				// In CLI mode, the ProviderSettingsManager may return empty default profiles
				// that only contain 'id' and 'name' fields. Activating such a profile would
				// overwrite the CLI's working API configuration with empty settings.
				// Skip activation if the profile has no apiProvider set - this indicates
				// an unconfigured/empty profile.
				const fullProfile = await this.providerSettingsManager.getProfile({ name: profile.name })
				const hasActualSettings = !!fullProfile.apiProvider

				if (hasActualSettings) {
					await this.activateProviderProfile({ name: profile.name })
				} else {
					// The task will continue with the current/default configuration.
				}
			} else {
				// The task will continue with the current/default configuration.
			}
		} else {
			// If no saved config for this mode, save current config as default.
			const currentApiConfigNameAfter = this.getGlobalState("currentApiConfigName")

			if (currentApiConfigNameAfter) {
				const config = listApiConfig.find((c) => c.name === currentApiConfigNameAfter)

				if (config?.id) {
					await this.providerSettingsManager.setModeConfig(newMode, config.id)
				}
			}
		}

		// 切换到 ssh-server 模式时，自动启用 MCP 并刷新连接
		if (newMode === "ssh-server") {
			const state = await this.getState()
			if (!state.mcpEnabled) {
				await this.updateGlobalState("mcpEnabled", true)
			}
			// 确保 mcp.json 中 ssh-server 指向插件内嵌的 bundle
			await this.ensureSshServerMcpConfig()
			// 无论 MCP 是否刚启用，都刷新连接确保 ssh-server 已连上
			await this.getMcpHub()?.refreshAllConnections()
		}

		// 切换到 browser-worker 模式时，自动启用 MCP 并注入 playwright server
		if (newMode === "browser-worker") {
			const state = await this.getState()
			if (!state.mcpEnabled) {
				await this.updateGlobalState("mcpEnabled", true)
			}
			// 确保 mcp.json 中存在 playwright server 默认配置
			await this.ensureBrowserWorkerMcpConfig()
			// 刷新连接确保 playwright server 已就绪
			await this.getMcpHub()?.refreshAllConnections()
		}

		await this.postStateToWebview()
	}

	/**
	 * 确保 .tocodex/mcp.json 中 ssh-server 的 command/args 指向插件内嵌的 bundle。
	 * 只更新路径，不覆盖用户已填写的 SSH_HOST/SSH_PASSWORD 等 env 字段。
	 */
	private async ensureSshServerMcpConfig(): Promise<void> {
		try {
			const workspacePath = this.cwd
			if (!workspacePath) return

			const mcpDir = path.join(workspacePath, ".tocodex")
			const mcpPath = path.join(mcpDir, "mcp.json")

			// 插件内嵌的 SSH MCP Server bundle 路径
			const bundlePath = path.join(this.context.extensionPath, "mcp-servers", "community-placeholder.cjs")

			let config: any = { mcpServers: {} }
			try {
				const content = await fs.readFile(mcpPath, "utf-8")
				config = JSON.parse(content)
			} catch {
				// 文件不存在或解析失败，用默认空配置
			}

			if (!config.mcpServers) config.mcpServers = {}

			const existing = config.mcpServers["ssh-server"] || {}
			const existingEnv = existing.env || {}

			// 只更新 command/args 路径，保留用户的 env 配置
			config.mcpServers["ssh-server"] = {
				command: "node",
				args: [bundlePath],
				env: {
					SSH_HOST: existingEnv.SSH_HOST || "",
					SSH_PORT: existingEnv.SSH_PORT || "22",
					SSH_USER: existingEnv.SSH_USER || "root",
					SSH_PASSWORD: existingEnv.SSH_PASSWORD || "",
					...existingEnv,
				},
				// 始终设为通配符，确保所有 ssh-server 工具默认勾选"始终允许"
				alwaysAllow: ["*"],
			}

			await fs.mkdir(mcpDir, { recursive: true })
			await fs.writeFile(mcpPath, JSON.stringify(config, null, "\t"), "utf-8")
		} catch (error) {
			this.log(`[ensureSshServerMcpConfig] Error: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * 确保 .tocodex/mcp.json 中 playwright server 已配置（用于 browser-worker 模式）。
	 *
	 * **设计原则：隔离持久化 profile** —— 在工作区 .tocodex/browser-profiles/<channel>/ 下
	 * 创建独立 profile 目录，不占用用户真实 Chrome profile，避免 SingletonLock 冲突。
	 *
	 * 优势：
	 * - 不需要 kill 用户正在使用的 Chrome
	 * - 路径无空格（工作区路径通常无空格），避免 cmd.exe 参数传递问题
	 * - Profile 持久化保存 → 登录态、cookies 自动保持（首次需登录一次）
	 * - Playwright 对隔离 profile 控制最稳定（无扩展干扰、无 session restore）
	 *
	 * 用户自定义优先：若用户已手动改过 mcp.json 中的 command/args/env，完全尊重不覆盖。
	 * alwaysAllow 始终保持 ["*"]，避免审批打断。
	 */
	private async ensureBrowserWorkerMcpConfig(): Promise<void> {
		try {
			const workspacePath = this.cwd
			if (!workspacePath) return

			const mcpDir = path.join(workspacePath, ".tocodex")
			const mcpPath = path.join(mcpDir, "mcp.json")

			// 确保 .tocodex 目录存在
			await fs.mkdir(mcpDir, { recursive: true })

			// 自动生成 Playwright MCP 配置文件（去除导致 Chrome 警告横幅的标志）
			// 注意：必须保留 --enable-automation，否则 Playwright 无法通过 CDP 控制浏览器（导航会超时）
			// 仅移除 --disable-blink-features=AutomationControlled，这是 Chrome 显示
			// "您使用的是不受支持的命令行标记" 警告横幅的根源
			const playwrightConfigPath = path.join(mcpDir, "playwright-mcp-config.json")
			const playwrightConfig = {
				browser: {
					launchOptions: {
						ignoreDefaultArgs: ["--disable-blink-features=AutomationControlled"],
						args: ["--no-first-run", "--disable-session-crashed-bubble", "--no-default-browser-check"],
					},
				},
			}
			await fs.writeFile(playwrightConfigPath, JSON.stringify(playwrightConfig, null, "\t"), "utf-8")

			let config: any = { mcpServers: {} }
			try {
				const content = await fs.readFile(mcpPath, "utf-8")
				config = JSON.parse(content)
			} catch {
				// 文件不存在或解析失败，用默认空配置
			}

			if (!config.mcpServers) config.mcpServers = {}

			const existing = config.mcpServers["playwright"] || {}

			// 检测用户环境，选择最优浏览器（Chrome > Edge > Chromium）
			const { detectBestBrowser, getIsolatedBrowserProfileDir } = await import("../../utils/browser-detection")
			const detection = await detectBestBrowser()
			this.log(`[ensureBrowserWorkerMcpConfig] Browser detection: ${detection.reason}`)

			// 使用隔离持久化 profile（在工作区 .tocodex/browser-profiles/<channel>/ 下）
			const isolatedProfileDir = getIsolatedBrowserProfileDir(workspacePath, detection.channel)
			await fs.mkdir(isolatedProfileDir, { recursive: true })
			this.log(`[ensureBrowserWorkerMcpConfig] 隔离 profile: ${isolatedProfileDir}`)

			// 公共尾部参数：增大导航超时 + 配置文件
			const commonTailArgs = ["--timeout-navigation", "120000", "--config", playwrightConfigPath]

			// 直接用 npx 启动 Playwright MCP，无需 launcher wrapper
			const defaultCommand = "npx"
			const defaultArgs = [
				"-y",
				"@playwright/mcp@latest",
				"--browser",
				detection.channel,
				"--user-data-dir",
				isolatedProfileDir,
				...commonTailArgs,
			]

			// 判断现有 args 是否为自动生成的（包含 @playwright/mcp 或 launcher）
			// 如果是自动生成的，每次都更新为最新策略
			// 如果是用户完全自定义的，则保留不覆盖
			const isAutoGeneratedArgs =
				!existing.args ||
				!Array.isArray(existing.args) ||
				existing.args.length === 0 ||
				existing.args.some(
					(a: string) =>
						typeof a === "string" && (a.includes("@playwright/mcp") || a.includes("playwright-launcher")),
				)

			config.mcpServers["playwright"] = {
				command: isAutoGeneratedArgs ? defaultCommand : existing.command || "npx",
				args: isAutoGeneratedArgs ? defaultArgs : existing.args,
				env: existing.env || {},
				// 始终设为通配符，确保所有 browser_* 工具默认勾选"始终允许"
				alwaysAllow: ["*"],
			}

			await fs.writeFile(mcpPath, JSON.stringify(config, null, "\t"), "utf-8")
		} catch (error) {
			this.log(`[ensureBrowserWorkerMcpConfig] Error: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	// Provider Profile Management

	/**
	 * Updates the current task's API handler.
	 * Rebuilds when:
	 * - provider or model changes, OR
	 * - explicitly forced (e.g., user-initiated profile switch/save to apply changed settings like headers/baseUrl/tier).
	 * Always synchronizes task.apiConfiguration with latest provider settings.
	 * @param providerSettings The new provider settings to apply
	 * @param options.forceRebuild Force rebuilding the API handler regardless of provider/model equality
	 */
	private updateTaskApiHandlerIfNeeded(
		providerSettings: ProviderSettings,
		options: { forceRebuild?: boolean } = {},
	): void {
		const task = this.getCurrentTask()
		if (!task) return

		const { forceRebuild = false } = options

		// Determine if we need to rebuild using the previous configuration snapshot
		const prevConfig = task.apiConfiguration
		const prevProvider = prevConfig?.apiProvider
		const prevModelId = prevConfig ? getModelId(prevConfig) : undefined
		const newProvider = providerSettings.apiProvider
		const newModelId = getModelId(providerSettings)

		const needsRebuild = forceRebuild || prevProvider !== newProvider || prevModelId !== newModelId

		if (needsRebuild) {
			// Use updateApiConfiguration which handles both API handler rebuild and parser sync.
			// Note: updateApiConfiguration is declared async but has no actual async operations,
			// so we can safely call it without awaiting.
			task.updateApiConfiguration(providerSettings)
		} else {
			// No rebuild needed, just sync apiConfiguration
			;(task as any).apiConfiguration = providerSettings
		}
	}

	getProviderProfileEntries(): ProviderSettingsEntry[] {
		return this.contextProxy.getValues().listApiConfigMeta || []
	}

	getProviderProfileEntry(name: string): ProviderSettingsEntry | undefined {
		return this.getProviderProfileEntries().find((profile) => profile.name === name)
	}

	public hasProviderProfileEntry(name: string): boolean {
		return !!this.getProviderProfileEntry(name)
	}

	async upsertProviderProfile(
		name: string,
		providerSettings: ProviderSettings,
		activate: boolean = true,
	): Promise<string | undefined> {
		try {
			// TODO: Do we need to be calling `activateProfile`? It's not
			// clear to me what the source of truth should be; in some cases
			// we rely on the `ContextProxy`'s data store and in other cases
			// we rely on the `ProviderSettingsManager`'s data store. It might
			// be simpler to unify these two.
			const id = await this.providerSettingsManager.saveConfig(name, providerSettings)

			if (activate) {
				const { mode } = await this.getState()

				// These promises do the following:
				// 1. Adds or updates the list of provider profiles.
				// 2. Sets the current provider profile.
				// 3. Sets the current mode's provider profile.
				// 4. Copies the provider settings to the context.
				//
				// Note: 1, 2, and 4 can be done in one `ContextProxy` call:
				// this.contextProxy.setValues({ ...providerSettings, listApiConfigMeta: ..., currentApiConfigName: ... })
				// We should probably switch to that and verify that it works.
				// I left the original implementation in just to be safe.
				await Promise.all([
					this.updateGlobalState("listApiConfigMeta", await this.providerSettingsManager.listConfig()),
					this.updateGlobalState("currentApiConfigName", name),
					this.providerSettingsManager.setModeConfig(mode, id),
					this.contextProxy.setProviderSettings(providerSettings),
				])

				// Change the provider for the current task.
				// TODO: We should rename `buildApiHandler` for clarity (e.g. `getProviderClient`).
				this.updateTaskApiHandlerIfNeeded(providerSettings, { forceRebuild: true })

				// Keep the current task's sticky provider profile in sync with the newly-activated profile.
				await this.persistStickyProviderProfileToCurrentTask(name)
			} else {
				await this.updateGlobalState("listApiConfigMeta", await this.providerSettingsManager.listConfig())
			}

			await this.postStateToWebview()
			return id
		} catch (error) {
			this.log(
				`Error create new api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)

			vscode.window.showErrorMessage(t("common:errors.create_api_config"))
			return undefined
		}
	}

	async deleteProviderProfile(profileToDelete: ProviderSettingsEntry) {
		const globalSettings = this.contextProxy.getValues()
		let profileToActivate: string | undefined = globalSettings.currentApiConfigName

		if (profileToDelete.name === profileToActivate) {
			profileToActivate = this.getProviderProfileEntries().find(({ name }) => name !== profileToDelete.name)?.name
		}

		if (!profileToActivate) {
			throw new Error("You cannot delete the last profile")
		}

		const entries = this.getProviderProfileEntries().filter(({ name }) => name !== profileToDelete.name)

		await this.contextProxy.setValues({
			...globalSettings,
			currentApiConfigName: profileToActivate,
			listApiConfigMeta: entries,
		})

		await this.postStateToWebview()
	}

	private async persistStickyProviderProfileToCurrentTask(apiConfigName: string): Promise<void> {
		const task = this.getCurrentTask()
		if (!task) {
			return
		}

		try {
			// Update in-memory state immediately so sticky behavior works even before the task has
			// been persisted into taskHistory (it will be captured on the next save).
			task.setTaskApiConfigName(apiConfigName)

			const taskHistoryItem =
				this.taskHistoryStore.get(task.taskId) ??
				(this.getGlobalState("taskHistory") ?? []).find((item) => item.id === task.taskId)

			if (taskHistoryItem) {
				await this.updateTaskHistory({ ...taskHistoryItem, apiConfigName })
			}
		} catch (error) {
			// If persistence fails, log the error but don't fail the profile switch.
			this.log(
				`Failed to persist provider profile switch for task ${task.taskId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	async activateProviderProfile(
		args: { name: string } | { id: string },
		options?: { persistModeConfig?: boolean; persistTaskHistory?: boolean },
	) {
		const { name, id, ...providerSettings } = await this.providerSettingsManager.activateProfile(args)

		const persistModeConfig = options?.persistModeConfig ?? true
		const persistTaskHistory = options?.persistTaskHistory ?? true

		// See `upsertProviderProfile` for a description of what this is doing.
		await Promise.all([
			this.contextProxy.setValue("listApiConfigMeta", await this.providerSettingsManager.listConfig()),
			this.contextProxy.setValue("currentApiConfigName", name),
			this.contextProxy.setProviderSettings(providerSettings),
		])

		const { mode } = await this.getState()

		if (id && persistModeConfig) {
			await this.providerSettingsManager.setModeConfig(mode, id)
		}

		// Change the provider for the current task.
		this.updateTaskApiHandlerIfNeeded(providerSettings, { forceRebuild: true })

		// Update the current task's sticky provider profile, unless this activation is
		// being used purely as a non-persisting restoration (e.g., reopening a task from history).
		if (persistTaskHistory) {
			await this.persistStickyProviderProfileToCurrentTask(name)
		}

		await this.postStateToWebview()

		if (providerSettings.apiProvider) {
			this.emit(RooCodeEventName.ProviderProfileChanged, { name, provider: providerSettings.apiProvider })
		}
	}

	async updateCustomInstructions(instructions?: string) {
		// User may be clearing the field.
		await this.updateGlobalState("customInstructions", instructions || undefined)
		await this.postStateToWebview()
	}

	// MCP

	async ensureMcpServersDirectoryExists(): Promise<string> {
		// Get platform-specific application data directory
		let mcpServersDir: string
		if (process.platform === "win32") {
			// Windows: %APPDATA%\Roo-Code\MCP
			mcpServersDir = path.join(os.homedir(), "AppData", "Roaming", "Roo-Code", "MCP")
		} else if (process.platform === "darwin") {
			// macOS: ~/Documents/Cline/MCP
			mcpServersDir = path.join(os.homedir(), "Documents", "Cline", "MCP")
		} else {
			// Linux: ~/.local/share/Cline/MCP
			mcpServersDir = path.join(os.homedir(), ".local", "share", "Roo-Code", "MCP")
		}

		try {
			await fs.mkdir(mcpServersDir, { recursive: true })
		} catch (error) {
			// Fallback to a relative path if directory creation fails
			return path.join(os.homedir(), ".tocodex", "mcp")
		}
		return mcpServersDir
	}

	async ensureSettingsDirectoryExists(): Promise<string> {
		const { getSettingsDirectoryPath } = await import("../../utils/storage")
		const globalStoragePath = this.contextProxy.globalStorageUri.fsPath
		return getSettingsDirectoryPath(globalStoragePath)
	}

	// OpenRouter

	async handleOpenRouterCallback(code: string) {
		let { apiConfiguration, currentApiConfigName = "default" } = await this.getState()

		let apiKey: string

		try {
			const baseUrl = apiConfiguration.openRouterBaseUrl || "https://openrouter.ai/api/v1"
			// Extract the base domain for the auth endpoint.
			const baseUrlDomain = baseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai"
			const response = await axios.post(`${baseUrlDomain}/api/v1/auth/keys`, { code })

			if (response.data && response.data.key) {
				apiKey = response.data.key
			} else {
				throw new Error("Invalid response from OpenRouter API")
			}
		} catch (error) {
			this.log(
				`Error exchanging code for API key: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)

			throw error
		}

		const newConfiguration: ProviderSettings = {
			...apiConfiguration,
			apiProvider: "openrouter",
			openRouterApiKey: apiKey,
			openRouterModelId: apiConfiguration?.openRouterModelId || openRouterDefaultModelId,
		}

		await this.upsertProviderProfile(currentApiConfigName, newConfiguration)
	}

	// Requesty

	async handleRequestyCallback(code: string, baseUrl: string | null) {
		let { apiConfiguration } = await this.getState()

		const newConfiguration: ProviderSettings = {
			...apiConfiguration,
			apiProvider: "requesty",
			requestyApiKey: code,
			requestyModelId: apiConfiguration?.requestyModelId || requestyDefaultModelId,
		}

		// set baseUrl as undefined if we don't provide one
		// or if it is the default requesty url
		if (!baseUrl || baseUrl === REQUESTY_BASE_URL) {
			newConfiguration.requestyBaseUrl = undefined
		} else {
			newConfiguration.requestyBaseUrl = baseUrl
		}

		const profileName = `Requesty (${new Date().toLocaleString()})`
		await this.upsertProviderProfile(profileName, newConfiguration)
	}

	// 记忆提取

	/**
	 * 任务完成后异步提取关键记忆并保存。
	 * 从 clineMessages 构建对话记录，交给 MemoryManager 提取关键洞察。
	 * 以 fire-and-forget 方式调用，不阻塞主任务。
	 * Requirements: 2.1, 2.6
	 */
	private async triggerMemoryExtraction(task: Task): Promise<void> {
		try {
			const cwd = task.cwd
			if (!cwd) return

			// 从 clineMessages 构建对话文本
			const transcript = task.clineMessages
				.filter((msg) => msg.text && msg.text.trim().length > 0)
				.map((msg) => {
					const role = msg.type === "ask" ? "user" : "assistant"
					return `[${role}] ${msg.text}`
				})
				.join("\n")

			if (!transcript.trim()) return

			const globalStoragePath = this.contextProxy.globalStorageUri.fsPath

			// 构建 LLM 提取函数：使用辅助模型（便宜）同时提取项目级与全局级洞察
			// 输出格式约定：两段
			//   [PROJECT]
			//   - ...项目相关
			//   [GLOBAL]
			//   - ...用户偏好 / 跨项目通用规则
			const lightHandler = task.getLightApiHandler()
			const llmExtractor = lightHandler
				? async (text: string): Promise<{ project: string; global: string }> => {
						const truncated = text.length > 20000 ? text.slice(-20000) : text
						const prompt = `You are a memory extraction assistant. Analyze the conversation and output two sections.

[PROJECT] — insights specific to THIS project only (architecture, file paths, bugs/fixes, build commands, project conventions).
[GLOBAL] — insights useful across ALL projects of this user (durable user preferences like "use pnpm not npm", "always use Chinese in commit messages", general coding rules the user explicitly stated, cross-project habits). Only include items the user clearly expressed or that are obviously universal. If nothing global, output "(none)".

Format strictly as:
[PROJECT]
- item
- item
[GLOBAL]
- item
- item

Be concise. No preamble.

Conversation:
${truncated}`
						let raw = ""
						const stream = lightHandler.createMessage(
							"You extract key insights from conversations and split them into project-scoped vs user-global. Be concise.",
							[{ role: "user", content: prompt }],
						)
						for await (const chunk of stream) {
							if (chunk.type === "text") {
								raw += chunk.text
							}
						}
						return splitProjectAndGlobalSections(raw)
					}
				: undefined

			const projectMemory = new MemoryManager({ scope: "project", cwd })
			const globalMemory = new MemoryManager({ scope: "global", globalStoragePath })

			if (llmExtractor) {
				try {
					const { project, global } = await llmExtractor(transcript)
					if (project) {
						await projectMemory.appendMemory(project, "insight")
					}
					if (global) {
						await globalMemory.appendMemory(global, "preference")
					}
				} catch (error) {
					// LLM 失败时降级到旧路径：仅项目级关键词提取
					console.warn(
						`[ClineProvider] dual-scope extract failed, fallback to project-only: ${
							error instanceof Error ? error.message : String(error)
						}`,
					)
					await projectMemory.extractAndSave(transcript)
				}
			} else {
				// 没有轻量模型：仅做项目级关键词提取（保持旧行为）
				await projectMemory.extractAndSave(transcript)
			}
		} catch (error) {
			// 静默降级，不影响主任务 (Requirement 2.6)
			console.error(
				`[ClineProvider] triggerMemoryExtraction 失败: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	// Task history

	async getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}> {
		const historyItem =
			this.taskHistoryStore.get(id) ?? (this.getGlobalState("taskHistory") ?? []).find((item) => item.id === id)

		if (!historyItem) {
			throw new Error("Task not found")
		}

		const { getTaskDirectoryPath } = await import("../../utils/storage")
		const globalStoragePath = this.contextProxy.globalStorageUri.fsPath
		const taskDirPath = await getTaskDirectoryPath(globalStoragePath, id)
		const apiConversationHistoryFilePath = path.join(taskDirPath, GlobalFileNames.apiConversationHistory)
		const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)
		const fileExists = await fileExistsAtPath(apiConversationHistoryFilePath)

		let apiConversationHistory: Anthropic.MessageParam[] = []

		if (fileExists) {
			try {
				apiConversationHistory = JSON.parse(await fs.readFile(apiConversationHistoryFilePath, "utf8"))
			} catch (error) {
				console.warn(
					`[getTaskWithId] api_conversation_history.json corrupted for task ${id}, returning empty history: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		} else {
			console.warn(
				`[getTaskWithId] api_conversation_history.json missing for task ${id}, returning empty history`,
			)
		}

		return {
			historyItem,
			taskDirPath,
			apiConversationHistoryFilePath,
			uiMessagesFilePath,
			apiConversationHistory,
		}
	}

	async getTaskWithAggregatedCosts(taskId: string): Promise<{
		historyItem: HistoryItem
		aggregatedCosts: AggregatedCosts
	}> {
		const { historyItem } = await this.getTaskWithId(taskId)

		const aggregatedCosts = await aggregateTaskCostsRecursive(taskId, async (id: string) => {
			const result = await this.getTaskWithId(id)
			return result.historyItem
		})

		return { historyItem, aggregatedCosts }
	}

	async showTaskWithId(id: string) {
		if (id !== this.getCurrentTask()?.taskId) {
			// Non-current task.
			const { historyItem } = await this.getTaskWithId(id)
			await this.createTaskWithHistoryItem(historyItem) // Clears existing task.
		}

		await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
	}

	async exportTaskWithId(id: string) {
		const { historyItem, apiConversationHistory } = await this.getTaskWithId(id)
		const fileName = getTaskFileName(historyItem.ts)
		const defaultUri = await resolveDefaultSaveUri(this.contextProxy, "lastTaskExportPath", fileName, {
			useWorkspace: false,
			fallbackDir: path.join(os.homedir(), "Downloads"),
		})
		const saveUri = await downloadTask(historyItem.ts, apiConversationHistory, defaultUri)

		if (saveUri) {
			await saveLastExportPath(this.contextProxy, "lastTaskExportPath", saveUri)
		}
	}

	/* Condenses a task's message history to use fewer tokens. */
	async condenseTaskContext(taskId: string) {
		let task: Task | undefined
		for (let i = this.clineStack.length - 1; i >= 0; i--) {
			if (this.clineStack[i].taskId === taskId) {
				task = this.clineStack[i]
				break
			}
		}
		if (!task) {
			throw new Error(`Task with id ${taskId} not found in stack`)
		}
		await task.condenseContext()
		await this.postMessageToWebview({ type: "condenseTaskContextResponse", text: taskId })
	}

	/* Force-truncates a task's context by removing older messages via sliding window. */
	async forceTruncateTaskContext(taskId: string) {
		let task: Task | undefined
		for (let i = this.clineStack.length - 1; i >= 0; i--) {
			if (this.clineStack[i].taskId === taskId) {
				task = this.clineStack[i]
				break
			}
		}
		if (!task) {
			throw new Error(`Task with id ${taskId} not found in stack`)
		}
		await task.forceTruncateContext()
		await this.postMessageToWebview({ type: "condenseTaskContextResponse", text: taskId })
	}

	// this function deletes a task from task history, and deletes its checkpoints and delete the task folder
	// If the task has subtasks (childIds), they will also be deleted recursively
	async deleteTaskWithId(id: string, cascadeSubtasks: boolean = true) {
		try {
			// get the task directory full path and history item
			const { taskDirPath, historyItem } = await this.getTaskWithId(id)

			// Collect all task IDs to delete (parent + all subtasks)
			const allIdsToDelete: string[] = [id]

			if (cascadeSubtasks) {
				// Recursively collect all child IDs
				const collectChildIds = async (taskId: string): Promise<void> => {
					try {
						const { historyItem: item } = await this.getTaskWithId(taskId)
						if (item.childIds && item.childIds.length > 0) {
							for (const childId of item.childIds) {
								allIdsToDelete.push(childId)
								await collectChildIds(childId)
							}
						}
					} catch (error) {
						// Child task may already be deleted or not found, continue
						console.log(`[deleteTaskWithId] child task ${taskId} not found, skipping`)
					}
				}

				await collectChildIds(id)
			}

			// Remove from stack if any of the tasks to delete are in the current task stack
			for (const taskId of allIdsToDelete) {
				if (taskId === this.getCurrentTask()?.taskId) {
					// Close the current task instance; delegation flows will be handled via metadata if applicable.
					await this.removeClineFromStack()
					break
				}
			}

			// Delete all tasks from state in one batch
			await this.taskHistoryStore.deleteMany(allIdsToDelete)
			this.recentTasksCache = undefined

			// Delete associated shadow repositories or branches and task directories
			const globalStorageDir = this.contextProxy.globalStorageUri.fsPath
			const workspaceDir = this.cwd
			const { getTaskDirectoryPath } = await import("../../utils/storage")
			const globalStoragePath = this.contextProxy.globalStorageUri.fsPath

			for (const taskId of allIdsToDelete) {
				try {
					await ShadowCheckpointService.deleteTask({ taskId, globalStorageDir, workspaceDir })
				} catch (error) {
					console.error(
						`[deleteTaskWithId${taskId}] failed to delete associated shadow repository or branch: ${error instanceof Error ? error.message : String(error)}`,
					)
				}

				// Delete the task directory
				try {
					const dirPath = await getTaskDirectoryPath(globalStoragePath, taskId)
					await fs.rm(dirPath, { recursive: true, force: true })
					console.log(`[deleteTaskWithId${taskId}] removed task directory`)
				} catch (error) {
					console.error(
						`[deleteTaskWithId${taskId}] failed to remove task directory: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}

			await this.postStateToWebview()
		} catch (error) {
			// If task is not found, just remove it from state
			if (error instanceof Error && error.message === "Task not found") {
				await this.deleteTaskFromState(id)
				return
			}
			throw error
		}
	}

	async deleteTaskFromState(id: string) {
		await this.taskHistoryStore.delete(id)
		this.recentTasksCache = undefined

		await this.postStateToWebview()
	}

	async refreshWorkspace() {
		this.currentWorkspacePath = getWorkspacePath()
		await this.postStateToWebview()
	}

	async postStateToWebview() {
		try {
			const state = await this.getStateToPostToWebview()
			this.clineMessagesSeq++
			state.clineMessagesSeq = this.clineMessagesSeq
			this.postMessageToWebview({ type: "state", state })

			// Check MDM compliance and send user to account tab if not compliant
			// Only redirect if there's an actual MDM policy requiring authentication
			if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
				await this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
			}
		} catch (error) {
			console.error("[postStateToWebview] Error getting state, sending minimal state:", error)
			// 发送最小 state 以确保 webview 能完成 hydration
			this.clineMessagesSeq++
			this.postMessageToWebview({
				type: "state",
				state: {
					version: this.context.extension?.packageJSON?.version ?? "2.0.0",
					clineMessagesSeq: this.clineMessagesSeq,
					apiConfiguration: { apiProvider: "anthropic" },
					clineMessages: [],
					taskHistory: [],
					shouldShowAnnouncement: false,
				} as any,
			})
		}
	}

	/**
	 * Like postStateToWebview but intentionally omits taskHistory.
	 *
	 * Rationale:
	 * - taskHistory can be large and was being resent on every chat message update.
	 * - The webview maintains taskHistory in-memory and receives updates via
	 *   `taskHistoryUpdated` / `taskHistoryItemUpdated`.
	 */
	async postStateToWebviewWithoutTaskHistory(): Promise<void> {
		const state = await this.getStateToPostToWebview()
		this.clineMessagesSeq++
		state.clineMessagesSeq = this.clineMessagesSeq
		const { taskHistory: _omit, ...rest } = state
		this.postMessageToWebview({ type: "state", state: rest })

		// Preserve existing MDM redirect behavior
		if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
			await this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
		}
	}

	/**
	 * Like postStateToWebview but intentionally omits both clineMessages and taskHistory.
	 *
	 * Rationale:
	 * - Cloud event handlers (auth, settings, user-info) and mode changes trigger state pushes
	 *   that have nothing to do with chat messages. Including clineMessages in these pushes
	 *   creates race conditions where a stale snapshot of clineMessages (captured during async
	 *   getStateToPostToWebview) overwrites newer messages the task has streamed in the meantime.
	 * - This method ensures cloud/mode events only push the state fields they actually affect
	 *   (cloud auth, org settings, profiles, etc.) without interfering with task message streaming.
	 */
	async postStateToWebviewWithoutClineMessages(): Promise<void> {
		const state = await this.getStateToPostToWebview()
		const { clineMessages: _omitMessages, taskHistory: _omitHistory, ...rest } = state
		this.postMessageToWebview({ type: "state", state: rest })

		// Preserve existing MDM redirect behavior
		if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
			await this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
		}
	}

	/**
	 * Fetches marketplace data on demand to avoid blocking main state updates
	 */
	async fetchMarketplaceData() {
		try {
			const [marketplaceResult, marketplaceInstalledMetadata] = await Promise.all([
				this.marketplaceManager.getMarketplaceItems().catch((error) => {
					console.error("Failed to fetch marketplace items:", error)
					return { organizationMcps: [], marketplaceItems: [], errors: [error.message] }
				}),
				this.marketplaceManager.getInstallationMetadata().catch((error) => {
					console.error("Failed to fetch installation metadata:", error)
					return { project: {}, global: {} } as MarketplaceInstalledMetadata
				}),
			])

			// Send marketplace data separately
			this.postMessageToWebview({
				type: "marketplaceData",
				organizationMcps: marketplaceResult.organizationMcps || [],
				marketplaceItems: marketplaceResult.marketplaceItems || [],
				marketplaceInstalledMetadata: marketplaceInstalledMetadata || { project: {}, global: {} },
				errors: marketplaceResult.errors,
			})
		} catch (error) {
			console.error("Failed to fetch marketplace data:", error)

			// Send empty data on error to prevent UI from hanging
			this.postMessageToWebview({
				type: "marketplaceData",
				organizationMcps: [],
				marketplaceItems: [],
				marketplaceInstalledMetadata: { project: {}, global: {} },
				errors: [error instanceof Error ? error.message : String(error)],
			})

			// Show user-friendly error notification for network issues
			if (error instanceof Error && error.message.includes("timeout")) {
				vscode.window.showWarningMessage(
					"Marketplace data could not be loaded due to network restrictions. Core functionality remains available.",
				)
			}
		}
	}

	/**
	 * Merges allowed commands from global state and workspace configuration
	 * with proper validation and deduplication
	 */
	private mergeAllowedCommands(globalStateCommands?: string[]): string[] {
		return this.mergeCommandLists("allowedCommands", "allowed", globalStateCommands)
	}

	/**
	 * Merges denied commands from global state and workspace configuration
	 * with proper validation and deduplication
	 */
	private mergeDeniedCommands(globalStateCommands?: string[]): string[] {
		return this.mergeCommandLists("deniedCommands", "denied", globalStateCommands)
	}

	/**
	 * Common utility for merging command lists from global state and workspace configuration.
	 * Implements the Command Denylist feature's merging strategy with proper validation.
	 *
	 * @param configKey - VSCode workspace configuration key
	 * @param commandType - Type of commands for error logging
	 * @param globalStateCommands - Commands from global state
	 * @returns Merged and deduplicated command list
	 */
	private mergeCommandLists(
		configKey: "allowedCommands" | "deniedCommands",
		commandType: "allowed" | "denied",
		globalStateCommands?: string[],
	): string[] {
		try {
			// Validate and sanitize global state commands
			const validGlobalCommands = Array.isArray(globalStateCommands)
				? globalStateCommands.filter((cmd) => typeof cmd === "string" && cmd.trim().length > 0)
				: []

			// Get workspace configuration commands
			const workspaceCommands = vscode.workspace.getConfiguration(Package.name).get<string[]>(configKey) || []

			// Validate and sanitize workspace commands
			const validWorkspaceCommands = Array.isArray(workspaceCommands)
				? workspaceCommands.filter((cmd) => typeof cmd === "string" && cmd.trim().length > 0)
				: []

			// Combine and deduplicate commands
			// Global state takes precedence over workspace configuration
			const mergedCommands = [...new Set([...validGlobalCommands, ...validWorkspaceCommands])]

			return mergedCommands
		} catch (error) {
			console.error(`Error merging ${commandType} commands:`, error)
			// Return empty array as fallback to prevent crashes
			return []
		}
	}

	async getStateToPostToWebview(): Promise<ExtensionState> {
		// Ensure the store is initialized before reading task history
		await this.taskHistoryStore.initialized

		const {
			apiConfiguration,
			lastShownAnnouncementId,
			customInstructions,
			alwaysAllowReadOnly,
			alwaysAllowReadOnlyOutsideWorkspace,
			alwaysAllowWrite,
			alwaysAllowWriteOutsideWorkspace,
			alwaysAllowWriteProtected,
			alwaysAllowExecute,
			alwaysAllowAllCommands,
			allowedCommands,
			deniedCommands,
			alwaysAllowMcp,
			alwaysAllowModeSwitch,
			alwaysAllowSubtasks,
			allowedMaxRequests,
			allowedMaxCost,
			taskCostBudget,
			autoCondenseContext,
			autoCondenseContextPercent,
			soundEnabled,
			ttsEnabled,
			ttsSpeed,
			enableCheckpoints,
			checkpointTimeout,
			taskHistory,
			soundVolume,
			writeDelayMs,
			terminalShellIntegrationTimeout,
			terminalShellIntegrationDisabled,
			terminalCommandDelay,
			terminalPowershellCounter,
			terminalZshClearEolMark,
			terminalZshOhMy,
			terminalZshP10k,
			terminalZdotdir,
			mcpEnabled,
			currentApiConfigName,
			listApiConfigMeta,
			pinnedApiConfigs,
			mode,
			customModePrompts,
			customSupportPrompts,
			enhancementApiConfigId,
			autoApprovalEnabled,
			customModes,
			experiments,
			maxOpenTabsContext,
			maxWorkspaceFiles,
			disabledTools,
			telemetrySetting,
			showRooIgnoredFiles,
			enableSubfolderRules,
			loadRecentPlans,
			language,
			maxImageFileSize,
			maxTotalImageSize,
			historyPreviewCollapsed,
			reasoningBlockCollapsed,
			enterBehavior,
			cloudUserInfo,
			cloudIsAuthenticated,
			sharingEnabled,
			publicSharingEnabled,
			organizationAllowList,
			organizationSettingsVersion,
			customCondensingPrompt,
			codebaseIndexConfig,
			codebaseIndexModels,
			showCodebaseIndexInChat,
			profileThresholds,
			alwaysAllowFollowupQuestions,
			followupAutoApproveTimeoutMs,
			includeDiagnosticMessages,
			maxDiagnosticMessages,
			includeTaskHistoryInEnhance,
			includeCurrentTime,
			includeCurrentCost,
			maxGitStatusFiles,
			taskSyncEnabled,
			imageGenerationProvider,
			openRouterImageApiKey,
			openRouterImageGenerationSelectedModel,
			imageGenerationSize,
			customImageBaseUrl,
			customImageApiKey,
			lockApiConfigAcrossModes,
			autoGenerateTaskMemo,
		} = await this.getState()

		let cloudOrganizations: CloudOrganizationMembership[] = []

		try {
			// 此前调用已移除的 isCloudAgent；用 isAuthenticated() 兜底，未登录直接跳过组织拉取
			if (CloudService.instance.isAuthenticated()) {
				const now = Date.now()

				if (
					this.cloudOrganizationsCache !== null &&
					this.cloudOrganizationsCacheTimestamp !== null &&
					now - this.cloudOrganizationsCacheTimestamp < ClineProvider.CLOUD_ORGANIZATIONS_CACHE_DURATION_MS
				) {
					cloudOrganizations = this.cloudOrganizationsCache!
				} else {
					cloudOrganizations = await CloudService.instance.getOrganizationMemberships()
					this.cloudOrganizationsCache = cloudOrganizations
					this.cloudOrganizationsCacheTimestamp = now
				}
			}
		} catch (error) {
			// Ignore this error.
		}

		const telemetryKey = process.env.POSTHOG_API_KEY
		const machineId = vscode.env.machineId
		const mergedAllowedCommands = this.mergeAllowedCommands(allowedCommands)
		const mergedDeniedCommands = this.mergeDeniedCommands(deniedCommands)
		const cwd = this.cwd
		const currentTask = this.getCurrentTask()

		return {
			version: this.context.extension?.packageJSON?.version ?? "",
			apiConfiguration,
			customInstructions,
			alwaysAllowReadOnly: alwaysAllowReadOnly ?? false,
			alwaysAllowReadOnlyOutsideWorkspace: alwaysAllowReadOnlyOutsideWorkspace ?? false,
			alwaysAllowWrite: alwaysAllowWrite ?? false,
			alwaysAllowWriteOutsideWorkspace: alwaysAllowWriteOutsideWorkspace ?? false,
			alwaysAllowWriteProtected: alwaysAllowWriteProtected ?? false,
			alwaysAllowExecute: alwaysAllowExecute ?? false,
			alwaysAllowAllCommands: alwaysAllowAllCommands ?? false,
			alwaysAllowMcp: alwaysAllowMcp ?? false,
			alwaysAllowModeSwitch: alwaysAllowModeSwitch ?? false,
			alwaysAllowSubtasks: alwaysAllowSubtasks ?? false,
			allowedMaxRequests,
			allowedMaxCost,
			taskCostBudget,
			autoCondenseContext: autoCondenseContext ?? true,
			autoCondenseContextPercent: autoCondenseContextPercent ?? 90,
			uriScheme: vscode.env.uriScheme,
			currentTaskId: currentTask?.taskId,
			currentTaskItem: currentTask?.taskId ? this.taskHistoryStore.get(currentTask.taskId) : undefined,
			clineMessages: currentTask?.clineMessages || [],
			currentTaskTodos: currentTask?.todoList || [],
			messageQueue: currentTask?.messageQueueService?.messages,
			taskHistory: this.taskHistoryStore.getAll().filter((item: HistoryItem) => item.ts && item.task),
			soundEnabled: soundEnabled ?? true,
			ttsEnabled: ttsEnabled ?? false,
			ttsSpeed: ttsSpeed ?? 1.0,
			enableCheckpoints: enableCheckpoints ?? true,
			checkpointTimeout: checkpointTimeout ?? DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
			shouldShowAnnouncement: false,
			allowedCommands: mergedAllowedCommands,
			deniedCommands: mergedDeniedCommands,
			soundVolume: soundVolume ?? 0.5,
			writeDelayMs: writeDelayMs ?? DEFAULT_WRITE_DELAY_MS,
			terminalShellIntegrationTimeout: terminalShellIntegrationTimeout ?? Terminal.defaultShellIntegrationTimeout,
			terminalShellIntegrationDisabled: terminalShellIntegrationDisabled ?? true,
			terminalCommandDelay: terminalCommandDelay ?? 0,
			terminalPowershellCounter: terminalPowershellCounter ?? false,
			terminalZshClearEolMark: terminalZshClearEolMark ?? true,
			terminalZshOhMy: terminalZshOhMy ?? false,
			terminalZshP10k: terminalZshP10k ?? false,
			terminalZdotdir: terminalZdotdir ?? false,
			mcpEnabled: true,
			currentApiConfigName: currentApiConfigName ?? "default",
			listApiConfigMeta: listApiConfigMeta ?? [],
			pinnedApiConfigs: pinnedApiConfigs ?? {},
			mode: mode ?? defaultModeSlug,
			customModePrompts: customModePrompts ?? {},
			customSupportPrompts: customSupportPrompts ?? {},
			enhancementApiConfigId,
			autoApprovalEnabled: autoApprovalEnabled ?? false,
			customModes,
			experiments: experiments ?? experimentDefault,
			mcpServers: this.mcpHub?.getAllServers() ?? [],
			maxOpenTabsContext: maxOpenTabsContext ?? 20,
			maxWorkspaceFiles: maxWorkspaceFiles ?? 200,
			cwd,
			disabledTools,
			telemetrySetting,
			telemetryKey,
			machineId,
			showRooIgnoredFiles: showRooIgnoredFiles ?? false,
			enableSubfolderRules: enableSubfolderRules ?? false,
			loadRecentPlans: loadRecentPlans ?? true,
			autoGenerateTaskMemo: autoGenerateTaskMemo ?? true,
			language: language ?? formatLanguage(vscode.env.language),
			renderContext: this.renderContext,
			maxImageFileSize: maxImageFileSize ?? 5,
			maxTotalImageSize: maxTotalImageSize ?? 20,
			settingsImportedAt: this.settingsImportedAt,
			historyPreviewCollapsed: historyPreviewCollapsed ?? false,
			reasoningBlockCollapsed: reasoningBlockCollapsed ?? true,
			enterBehavior: enterBehavior ?? "send",
			cloudUserInfo,
			cloudIsAuthenticated: cloudIsAuthenticated ?? false,
			cloudAuthSkipModel: this.context.globalState.get<boolean>("roo-auth-skip-model") ?? false,
			cloudOrganizations,
			sharingEnabled: sharingEnabled ?? false,
			publicSharingEnabled: publicSharingEnabled ?? false,
			organizationAllowList,
			organizationSettingsVersion,
			customCondensingPrompt,
			codebaseIndexModels: codebaseIndexModels ?? EMBEDDING_MODEL_PROFILES,
			showCodebaseIndexInChat: showCodebaseIndexInChat ?? false,
			codebaseIndexConfig: {
				codebaseIndexEnabled: codebaseIndexConfig?.codebaseIndexEnabled ?? false,
				codebaseIndexQdrantUrl: codebaseIndexConfig?.codebaseIndexQdrantUrl ?? "http://localhost:6333",
				codebaseIndexEmbedderProvider: codebaseIndexConfig?.codebaseIndexEmbedderProvider ?? "openai",
				codebaseIndexEmbedderBaseUrl: codebaseIndexConfig?.codebaseIndexEmbedderBaseUrl ?? "",
				codebaseIndexEmbedderModelId: codebaseIndexConfig?.codebaseIndexEmbedderModelId ?? "",
				codebaseIndexEmbedderModelDimension: codebaseIndexConfig?.codebaseIndexEmbedderModelDimension ?? 1536,
				codebaseIndexOpenAiCompatibleBaseUrl: codebaseIndexConfig?.codebaseIndexOpenAiCompatibleBaseUrl,
				codebaseIndexSearchMaxResults: codebaseIndexConfig?.codebaseIndexSearchMaxResults,
				codebaseIndexSearchMinScore: codebaseIndexConfig?.codebaseIndexSearchMinScore,
				codebaseIndexBedrockRegion: codebaseIndexConfig?.codebaseIndexBedrockRegion,
				codebaseIndexBedrockProfile: codebaseIndexConfig?.codebaseIndexBedrockProfile,
				codebaseIndexOpenRouterSpecificProvider: codebaseIndexConfig?.codebaseIndexOpenRouterSpecificProvider,
			},
			// Only set mdmCompliant if there's an actual MDM policy
			// undefined means no MDM policy, true means compliant, false means non-compliant
			mdmCompliant: this.mdmService?.requiresCloudAuth() ? this.checkMdmCompliance() : undefined,
			profileThresholds: profileThresholds ?? {},
			cloudApiUrl: getRooCodeApiUrl(),
			hasOpenedModeSelector: this.getGlobalState("hasOpenedModeSelector") ?? false,
			lockApiConfigAcrossModes: lockApiConfigAcrossModes ?? false,
			alwaysAllowFollowupQuestions: alwaysAllowFollowupQuestions ?? false,
			followupAutoApproveTimeoutMs: followupAutoApproveTimeoutMs ?? 60000,
			includeDiagnosticMessages: includeDiagnosticMessages ?? true,
			maxDiagnosticMessages: maxDiagnosticMessages ?? 50,
			includeTaskHistoryInEnhance: includeTaskHistoryInEnhance ?? true,
			includeCurrentTime: includeCurrentTime ?? true,
			includeCurrentCost: includeCurrentCost ?? true,
			maxGitStatusFiles: maxGitStatusFiles ?? 0,
			taskSyncEnabled,
			imageGenerationProvider,
			openRouterImageApiKey,
			openRouterImageGenerationSelectedModel,
			imageGenerationSize,
			customImageBaseUrl,
			customImageApiKey,
			imageGenerationModels: await this.loadImageGenerationModels(),
			openAiCodexIsAuthenticated: await (async () => {
				try {
					const { openAiCodexOAuthManager } = await import("../../integrations/openai-codex/oauth")
					return await openAiCodexOAuthManager.isAuthenticated()
				} catch {
					return false
				}
			})(),
			debug: vscode.workspace.getConfiguration(Package.name).get<boolean>("debug", false),
			taskCostSummary: (() => {
				const task = this.getCurrentTask()
				if (!task?.costTracker) return undefined
				const summary = task.costTracker.getSummary()
				if (summary.totalCostUSD <= 0) return undefined
				return { totalCostUSD: summary.totalCostUSD, byModel: summary.byModel }
			})(),
			parallelChildren: (() => {
				const task = this.getCurrentTask()
				if (!task) return undefined
				const snapshot = task.getParallelChildrenSnapshot()
				if (snapshot.length === 0) return undefined
				return snapshot.map((c) => ({
					taskId: c.taskId,
					description: c.description,
					status: c.status,
					startedAt: c.startedAt,
					completedAt: c.completedAt,
					files: c.files,
					result: c.result,
					error: c.error,
				}))
			})(),
		}
	}

	/**
	 * 加载生图模型配置。
	 * 优先级：用户级 ~/.tocodex/image-models.json > 内置打包配置 > 硬编码默认值
	 */
	private async loadImageGenerationModels() {
		// 1. 尝试读取用户级配置 ~/.tocodex/image-models.json
		try {
			const userConfigPath = path.join(os.homedir(), ".tocodex", "image-models.json")
			const exists = await fileExistsAtPath(userConfigPath)
			if (exists) {
				const content = await fs.readFile(userConfigPath, "utf-8")
				const data = JSON.parse(content)
				const models = parseImageGenerationModels(data)
				if (models) return models
			}
		} catch {
			// 用户级配置读取失败，继续尝试内置配置
		}

		// 2. 使用编译打包的内置配置 src/config/image-models.json
		try {
			const models = parseImageGenerationModels(bundledImageModels)
			if (models) return models
		} catch {
			// 内置配置解析失败，使用硬编码默认值
		}

		// 3. 硬编码默认值兜底
		return DEFAULT_IMAGE_GENERATION_MODELS
	}

	/**
	 * Storage
	 * https://dev.to/kompotkot/how-to-use-secretstorage-in-your-vscode-extensions-2hco
	 * https://www.eliostruyf.com/devhack-code-extension-storage-options/
	 */

	async getState(): Promise<
		Omit<
			ExtensionState,
			"clineMessages" | "renderContext" | "hasOpenedModeSelector" | "version" | "shouldShowAnnouncement"
		>
	> {
		const stateValues = this.contextProxy.getValues()
		const customModes = await this.customModesManager.getCustomModes()

		// Determine apiProvider with the same logic as before, while filtering retired providers.
		const apiProvider: ProviderName =
			stateValues.apiProvider && !isRetiredProvider(stateValues.apiProvider)
				? stateValues.apiProvider
				: "anthropic"

		// Build the apiConfiguration object combining state values and secrets.
		const providerSettings = this.contextProxy.getProviderSettings()

		// Ensure apiProvider is set properly if not already in state
		if (!providerSettings.apiProvider) {
			providerSettings.apiProvider = apiProvider
		}

		let organizationAllowList = ORGANIZATION_ALLOW_ALL

		try {
			organizationAllowList = await CloudService.instance.getAllowList()
		} catch (error) {
			console.error(
				`[getState] failed to get organization allow list: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		let cloudUserInfo: CloudUserInfo | null = null

		try {
			cloudUserInfo = CloudService.instance.getUserInfo()
		} catch (error) {
			console.error(
				`[getState] failed to get cloud user info: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		let cloudIsAuthenticated: boolean = false

		try {
			cloudIsAuthenticated = CloudService.instance.isAuthenticated()
		} catch (error) {
			console.error(
				`[getState] failed to get cloud authentication state: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		let sharingEnabled: boolean = false

		try {
			sharingEnabled = await CloudService.instance.canShareTask()
		} catch (error) {
			console.error(
				`[getState] failed to get sharing enabled state: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		let publicSharingEnabled: boolean = false

		try {
			publicSharingEnabled = await CloudService.instance.canSharePublicly()
		} catch (error) {
			console.error(
				`[getState] failed to get public sharing enabled state: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		let organizationSettingsVersion: number = -1

		try {
			if (CloudService.hasInstance()) {
				const settings = CloudService.instance.getOrganizationSettings()
				organizationSettingsVersion = settings?.version ?? -1
			}
		} catch (error) {
			console.error(
				`[getState] failed to get organization settings version: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		let taskSyncEnabled: boolean = false

		try {
			taskSyncEnabled = CloudService.instance.isTaskSyncEnabled()
		} catch (error) {
			console.error(
				`[getState] failed to get task sync enabled state: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		// Return the same structure as before.
		return {
			apiConfiguration: providerSettings,
			lastShownAnnouncementId: stateValues.lastShownAnnouncementId,
			customInstructions: stateValues.customInstructions,
			apiModelId: stateValues.apiModelId,
			alwaysAllowReadOnly: stateValues.alwaysAllowReadOnly ?? false,
			alwaysAllowReadOnlyOutsideWorkspace: stateValues.alwaysAllowReadOnlyOutsideWorkspace ?? false,
			alwaysAllowWrite: stateValues.alwaysAllowWrite ?? false,
			alwaysAllowWriteOutsideWorkspace: stateValues.alwaysAllowWriteOutsideWorkspace ?? false,
			alwaysAllowWriteProtected: stateValues.alwaysAllowWriteProtected ?? false,
			alwaysAllowExecute: stateValues.alwaysAllowExecute ?? false,
			alwaysAllowAllCommands: stateValues.alwaysAllowAllCommands ?? false,
			alwaysAllowMcp: stateValues.alwaysAllowMcp ?? false,
			alwaysAllowModeSwitch: stateValues.alwaysAllowModeSwitch ?? false,
			alwaysAllowSubtasks: stateValues.alwaysAllowSubtasks ?? false,
			alwaysAllowFollowupQuestions: stateValues.alwaysAllowFollowupQuestions ?? false,
			followupAutoApproveTimeoutMs: stateValues.followupAutoApproveTimeoutMs ?? 60000,
			diagnosticsEnabled: stateValues.diagnosticsEnabled ?? true,
			allowedMaxRequests: stateValues.allowedMaxRequests,
			allowedMaxCost: stateValues.allowedMaxCost,
			taskCostBudget: stateValues.taskCostBudget,
			autoCondenseContext: stateValues.autoCondenseContext ?? true,
			autoCondenseContextPercent: stateValues.autoCondenseContextPercent ?? 90,
			taskHistory: this.taskHistoryStore.getAll(),
			allowedCommands: stateValues.allowedCommands,
			deniedCommands: stateValues.deniedCommands,
			soundEnabled: stateValues.soundEnabled ?? true,
			ttsEnabled: stateValues.ttsEnabled ?? false,
			ttsSpeed: stateValues.ttsSpeed ?? 1.0,
			enableCheckpoints: stateValues.enableCheckpoints ?? true,
			checkpointTimeout: stateValues.checkpointTimeout ?? DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
			soundVolume: stateValues.soundVolume,
			writeDelayMs: stateValues.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS,
			terminalShellIntegrationTimeout:
				stateValues.terminalShellIntegrationTimeout ?? Terminal.defaultShellIntegrationTimeout,
			terminalShellIntegrationDisabled: stateValues.terminalShellIntegrationDisabled ?? true,
			terminalCommandDelay: stateValues.terminalCommandDelay ?? 0,
			terminalPowershellCounter: stateValues.terminalPowershellCounter ?? false,
			terminalZshClearEolMark: stateValues.terminalZshClearEolMark ?? true,
			terminalZshOhMy: stateValues.terminalZshOhMy ?? false,
			terminalZshP10k: stateValues.terminalZshP10k ?? false,
			terminalZdotdir: stateValues.terminalZdotdir ?? false,
			mode: stateValues.mode ?? defaultModeSlug,
			language: stateValues.language ?? formatLanguage(vscode.env.language),
			mcpEnabled: true,
			mcpServers: this.mcpHub?.getAllServers() ?? [],
			currentApiConfigName: stateValues.currentApiConfigName ?? "default",
			listApiConfigMeta: stateValues.listApiConfigMeta ?? [],
			pinnedApiConfigs: stateValues.pinnedApiConfigs ?? {},
			modeApiConfigs: stateValues.modeApiConfigs ?? ({} as Record<Mode, string>),
			customModePrompts: stateValues.customModePrompts ?? {},
			customSupportPrompts: stateValues.customSupportPrompts ?? {},
			enhancementApiConfigId: stateValues.enhancementApiConfigId,
			experiments: stateValues.experiments ?? experimentDefault,
			autoApprovalEnabled: stateValues.autoApprovalEnabled ?? false,
			customModes,
			maxOpenTabsContext: stateValues.maxOpenTabsContext ?? 20,
			maxWorkspaceFiles: stateValues.maxWorkspaceFiles ?? 200,
			disabledTools: stateValues.disabledTools,
			telemetrySetting: stateValues.telemetrySetting || "unset",
			showRooIgnoredFiles: stateValues.showRooIgnoredFiles ?? false,
			enableSubfolderRules: stateValues.enableSubfolderRules ?? false,
			loadRecentPlans: stateValues.loadRecentPlans ?? true,
			autoGenerateTaskMemo: stateValues.autoGenerateTaskMemo ?? true,
			maxImageFileSize: stateValues.maxImageFileSize ?? 5,
			maxTotalImageSize: stateValues.maxTotalImageSize ?? 20,
			historyPreviewCollapsed: stateValues.historyPreviewCollapsed ?? false,
			reasoningBlockCollapsed: stateValues.reasoningBlockCollapsed ?? true,
			enterBehavior: stateValues.enterBehavior ?? "send",
			cloudUserInfo,
			cloudIsAuthenticated,
			sharingEnabled,
			publicSharingEnabled,
			organizationAllowList,
			organizationSettingsVersion,
			customCondensingPrompt: stateValues.customCondensingPrompt,
			codebaseIndexModels: stateValues.codebaseIndexModels ?? EMBEDDING_MODEL_PROFILES,
			showCodebaseIndexInChat: stateValues.showCodebaseIndexInChat ?? false,
			codebaseIndexConfig: {
				codebaseIndexEnabled: stateValues.codebaseIndexConfig?.codebaseIndexEnabled ?? false,
				codebaseIndexQdrantUrl:
					stateValues.codebaseIndexConfig?.codebaseIndexQdrantUrl ?? "http://localhost:6333",
				codebaseIndexEmbedderProvider:
					stateValues.codebaseIndexConfig?.codebaseIndexEmbedderProvider ?? "openai",
				codebaseIndexEmbedderBaseUrl: stateValues.codebaseIndexConfig?.codebaseIndexEmbedderBaseUrl ?? "",
				codebaseIndexEmbedderModelId: stateValues.codebaseIndexConfig?.codebaseIndexEmbedderModelId ?? "",
				codebaseIndexEmbedderModelDimension:
					stateValues.codebaseIndexConfig?.codebaseIndexEmbedderModelDimension,
				codebaseIndexOpenAiCompatibleBaseUrl:
					stateValues.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleBaseUrl,
				codebaseIndexSearchMaxResults: stateValues.codebaseIndexConfig?.codebaseIndexSearchMaxResults,
				codebaseIndexSearchMinScore: stateValues.codebaseIndexConfig?.codebaseIndexSearchMinScore,
				codebaseIndexBedrockRegion: stateValues.codebaseIndexConfig?.codebaseIndexBedrockRegion,
				codebaseIndexBedrockProfile: stateValues.codebaseIndexConfig?.codebaseIndexBedrockProfile,
				codebaseIndexOpenRouterSpecificProvider:
					stateValues.codebaseIndexConfig?.codebaseIndexOpenRouterSpecificProvider,
			},
			profileThresholds: stateValues.profileThresholds ?? {},
			lockApiConfigAcrossModes: this.context.workspaceState.get("lockApiConfigAcrossModes", false),
			includeDiagnosticMessages: stateValues.includeDiagnosticMessages ?? true,
			maxDiagnosticMessages: stateValues.maxDiagnosticMessages ?? 50,
			includeTaskHistoryInEnhance: stateValues.includeTaskHistoryInEnhance ?? true,
			includeCurrentTime: stateValues.includeCurrentTime ?? true,
			includeCurrentCost: stateValues.includeCurrentCost ?? true,
			maxGitStatusFiles: stateValues.maxGitStatusFiles ?? 0,
			taskSyncEnabled,
			imageGenerationProvider: stateValues.imageGenerationProvider,
			openRouterImageApiKey: stateValues.openRouterImageApiKey,
			openRouterImageGenerationSelectedModel: stateValues.openRouterImageGenerationSelectedModel,
			imageGenerationSize: stateValues.imageGenerationSize,
			imageGenerationModels: stateValues.imageGenerationModels,
			// 自定义生图 provider 的 base URL 与 API Key（API Key 来自 secret 存储）
			customImageBaseUrl: stateValues.customImageBaseUrl,
			customImageApiKey: stateValues.customImageApiKey,
		}
	}

	/**
	 * Updates a task in the task history and optionally broadcasts the updated history to the webview.
	 * Now delegates to TaskHistoryStore for per-task file persistence.
	 *
	 * @param item The history item to update or add
	 * @param options.broadcast Whether to broadcast the updated history to the webview (default: true)
	 * @returns The updated task history array
	 */
	async updateTaskHistory(item: HistoryItem, options: { broadcast?: boolean } = {}): Promise<HistoryItem[]> {
		const { broadcast = true } = options

		const history = await this.taskHistoryStore.upsert(item)
		this.recentTasksCache = undefined

		// Broadcast the updated history to the webview if requested.
		// Prefer per-item updates to avoid repeatedly cloning/sending the full history.
		if (broadcast && this.isViewLaunched) {
			const updatedItem = this.taskHistoryStore.get(item.id) ?? item
			await this.postMessageToWebview({ type: "taskHistoryItemUpdated", taskHistoryItem: updatedItem })
		}

		return history
	}

	/**
	 * Schedule a debounced write-through of task history to globalState.
	 * Only used for backward compatibility during the transition period.
	 * Per-task files are authoritative; globalState is the downgrade fallback.
	 */
	private scheduleGlobalStateWriteThrough(): void {
		if (this.globalStateWriteThroughTimer) {
			clearTimeout(this.globalStateWriteThroughTimer)
		}

		this.globalStateWriteThroughTimer = setTimeout(async () => {
			this.globalStateWriteThroughTimer = null
			try {
				const items = this.taskHistoryStore.getAll()
				await this.updateGlobalState("taskHistory", items)
			} catch (err) {
				this.log(
					`[scheduleGlobalStateWriteThrough] Failed: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}, ClineProvider.GLOBAL_STATE_WRITE_THROUGH_DEBOUNCE_MS)
	}

	/**
	 * Flush any pending debounced globalState write-through immediately.
	 */
	private flushGlobalStateWriteThrough(): void {
		if (this.globalStateWriteThroughTimer) {
			clearTimeout(this.globalStateWriteThroughTimer)
			this.globalStateWriteThroughTimer = null
		}

		const items = this.taskHistoryStore.getAll()
		this.updateGlobalState("taskHistory", items).catch((err) => {
			this.log(`[flushGlobalStateWriteThrough] Failed: ${err instanceof Error ? err.message : String(err)}`)
		})
	}

	/**
	 * Broadcasts a task history update to the webview.
	 * This sends a lightweight message with just the task history, rather than the full state.
	 * @param history The task history to broadcast (if not provided, reads from the store)
	 */
	public async broadcastTaskHistoryUpdate(history?: HistoryItem[]): Promise<void> {
		if (!this.isViewLaunched) {
			return
		}

		const taskHistory = history ?? this.taskHistoryStore.getAll()

		// Sort and filter the history the same way as getStateToPostToWebview
		const sortedHistory = taskHistory
			.filter((item: HistoryItem) => item.ts && item.task)
			.sort((a: HistoryItem, b: HistoryItem) => b.ts - a.ts)

		await this.postMessageToWebview({
			type: "taskHistoryUpdated",
			taskHistory: sortedHistory,
		})
	}

	// ContextProxy

	// @deprecated - Use `ContextProxy#setValue` instead.
	private async updateGlobalState<K extends keyof GlobalState>(key: K, value: GlobalState[K]) {
		await this.contextProxy.setValue(key, value)
	}

	// @deprecated - Use `ContextProxy#getValue` instead.
	private getGlobalState<K extends keyof GlobalState>(key: K) {
		return this.contextProxy.getValue(key)
	}

	public async setValue<K extends keyof RooCodeSettings>(key: K, value: RooCodeSettings[K]) {
		await this.contextProxy.setValue(key, value)
	}

	public getValue<K extends keyof RooCodeSettings>(key: K) {
		return this.contextProxy.getValue(key)
	}

	public getValues() {
		return this.contextProxy.getValues()
	}

	public async setValues(values: RooCodeSettings) {
		await this.contextProxy.setValues(values)
	}

	// dev

	async resetState() {
		const answer = await vscode.window.showInformationMessage(
			t("common:confirmation.reset_state"),
			{ modal: true },
			t("common:answers.yes"),
		)

		if (answer !== t("common:answers.yes")) {
			return
		}

		// Log out from cloud if authenticated
		if (CloudService.hasInstance()) {
			try {
				await CloudService.instance.logout()
			} catch (error) {
				this.log(
					`Failed to logout from cloud during reset: ${error instanceof Error ? error.message : String(error)}`,
				)
				// Continue with reset even if logout fails
			}
		}

		await this.contextProxy.resetAllState()
		await this.providerSettingsManager.resetAllConfigs()
		await this.customModesManager.resetCustomModes()
		await this.removeClineFromStack()
		await this.postStateToWebview()
		await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
	}

	// logging

	public log(message: string) {
		this.outputChannel.appendLine(message)
		console.log(message)
	}

	// getters

	public get workspaceTracker(): WorkspaceTracker | undefined {
		return this._workspaceTracker
	}

	get viewLaunched() {
		return this.isViewLaunched
	}

	get messages() {
		return this.getCurrentTask()?.clineMessages || []
	}

	public getMcpHub(): McpHub | undefined {
		return this.mcpHub
	}

	public getSkillsManager(): SkillsManager | undefined {
		return this.skillsManager
	}

	// ─── Scheduled Tasks accessors (used by ScheduledTaskTools) ───────────

	public getScheduledTaskStore() {
		return this.scheduledTaskStore
	}

	public getScheduledTaskScheduler() {
		return this.scheduledTaskScheduler
	}

	public getScheduledTaskExecutor() {
		return this.scheduledTaskExecutor
	}

	/**
	 * 初始化定时任务子系统：Store + Scheduler + Executor
	 * 由 extension.ts activate 调用一次。
	 */
	// ─── Diagnostic: webview heartbeat watchdog ────────────────────────────
	// 配合 App.tsx 的 5s 心跳，每 10s 检查一次：若 > 15s 没收到心跳，认定 webview 主线程
	// 卡死（典型表现是中途白屏）。日志会带最后心跳到现在的间隔、postMessage 统计，
	// 帮我们在白屏发生时直接定位是 IPC 拥塞还是 webview 自身死循环。
	private webviewHeartbeatWatchdog?: ReturnType<typeof setInterval>
	public startWebviewHeartbeatWatchdog(): void {
		if (this.webviewHeartbeatWatchdog) return
		this.webviewHeartbeatWatchdog = setInterval(() => {
			const last = (this as any)._lastWebviewHeartbeatAt as number | undefined
			if (!last) return // 还没收到首次心跳，不报警
			const elapsed = Date.now() - last
			if (elapsed > 15_000) {
				this.log(
					`[heartbeat] STALL webview no heartbeat for ${(elapsed / 1000).toFixed(1)}s ` +
						`beats=${(this as any)._lastWebviewHeartbeatBeats} ` +
						`postMessage.total=${this.postMessageStats.total} ` +
						`postMessage.oversize=${this.postMessageStats.oversize} ` +
						`postMessage.slow=${this.postMessageStats.slow}`,
				)
			}
		}, 10_000)
	}
	public stopWebviewHeartbeatWatchdog(): void {
		if (this.webviewHeartbeatWatchdog) {
			clearInterval(this.webviewHeartbeatWatchdog)
			this.webviewHeartbeatWatchdog = undefined
		}
	}

	public async initializeScheduledTasks(): Promise<void> {
		if (this.scheduledTaskStore) return // 防止重复初始化
		try {
			const { ScheduledTaskStore, ScheduledTaskScheduler, ScheduledTaskExecutor } = await import(
				"../../services/scheduled-tasks"
			)

			const store = new ScheduledTaskStore({
				getWorkspacePath: () => this.cwd,
				context: this.context,
				log: (msg) => this.log(msg),
			})
			await store.load()

			const scheduler = new ScheduledTaskScheduler({
				store,
				log: (msg) => this.log(msg),
			})

			const executor = new ScheduledTaskExecutor({
				store,
				scheduler,
				getProvider: () => this.makeSchedulerProviderAdapter(),
				log: (msg) => this.log(msg),
			})

			this.scheduledTaskStore = store
			this.scheduledTaskScheduler = scheduler
			this.scheduledTaskExecutor = executor

			// Auto-broadcast store changes to webview so the settings panel stays in sync
			// when scheduled tasks are created/updated/deleted by tools or scheduler runtime.
			let broadcastTimer: NodeJS.Timeout | undefined
			const scheduleBroadcast = () => {
				if (broadcastTimer) return
				broadcastTimer = setTimeout(() => {
					broadcastTimer = undefined
					try {
						this.postMessageToWebview({
							type: "scheduledTasksLoaded",
							payload: store.getAll() as any,
						})
					} catch (err) {
						this.log(
							`[ClineProvider] Failed to broadcast scheduled tasks: ${err instanceof Error ? err.message : String(err)}`,
						)
					}
				}, 100)
			}
			store.on("change", scheduleBroadcast)

			scheduler.start()
			executor.start()

			this.log(`[ClineProvider] Scheduled tasks subsystem initialized (${store.getAll().length} task(s))`)
		} catch (error) {
			this.log(
				`[ClineProvider] Failed to initialize scheduled tasks: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * 给 Executor 用的 ClineProvider 适配器（避免类型循环引用）。
	 */
	private makeSchedulerProviderAdapter() {
		const self = this
		return {
			handleModeSwitch: (mode: string) => self.handleModeSwitch(mode as any),
			cancelTask: () => self.cancelTask(),
			log: (msg: string) => self.log(msg),
			createTask: async (
				text: string,
				images: string[] | undefined,
				_parentTask: undefined,
				_options: Record<string, unknown>,
				configuration: Record<string, unknown>,
			) => {
				// Mark as background task to avoid interrupting user's current task
				const task = await self.createTask(
					text,
					images,
					undefined,
					{ isBackgroundTask: true },
					configuration as RooCodeSettings,
				)
				return {
					taskId: task.taskId,
					on: (event: string, listener: (...args: any[]) => void) => {
						;(task as any).on(event, listener)
					},
					off: (event: string, listener: (...args: any[]) => void) => {
						;(task as any).off?.(event, listener)
					},
				}
			},
		}
	}

	private disposeScheduledTasks(): void {
		try {
			this.scheduledTaskExecutor?.stop()
			this.scheduledTaskScheduler?.stop()
		} catch {
			// best-effort
		}
		this.scheduledTaskExecutor = undefined
		this.scheduledTaskScheduler = undefined
		this.scheduledTaskStore = undefined
	}

	/**
	 * Check if the current state is compliant with MDM policy
	 * @returns true if compliant or no MDM policy exists, false if MDM policy exists and user is non-compliant
	 */
	public checkMdmCompliance(): boolean {
		if (!this.mdmService) {
			return true // No MDM service, allow operation
		}

		const compliance = this.mdmService.isCompliant()

		if (!compliance.compliant) {
			return false
		}

		return true
	}

	/**
	 * Gets the CodeIndexManager for the current active workspace
	 * @returns CodeIndexManager instance for the current workspace or the default one
	 */
	public getCurrentWorkspaceCodeIndexManager(): CodeIndexManager | undefined {
		return CodeIndexManager.getInstance(this.context)
	}

	/**
	 * Updates the code index status subscription to listen to the current workspace manager
	 */
	private updateCodeIndexStatusSubscription(): void {
		// Get the current workspace manager
		const currentManager = this.getCurrentWorkspaceCodeIndexManager()

		// If the manager hasn't changed, no need to update subscription
		if (currentManager === this.codeIndexManager) {
			return
		}

		// Dispose the old subscription if it exists
		if (this.codeIndexStatusSubscription) {
			this.codeIndexStatusSubscription.dispose()
			this.codeIndexStatusSubscription = undefined
		}

		// Update the current workspace manager reference
		this.codeIndexManager = currentManager

		// Subscribe to the new manager's progress updates if it exists
		if (currentManager) {
			this.codeIndexStatusSubscription = currentManager.onProgressUpdate((update: IndexProgressUpdate) => {
				// Only send updates if this manager is still the current one
				if (currentManager === this.getCurrentWorkspaceCodeIndexManager()) {
					// Get the full status from the manager to ensure we have all fields correctly formatted
					const fullStatus = currentManager.getCurrentStatus()
					this.postMessageToWebview({
						type: "indexingStatusUpdate",
						values: fullStatus,
					})
				}
			})

			if (this.view) {
				this.webviewDisposables.push(this.codeIndexStatusSubscription)
			}

			// Send initial status for the current workspace
			this.postMessageToWebview({
				type: "indexingStatusUpdate",
				values: currentManager.getCurrentStatus(),
			})
		}
	}

	/**
	 * TaskProviderLike, TelemetryPropertiesProvider
	 */

	public getCurrentTask(): Task | undefined {
		if (this.clineStack.length === 0) {
			return undefined
		}

		return this.clineStack[this.clineStack.length - 1]
	}

	public getRecentTasks(): string[] {
		if (this.recentTasksCache) {
			return this.recentTasksCache
		}

		const history = this.taskHistoryStore.getAll()
		const workspaceTasks: HistoryItem[] = []

		for (const item of history) {
			if (!item.ts || !item.task || item.workspace !== this.cwd) {
				continue
			}

			workspaceTasks.push(item)
		}

		if (workspaceTasks.length === 0) {
			this.recentTasksCache = []
			return this.recentTasksCache
		}

		workspaceTasks.sort((a, b) => b.ts - a.ts)
		let recentTaskIds: string[] = []

		if (workspaceTasks.length >= 100) {
			// If we have at least 100 tasks, return tasks from the last 7 days.
			const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

			for (const item of workspaceTasks) {
				// Stop when we hit tasks older than 7 days.
				if (item.ts < sevenDaysAgo) {
					break
				}

				recentTaskIds.push(item.id)
			}
		} else {
			// Otherwise, return the most recent 100 tasks (or all if less than 100).
			recentTaskIds = workspaceTasks.slice(0, Math.min(100, workspaceTasks.length)).map((item) => item.id)
		}

		this.recentTasksCache = recentTaskIds
		return this.recentTasksCache
	}

	// When initializing a new task, (not from history but from a tool command
	// new_task) there is no need to remove the previous task since the new
	// task is a subtask of the previous one, and when it finishes it is removed
	// from the stack and the caller is resumed in this way we can have a chain
	// of tasks, each one being a sub task of the previous one until the main
	// task is finished.
	public async createTask(
		text?: string,
		images?: string[],
		parentTask?: Task,
		options: CreateTaskOptions = {},
		configuration: RooCodeSettings = {},
	): Promise<Task> {
		if (configuration) {
			await this.setValues(configuration)

			if (configuration.allowedCommands) {
				await vscode.workspace
					.getConfiguration(Package.name)
					.update("allowedCommands", configuration.allowedCommands, vscode.ConfigurationTarget.Global)
			}

			if (configuration.deniedCommands) {
				await vscode.workspace
					.getConfiguration(Package.name)
					.update("deniedCommands", configuration.deniedCommands, vscode.ConfigurationTarget.Global)
			}

			if (configuration.commandExecutionTimeout !== undefined) {
				await vscode.workspace
					.getConfiguration(Package.name)
					.update(
						"commandExecutionTimeout",
						configuration.commandExecutionTimeout,
						vscode.ConfigurationTarget.Global,
					)
			}

			if (configuration.currentApiConfigName) {
				await this.setProviderProfile(configuration.currentApiConfigName)
			}

			// Register custom modes so the CustomModesManager knows about them.
			// setValues writes to global state, but the manager overwrites that
			// when it merges .roomodes + global settings on refresh.  Persisting
			// via updateCustomMode ensures modes survive the merge cycle.
			if (configuration.customModes?.length) {
				for (const mode of configuration.customModes) {
					await this.customModesManager.updateCustomMode(mode.slug, mode)
				}
			}
		}

		const { apiConfiguration, organizationAllowList, enableCheckpoints, checkpointTimeout, experiments } =
			await this.getState()

		// 当前处于 ssh-server / browser-worker 模式时，自动启用 MCP 并刷新连接
		const currentMode = this.getGlobalState("mode")
		if (currentMode === "ssh-server") {
			const state = await this.getState()
			if (!state.mcpEnabled) {
				await this.updateGlobalState("mcpEnabled", true)
			}
			await this.ensureSshServerMcpConfig()
			await this.getMcpHub()?.refreshAllConnections()
		}

		// browser-worker 模式：确保 playwright MCP 连接就绪（上一个任务结束后进程可能已退出）
		if (currentMode === "browser-worker") {
			const state = await this.getState()
			if (!state.mcpEnabled) {
				await this.updateGlobalState("mcpEnabled", true)
			}
			await this.ensureBrowserWorkerMcpConfig()
			// 检查 playwright 连接状态，如果已断开则重启
			const mcpHub = this.getMcpHub()
			if (mcpHub) {
				const allServers = mcpHub.getAllServers()
				const playwrightServer = allServers.find((s) => s.name === "playwright")
				if (playwrightServer && playwrightServer.status !== "connected") {
					this.log(`[createTask] playwright MCP 状态: ${playwrightServer.status}，正在重启连接...`)
					await mcpHub.restartConnection("playwright", playwrightServer.source)
				} else if (!playwrightServer) {
					// playwright server 不存在于连接列表中，刷新所有连接以加载它
					this.log(`[createTask] playwright MCP 未找到，刷新所有连接...`)
					await mcpHub.refreshAllConnections()
				}
			}
		}

		// Single-open-task invariant: always enforce for user-initiated top-level tasks.
		// Background tasks (e.g., scheduled tasks) skip this to avoid interrupting user interaction.
		if (!parentTask && !options.isBackgroundTask) {
			try {
				await this.removeClineFromStack()
			} catch {
				// Non-fatal
			}
		}

		if (!ProfileValidator.isProfileAllowed(apiConfiguration, organizationAllowList)) {
			throw new OrganizationAllowListViolationError(t("common:errors.violated_organization_allowlist"))
		}

		const task = new Task({
			provider: this,
			apiConfiguration,
			enableCheckpoints,
			checkpointTimeout,
			consecutiveMistakeLimit: apiConfiguration.consecutiveMistakeLimit,
			task: text,
			images,
			experiments,
			rootTask: this.clineStack.length > 0 ? this.clineStack[0] : undefined,
			parentTask,
			taskNumber: this.clineStack.length + 1,
			onCreated: this.taskCreationCallback,
			initialTodos: options.initialTodos,
			// Ensure this task is present in clineStack before startTask() emits
			// its initial state update, so state.currentTaskId is available ASAP.
			startTask: false,
			...options,
		})

		await this.addClineToStack(task)

		task.start()

		this.log(
			`[createTask] ${task.parentTask ? "child" : "parent"} task ${task.taskId}.${task.instanceId} instantiated`,
		)

		return task
	}

	public async cancelTask(): Promise<void> {
		const task = this.getCurrentTask()

		if (!task) {
			return
		}

		console.log(`[cancelTask] cancelling task ${task.taskId}.${task.instanceId}`)

		let historyItem: HistoryItem | undefined
		try {
			const history = await this.getTaskWithId(task.taskId)
			historyItem = history.historyItem
		} catch (error) {
			// During task startup there is a short window where currentTask exists
			// but task history has not been persisted yet. Cancelling should still
			// abort safely; we just skip post-cancel rehydration in that case.
			if (error instanceof Error && error.message === "Task not found") {
				this.log(`[cancelTask] task history missing for ${task.taskId}; skipping rehydrate`)
			} else {
				throw error
			}
		}

		// Preserve parent and root task information for history item.
		const rootTask = task.rootTask
		const parentTask = task.parentTask

		// Mark this as a user-initiated cancellation so provider-only rehydration can occur
		task.abortReason = "user_cancelled"

		// Capture the current instance to detect if rehydrate already occurred elsewhere
		const originalInstanceId = task.instanceId

		// Immediately cancel the underlying HTTP request if one is in progress
		// This ensures the stream fails quickly rather than waiting for network timeout
		task.cancelCurrentRequest()

		// Begin abort (non-blocking)
		task.abortTask()

		// Immediately mark the original instance as abandoned to prevent any residual activity
		task.abandoned = true

		await pWaitFor(
			() =>
				this.getCurrentTask()! === undefined ||
				this.getCurrentTask()!.isStreaming === false ||
				this.getCurrentTask()!.didFinishAbortingStream ||
				// If only the first chunk is processed, then there's no
				// need to wait for graceful abort (closes edits, browser,
				// etc).
				this.getCurrentTask()!.isWaitingForFirstChunk,
			{
				timeout: 3_000,
			},
		).catch(() => {
			console.error("Failed to abort task")
		})

		// Defensive safeguard: if current instance already changed, skip rehydrate
		const current = this.getCurrentTask()
		if (current && current.instanceId !== originalInstanceId) {
			this.log(
				`[cancelTask] Skipping rehydrate: current instance ${current.instanceId} != original ${originalInstanceId}`,
			)
			return
		}

		// Final race check before rehydrate to avoid duplicate rehydration
		{
			const currentAfterCheck = this.getCurrentTask()
			if (currentAfterCheck && currentAfterCheck.instanceId !== originalInstanceId) {
				this.log(
					`[cancelTask] Skipping rehydrate after final check: current instance ${currentAfterCheck.instanceId} != original ${originalInstanceId}`,
				)
				return
			}
		}

		if (!historyItem) {
			return
		}

		// Clears task again, so we need to abortTask manually above.
		await this.createTaskWithHistoryItem({ ...historyItem, rootTask, parentTask })
	}

	// Clear the current task without treating it as a subtask.
	// This is used when the user cancels a task that is not a subtask.
	public async clearTask(): Promise<void> {
		if (this.clineStack.length > 0) {
			const task = this.clineStack[this.clineStack.length - 1]
			console.log(`[clearTask] clearing task ${task.taskId}.${task.instanceId}`)
			await this.removeClineFromStack()
		}
	}

	public resumeTask(taskId: string): void {
		// Use the existing showTaskWithId method which handles both current and
		// historical tasks.
		this.showTaskWithId(taskId).catch((error) => {
			this.log(`Failed to resume task ${taskId}: ${error.message}`)
		})
	}

	// Modes

	public async getModes(): Promise<{ slug: string; name: string }[]> {
		try {
			const customModes = await this.customModesManager.getCustomModes()
			return [...DEFAULT_MODES, ...customModes].map(({ slug, name }) => ({ slug, name }))
		} catch (error) {
			return DEFAULT_MODES.map(({ slug, name }) => ({ slug, name }))
		}
	}

	public async getMode(): Promise<string> {
		const { mode } = await this.getState()
		return mode
	}

	public async setMode(mode: string): Promise<void> {
		await this.setValues({ mode })
	}

	// Provider Profiles

	public async getProviderProfiles(): Promise<{ name: string; provider?: string }[]> {
		const { listApiConfigMeta = [] } = await this.getState()
		return listApiConfigMeta.map((profile) => ({ name: profile.name, provider: profile.apiProvider }))
	}

	public async getProviderProfile(): Promise<string> {
		const { currentApiConfigName = "default" } = await this.getState()
		return currentApiConfigName
	}

	public async setProviderProfile(name: string): Promise<void> {
		await this.activateProviderProfile({ name })
	}

	// Telemetry

	private _appProperties?: StaticAppProperties
	private _gitProperties?: GitProperties

	private getAppProperties(): StaticAppProperties {
		if (!this._appProperties) {
			const packageJSON = this.context.extension?.packageJSON

			this._appProperties = {
				appName: packageJSON?.name ?? Package.name,
				appVersion: packageJSON?.version ?? Package.version,
				vscodeVersion: vscode.version,
				platform: process.platform,
				editorName: vscode.env.appName,
			}
		}

		return this._appProperties
	}

	public get appProperties(): StaticAppProperties {
		return this._appProperties ?? this.getAppProperties()
	}

	private getCloudProperties(): CloudAppProperties {
		let cloudIsAuthenticated: boolean | undefined

		try {
			if (CloudService.hasInstance()) {
				cloudIsAuthenticated = CloudService.instance.isAuthenticated()
			}
		} catch (error) {
			// Silently handle errors to avoid breaking telemetry collection.
			this.log(`[getTelemetryProperties] Failed to get cloud auth state: ${error}`)
		}

		return {
			cloudIsAuthenticated,
		}
	}

	private async getTaskProperties(): Promise<DynamicAppProperties & TaskProperties> {
		const { language = "en", mode, apiConfiguration } = await this.getState()

		const task = this.getCurrentTask()
		const todoList = task?.todoList
		let todos: { total: number; completed: number; inProgress: number; pending: number } | undefined

		if (todoList && todoList.length > 0) {
			todos = {
				total: todoList.length,
				completed: todoList.filter((todo) => todo.status === "completed").length,
				inProgress: todoList.filter((todo) => todo.status === "in_progress").length,
				pending: todoList.filter((todo) => todo.status === "pending").length,
			}
		}

		const apiProvider = apiConfiguration?.apiProvider

		return {
			language,
			mode,
			taskId: task?.taskId,
			parentTaskId: task?.parentTaskId,
			apiProvider: apiProvider && !isRetiredProvider(apiProvider) ? apiProvider : undefined,
			modelId: task?.api?.getModel().id,
			diffStrategy: task?.diffStrategy?.getName(),
			isSubtask: task ? !!task.parentTaskId : undefined,
			...(todos && { todos }),
		}
	}

	private async getGitProperties(): Promise<GitProperties> {
		if (!this._gitProperties) {
			this._gitProperties = await getWorkspaceGitInfo()
		}

		return this._gitProperties
	}

	public get gitProperties(): GitProperties | undefined {
		return this._gitProperties
	}

	public async getTelemetryProperties(): Promise<TelemetryProperties> {
		return {
			...this.getAppProperties(),
			...this.getCloudProperties(),
			...(await this.getTaskProperties()),
			...(await this.getGitProperties()),
		}
	}

	public get cwd() {
		return this.currentWorkspacePath || getWorkspacePath()
	}

	/**
	 * Delegate parent task and open child task.
	 *
	 * - Enforce single-open invariant
	 * - Persist parent delegation metadata
	 * - Emit TaskDelegated (task-level; API forwards to provider/bridge)
	 * - Create child as sole active and switch mode to child's mode
	 */
	public async delegateParentAndOpenChild(params: {
		parentTaskId: string
		message: string
		initialTodos: TodoItem[]
		mode: string
	}): Promise<Task> {
		const { parentTaskId, message, initialTodos, mode } = params

		// Metadata-driven delegation is always enabled

		// 1) Get parent (must be current task)
		const parent = this.getCurrentTask()
		if (!parent) {
			throw new Error("[delegateParentAndOpenChild] No current task")
		}
		if (parent.taskId !== parentTaskId) {
			throw new Error(
				`[delegateParentAndOpenChild] Parent mismatch: expected ${parentTaskId}, current ${parent.taskId}`,
			)
		}
		// 2) Flush pending tool results to API history BEFORE disposing the parent.
		//    This is critical: when tools are called before new_task,
		//    their tool_result blocks are in userMessageContent but not yet saved to API history.
		//    If we don't flush them, the parent's API conversation will be incomplete and
		//    cause 400 errors when resumed (missing tool_result for tool_use blocks).
		//
		//    NOTE: We do NOT pass the assistant message here because the assistant message
		//    is already added to apiConversationHistory by the normal flow in
		//    recursivelyMakeClineRequests BEFORE tools start executing. We only need to
		//    flush the pending user message with tool_results.
		try {
			const flushSuccess = await parent.flushPendingToolResultsToHistory()

			if (!flushSuccess) {
				console.warn(`[delegateParentAndOpenChild] Flush failed for parent ${parentTaskId}, retrying...`)
				const retrySuccess = await parent.retrySaveApiConversationHistory()

				if (!retrySuccess) {
					console.error(
						`[delegateParentAndOpenChild] CRITICAL: Parent ${parentTaskId} API history not persisted to disk. Child return may produce stale state.`,
					)
					vscode.window.showWarningMessage(
						"Warning: Parent task state could not be saved. The parent task may lose recent context when resumed.",
					)
				}
			}
		} catch (error) {
			this.log(
				`[delegateParentAndOpenChild] Error flushing pending tool results (non-fatal): ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}

		// 3) Enforce single-open invariant by closing/disposing the parent first
		//    This ensures we never have >1 tasks open at any time during delegation.
		//    Await abort completion to ensure clean disposal and prevent unhandled rejections.
		try {
			await this.removeClineFromStack({ skipDelegationRepair: true })
		} catch (error) {
			this.log(
				`[delegateParentAndOpenChild] Error during parent disposal (non-fatal): ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
			// Non-fatal: proceed with child creation even if parent cleanup had issues
		}

		// 3) Switch provider mode to child's requested mode BEFORE creating the child task
		//    This ensures the child's system prompt and configuration are based on the correct mode.
		//    The mode switch must happen before createTask() because the Task constructor
		//    initializes its mode from provider.getState() during initializeTaskMode().
		try {
			await this.handleModeSwitch(mode as any)
		} catch (e) {
			this.log(
				`[delegateParentAndOpenChild] handleModeSwitch failed for mode '${mode}': ${
					(e as Error)?.message ?? String(e)
				}`,
			)
		}

		// 4) Create child as sole active (parent reference preserved for lineage)
		// Pass initialStatus: "active" to ensure the child task's historyItem is created
		// with status from the start, avoiding race conditions where the task might
		// call attempt_completion before status is persisted separately.
		//
		// Pass startTask: false to prevent the child from beginning its task loop
		// (and writing to globalState via saveClineMessages → updateTaskHistory)
		// before we persist the parent's delegation metadata in step 5.
		// Without this, the child's fire-and-forget startTask() races with step 5,
		// and the last writer to globalState overwrites the other's changes—
		// causing the parent's delegation fields to be lost.
		const child = await this.createTask(message, undefined, parent as any, {
			initialTodos,
			initialStatus: "active",
			startTask: false,
		})

		// 5) Persist parent delegation metadata BEFORE the child starts writing.
		try {
			const { historyItem } = await this.getTaskWithId(parentTaskId)
			const childIds = Array.from(new Set([...(historyItem.childIds ?? []), child.taskId]))
			const updatedHistory: typeof historyItem = {
				...historyItem,
				status: "delegated",
				delegatedToId: child.taskId,
				awaitingChildId: child.taskId,
				childIds,
			}
			await this.updateTaskHistory(updatedHistory)
		} catch (err) {
			this.log(
				`[delegateParentAndOpenChild] Failed to persist parent metadata for ${parentTaskId} -> ${child.taskId}: ${
					(err as Error)?.message ?? String(err)
				}`,
			)
		}

		// 6) Start the child task now that parent metadata is safely persisted.
		child.start()

		// 7) Emit TaskDelegated (provider-level)
		try {
			this.emit(RooCodeEventName.TaskDelegated, parentTaskId, child.taskId)
		} catch (error) {
			this.log(
				`[delegateTask] emit TaskDelegated failed: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		return child
	}

	/**
	 * Reopen parent task from delegation with write-back and events.
	 */
	public async reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<void> {
		const { parentTaskId, childTaskId, completionResultSummary } = params
		const globalStoragePath = this.contextProxy.globalStorageUri.fsPath

		// 1) Load parent from history and current persisted messages
		const { historyItem } = await this.getTaskWithId(parentTaskId)

		let parentClineMessages: ClineMessage[] = []
		try {
			parentClineMessages = await readTaskMessages({
				taskId: parentTaskId,
				globalStoragePath,
			})
		} catch {
			parentClineMessages = []
		}

		let parentApiMessages: any[] = []
		try {
			parentApiMessages = (await readApiMessages({
				taskId: parentTaskId,
				globalStoragePath,
			})) as any[]
		} catch {
			parentApiMessages = []
		}

		// 2) Inject synthetic records: UI subtask_result and update API tool_result
		const ts = Date.now()

		// Defensive: ensure arrays
		if (!Array.isArray(parentClineMessages)) parentClineMessages = []
		if (!Array.isArray(parentApiMessages)) parentApiMessages = []

		const subtaskUiMessage: ClineMessage = {
			type: "say",
			say: "subtask_result",
			text: completionResultSummary,
			ts,
		}
		parentClineMessages.push(subtaskUiMessage)
		await saveTaskMessages({ messages: parentClineMessages, taskId: parentTaskId, globalStoragePath })

		// Find the tool_use_id from the last assistant message's new_task tool_use
		let toolUseId: string | undefined
		for (let i = parentApiMessages.length - 1; i >= 0; i--) {
			const msg = parentApiMessages[i]
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "tool_use" && block.name === "new_task") {
						toolUseId = block.id
						break
					}
				}
				if (toolUseId) break
			}
		}

		// Preferred: if the parent history contains the native tool_use for new_task,
		// inject a matching tool_result for the Anthropic message contract:
		// user → assistant (tool_use) → user (tool_result)
		if (toolUseId) {
			// Check if the last message is already a user message with a tool_result for this tool_use_id
			// (in case this is a retry or the history was already updated)
			const lastMsg = parentApiMessages[parentApiMessages.length - 1]
			let alreadyHasToolResult = false
			if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
				for (const block of lastMsg.content) {
					if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
						// Update the existing tool_result content
						block.content = `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`
						alreadyHasToolResult = true
						break
					}
				}
			}

			// If no existing tool_result found, create a NEW user message with the tool_result
			if (!alreadyHasToolResult) {
				parentApiMessages.push({
					role: "user",
					content: [
						{
							type: "tool_result" as const,
							tool_use_id: toolUseId,
							content: `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`,
						},
					],
					ts,
				})
			}

			// Validate the newly injected tool_result against the preceding assistant message.
			// This ensures the tool_result's tool_use_id matches a tool_use in the immediately
			// preceding assistant message (Anthropic API requirement).
			const lastMessage = parentApiMessages[parentApiMessages.length - 1]
			if (lastMessage?.role === "user") {
				const validatedMessage = validateAndFixToolResultIds(lastMessage, parentApiMessages.slice(0, -1))
				parentApiMessages[parentApiMessages.length - 1] = validatedMessage
			}
		} else {
			// If there is no corresponding tool_use in the parent API history, we cannot emit a
			// tool_result. Fall back to a plain user text note so the parent can still resume.
			parentApiMessages.push({
				role: "user",
				content: [
					{
						type: "text" as const,
						text: `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`,
					},
				],
				ts,
			})
		}

		await saveApiMessages({ messages: parentApiMessages as any, taskId: parentTaskId, globalStoragePath })

		// 3) Close child instance if still open (single-open-task invariant).
		//    This MUST happen BEFORE updating the child's status to "completed" because
		//    removeClineFromStack() → abortTask(true) → saveClineMessages() writes
		//    the historyItem with initialStatus (typically "active"), which would
		//    overwrite a "completed" status set earlier.
		const current = this.getCurrentTask()
		if (current?.taskId === childTaskId) {
			await this.removeClineFromStack()
		}

		// 4) Update child metadata to "completed" status.
		//    This runs after the abort so it overwrites the stale "active" status
		//    that saveClineMessages() may have written during step 3.
		try {
			const { historyItem: childHistory } = await this.getTaskWithId(childTaskId)
			await this.updateTaskHistory({
				...childHistory,
				status: "completed",
			})
		} catch (err) {
			this.log(
				`[reopenParentFromDelegation] Failed to persist child completed status for ${childTaskId}: ${
					(err as Error)?.message ?? String(err)
				}`,
			)
		}

		// 5) Update parent metadata and persist BEFORE emitting completion event
		const childIds = Array.from(new Set([...(historyItem.childIds ?? []), childTaskId]))
		const updatedHistory: typeof historyItem = {
			...historyItem,
			status: "active",
			completedByChildId: childTaskId,
			completionResultSummary,
			awaitingChildId: undefined,
			childIds,
		}
		await this.updateTaskHistory(updatedHistory)

		// 6) Emit TaskDelegationCompleted (provider-level)
		try {
			this.emit(RooCodeEventName.TaskDelegationCompleted, parentTaskId, childTaskId, completionResultSummary)
		} catch (error) {
			this.log(
				`[delegationComplete] emit TaskDelegationCompleted failed: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		// 7) Reopen the parent from history as the sole active task (restores saved mode)
		//    IMPORTANT: startTask=false to suppress resume-from-history ask scheduling
		const parentInstance = await this.createTaskWithHistoryItem(updatedHistory, { startTask: false })

		// 8) Inject restored histories into the in-memory instance before resuming
		if (parentInstance) {
			// 8a) 更新并行子任务状态追踪（Requirements: 13.4）
			// 当子任务完成后，在父任务实例中标记该子任务为已完成
			try {
				parentInstance.updateParallelChildStatus(childTaskId, "completed", completionResultSummary)
			} catch (error) {
				// non-fatal: 并行子任务追踪是增强功能
				this.log(
					`[delegationComplete] updateParallelChildStatus failed: ${error instanceof Error ? error.message : String(error)}`,
				)
			}

			try {
				await parentInstance.overwriteClineMessages(parentClineMessages)
			} catch (error) {
				this.log(
					`[delegationComplete] overwriteClineMessages failed: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
			try {
				await parentInstance.overwriteApiConversationHistory(parentApiMessages as any)
			} catch (error) {
				this.log(
					`[delegationComplete] overwriteApiConversationHistory failed: ${error instanceof Error ? error.message : String(error)}`,
				)
			}

			// Auto-resume parent without ask("resume_task")
			await parentInstance.resumeAfterDelegation()
		}

		// 9) Emit TaskDelegationResumed (provider-level)
		try {
			this.emit(RooCodeEventName.TaskDelegationResumed, parentTaskId, childTaskId)
		} catch (error) {
			this.log(
				`[delegationComplete] emit TaskDelegationResumed failed: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Convert a file path to a webview-accessible URI
	 * This method safely converts file paths to URIs that can be loaded in the webview
	 *
	 * @param filePath - The absolute file path to convert
	 * @returns The webview URI string, or the original file URI if conversion fails
	 * @throws {Error} When webview is not available
	 * @throws {TypeError} When file path is invalid
	 */
	public convertToWebviewUri(filePath: string): string {
		try {
			const fileUri = vscode.Uri.file(filePath)

			// Check if we have a webview available
			if (this.view?.webview) {
				const webviewUri = this.view.webview.asWebviewUri(fileUri)
				return webviewUri.toString()
			}

			// Specific error for no webview available
			const error = new Error("No webview available for URI conversion")
			console.error(error.message)
			// Fallback to file URI if no webview available
			return fileUri.toString()
		} catch (error) {
			// More specific error handling
			if (error instanceof TypeError) {
				console.error("Invalid file path provided for URI conversion:", error)
			} else {
				console.error("Failed to convert to webview URI:", error)
			}
			// Return file URI as fallback
			return vscode.Uri.file(filePath).toString()
		}
	}
}

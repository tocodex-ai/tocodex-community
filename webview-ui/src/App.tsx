import React, { useCallback, useEffect, useRef, useState } from "react"
import { useEvent } from "react-use"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { type ExtensionMessage } from "@roo-code/types"

import TranslationProvider from "./i18n/TranslationContext"
import { vscode } from "./utils/vscode"
import { telemetryClient } from "./utils/TelemetryClient"
import { initializeSourceMaps, exposeSourceMapsForDebugging } from "./utils/sourceMapInitializer"
import { ExtensionStateContextProvider, useExtensionState } from "./context/ExtensionStateContext"
import ChatView, { ChatViewRef } from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import SettingsView, { SettingsViewRef } from "./components/settings/SettingsView"
import WelcomeView from "./components/welcome/WelcomeViewProvider"
import { CheckpointRestoreDialog } from "./components/chat/CheckpointRestoreDialog"
import { DeleteMessageDialog, EditMessageDialog } from "./components/chat/MessageModificationConfirmationDialog"
import ErrorBoundary from "./components/ErrorBoundary"
import { CloudView } from "./components/cloud/CloudView"
import { MarketplaceView } from "./components/marketplace/MarketplaceView"
import { MarketplaceViewStateManager } from "./components/marketplace/MarketplaceViewStateManager"
import { useAddNonInteractiveClickListener } from "./components/ui/hooks/useNonInteractiveClick"
import { TooltipProvider } from "./components/ui/tooltip"
import { STANDARD_TOOLTIP_DELAY } from "./components/ui/standard-tooltip"

type Tab = "settings" | "history" | "chat" | "cloud" | "marketplace"

interface DeleteMessageDialogState {
	isOpen: boolean
	messageTs: number
	hasCheckpoint: boolean
}

interface EditMessageDialogState {
	isOpen: boolean
	messageTs: number
	text: string
	hasCheckpoint: boolean
	images?: string[]
}

// Memoize dialog components to prevent unnecessary re-renders
const MemoizedDeleteMessageDialog = React.memo(DeleteMessageDialog)
const MemoizedEditMessageDialog = React.memo(EditMessageDialog)
const MemoizedCheckpointRestoreDialog = React.memo(CheckpointRestoreDialog)
const tabsByMessageAction: Partial<Record<NonNullable<ExtensionMessage["action"]>, Tab>> = {
	chatButtonClicked: "chat",
	settingsButtonClicked: "settings",
	historyButtonClicked: "history",
	cloudButtonClicked: "cloud",
	marketplaceButtonClicked: "marketplace",
}

const App = () => {
	const {
		didHydrateState,
		showWelcome,
		telemetrySetting,
		telemetryKey,
		machineId,
		cloudUserInfo,
		cloudIsAuthenticated,
		cloudApiUrl,
		cloudOrganizations,
		renderContext,
		mdmCompliant,
	} = useExtensionState()

	const [showAnnouncement, setShowAnnouncement] = useState(false)
	const [tab, setTab] = useState<Tab>("chat")
	const [forceShowWelcome, setForceShowWelcome] = useState(false)

	const [deleteMessageDialogState, setDeleteMessageDialogState] = useState<DeleteMessageDialogState>({
		isOpen: false,
		messageTs: 0,
		hasCheckpoint: false,
	})

	const [editMessageDialogState, setEditMessageDialogState] = useState<EditMessageDialogState>({
		isOpen: false,
		messageTs: 0,
		text: "",
		hasCheckpoint: false,
		images: [],
	})

	const settingsRef = useRef<SettingsViewRef>(null)
	const chatViewRef = useRef<ChatViewRef>(null)
	const [marketplaceStateManager] = useState(() => new MarketplaceViewStateManager())

	const switchTab = useCallback(
		(newTab: Tab) => {
			// Only check MDM compliance if mdmCompliant is explicitly false (meaning there's an MDM policy and user is non-compliant)
			// If mdmCompliant is undefined or true, allow tab switching
			if (mdmCompliant === false && newTab !== "cloud") {
				// Notify the user that authentication is required by their organization
				vscode.postMessage({ type: "showMdmAuthRequiredNotification" })
				return
			}

			setCurrentSection(undefined)

			if (settingsRef.current?.checkUnsaveChanges) {
				settingsRef.current.checkUnsaveChanges(() => setTab(newTab))
			} else {
				setTab(newTab)
			}
		},
		[mdmCompliant],
	)

	const [currentSection, setCurrentSection] = useState<string | undefined>(undefined)

	const onMessage = useCallback(
		(e: MessageEvent) => {
			const message: ExtensionMessage = e.data

			if (message.type === "action" && message.action) {
				// Handle switchTab action with tab parameter
				if (message.action === "switchTab" && message.tab) {
					const targetTab = message.tab as Tab
					switchTab(targetTab)
					// Extract targetSection from values if provided
					const targetSection = message.values?.section as string | undefined
					setCurrentSection(targetSection)
				} else {
					// Handle other actions using the mapping
					const newTab = tabsByMessageAction[message.action]
					const section = message.values?.section as string | undefined

					if (newTab) {
						switchTab(newTab)
						setCurrentSection(section)
					}
				}
			}

			if (message.type === "showDeleteMessageDialog" && message.messageTs) {
				setDeleteMessageDialogState({
					isOpen: true,
					messageTs: message.messageTs,
					hasCheckpoint: message.hasCheckpoint || false,
				})
			}

			if (message.type === "showEditMessageDialog" && message.messageTs && message.text) {
				setEditMessageDialogState({
					isOpen: true,
					messageTs: message.messageTs,
					text: message.text,
					hasCheckpoint: message.hasCheckpoint || false,
					images: message.images || [],
				})
			}

			if (message.type === "acceptInput") {
				chatViewRef.current?.acceptInput()
			}
		},
		[switchTab],
	)

	useEvent("message", onMessage)

	useEffect(() => {
		if (didHydrateState) {
			telemetryClient.updateTelemetryState(telemetrySetting, telemetryKey, machineId)
		}
	}, [telemetrySetting, telemetryKey, machineId, didHydrateState])

	// 登录成功后自动返回聊天界面
	// 注意：供应商重置（apiProvider: "roo"）由后端 extension.ts authStateChangedHandler 统一处理
	const prevAuthRef = useRef(cloudIsAuthenticated)
	useEffect(() => {
		if (!prevAuthRef.current && cloudIsAuthenticated) {
			// 从账户页登录时切换到聊天界面
			if (tab === "cloud") {
				setTab("chat")
			}
			// 从欢迎页登录时，清除强制显示欢迎页的标志，让欢迎页消失
			setForceShowWelcome(false)
		}
		prevAuthRef.current = cloudIsAuthenticated
	}, [cloudIsAuthenticated, tab])

	// 欢迎页完成配置后（如第三方供应商），自动切换到聊天页
	const prevShowWelcomeRef = useRef(showWelcome)
	const prevForceShowWelcomeRef = useRef(forceShowWelcome)
	useEffect(() => {
		const wasShowingWelcome = prevShowWelcomeRef.current || prevForceShowWelcomeRef.current
		const isShowingWelcome = showWelcome || forceShowWelcome
		if (wasShowingWelcome && !isShowingWelcome) {
			// 欢迎页消失了，切换到聊天页
			setTab("chat")
		}
		prevShowWelcomeRef.current = showWelcome
		prevForceShowWelcomeRef.current = forceShowWelcome
	}, [showWelcome, forceShowWelcome])

	// Initialize source map support for better error reporting
	useEffect(() => {
		// Initialize source maps for better error reporting in production
		initializeSourceMaps()

		// Expose source map debugging utilities in production
		if (process.env.NODE_ENV === "production") {
			exposeSourceMapsForDebugging()
		}

		// Log initialization for debugging
		console.debug("App initialized with source map support")
	}, [])

	// ─── 诊断：webview 心跳 + 未捕获异常上报 ───────────────────────
	// 排查"中途白屏"：每 5s 给 extension host 发心跳，附带最近一次 render 时间戳。
	// 如果 webview 进入死循环 / 主线程长任务，心跳就会停。extension host 侧
	// 比对 (Date.now() - lastBeat) > 阈值就能知道 webview 卡死了。
	// 同时挂 window.onerror / unhandledrejection，把堆栈直接 postMessage 回去。
	useEffect(() => {
		let beats = 0
		const beat = () => {
			beats++
			try {
				vscode.postMessage({
					type: "webviewHeartbeat" as any,
					values: { beats, at: Date.now() } as any,
				} as any)
			} catch {
				/* ignore */
			}
		}
		const interval = setInterval(beat, 5000)
		beat() // 立即首发，标记 webview 已起跑

		const onError = (event: ErrorEvent) => {
			try {
				vscode.postMessage({
					type: "webviewDiagnostic" as any,
					values: {
						kind: "error",
						message: String(event.message ?? ""),
						stack: String((event.error && event.error.stack) ?? ""),
						filename: String(event.filename ?? ""),
						line: event.lineno,
						col: event.colno,
					} as any,
				} as any)
			} catch {
				/* ignore */
			}
		}
		const onRejection = (event: PromiseRejectionEvent) => {
			try {
				vscode.postMessage({
					type: "webviewDiagnostic" as any,
					values: {
						kind: "unhandledRejection",
						reason: String(event.reason?.message ?? event.reason ?? ""),
						stack: String(event.reason?.stack ?? ""),
					} as any,
				} as any)
			} catch {
				/* ignore */
			}
		}
		window.addEventListener("error", onError)
		window.addEventListener("unhandledrejection", onRejection)

		return () => {
			clearInterval(interval)
			window.removeEventListener("error", onError)
			window.removeEventListener("unhandledrejection", onRejection)
		}
	}, [])

	// Focus the WebView when non-interactive content is clicked (only in editor/tab mode)
	useAddNonInteractiveClickListener(
		useCallback(() => {
			// Only send focus request if we're in editor (tab) mode, not sidebar
			if (renderContext === "editor") {
				vscode.postMessage({ type: "focusPanelRequest" })
			}
		}, [renderContext]),
	)
	if (!didHydrateState) {
		return null
	}

	// Do not conditionally load ChatView, it's expensive and there's state we
	// don't want to lose (user input, disableInput, askResponse promise, etc.)
	// When showing the welcome screen, still allow the settings tab to overlay on top.
	// This lets users open settings from the gear button on the welcome page.
	if (showWelcome || forceShowWelcome) {
		return tab === "settings" ? (
			<SettingsView ref={settingsRef} onDone={() => setTab("chat")} targetSection={currentSection} />
		) : (
			<WelcomeView />
		)
	}

	return (
		<>
			{tab === "history" && <HistoryView onDone={() => switchTab("chat")} />}
			{tab === "settings" && (
				<SettingsView ref={settingsRef} onDone={() => setTab("chat")} targetSection={currentSection} />
			)}
			{tab === "cloud" && (
				<CloudView
					userInfo={cloudUserInfo}
					isAuthenticated={cloudIsAuthenticated}
					onBackToChat={() => switchTab("chat")}
					onShowWelcome={() => setForceShowWelcome(true)}
				/>
			)}
			{tab === "marketplace" && (
				<MarketplaceView stateManager={marketplaceStateManager} onDone={() => switchTab("chat")} />
			)}
			<ChatView
				ref={chatViewRef}
				isHidden={tab !== "chat"}
				showAnnouncement={showAnnouncement}
				hideAnnouncement={() => setShowAnnouncement(false)}
			/>
			{deleteMessageDialogState.hasCheckpoint ? (
				<MemoizedCheckpointRestoreDialog
					open={deleteMessageDialogState.isOpen}
					type="delete"
					hasCheckpoint={deleteMessageDialogState.hasCheckpoint}
					onOpenChange={(open: boolean) => setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: open }))}
					onConfirm={(restoreCheckpoint: boolean) => {
						vscode.postMessage({
							type: "deleteMessageConfirm",
							messageTs: deleteMessageDialogState.messageTs,
							restoreCheckpoint,
						})
						setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: false }))
					}}
				/>
			) : (
				<MemoizedDeleteMessageDialog
					open={deleteMessageDialogState.isOpen}
					onOpenChange={(open: boolean) => setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: open }))}
					onConfirm={() => {
						vscode.postMessage({
							type: "deleteMessageConfirm",
							messageTs: deleteMessageDialogState.messageTs,
						})
						setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: false }))
					}}
				/>
			)}
			{editMessageDialogState.hasCheckpoint ? (
				<MemoizedCheckpointRestoreDialog
					open={editMessageDialogState.isOpen}
					type="edit"
					hasCheckpoint={editMessageDialogState.hasCheckpoint}
					onOpenChange={(open: boolean) => setEditMessageDialogState((prev) => ({ ...prev, isOpen: open }))}
					onConfirm={(restoreCheckpoint: boolean) => {
						vscode.postMessage({
							type: "editMessageConfirm",
							messageTs: editMessageDialogState.messageTs,
							text: editMessageDialogState.text,
							restoreCheckpoint,
						})
						setEditMessageDialogState((prev) => ({ ...prev, isOpen: false }))
					}}
				/>
			) : (
				<MemoizedEditMessageDialog
					open={editMessageDialogState.isOpen}
					onOpenChange={(open: boolean) => setEditMessageDialogState((prev) => ({ ...prev, isOpen: open }))}
					onConfirm={() => {
						vscode.postMessage({
							type: "editMessageConfirm",
							messageTs: editMessageDialogState.messageTs,
							text: editMessageDialogState.text,
							images: editMessageDialogState.images,
						})
						setEditMessageDialogState((prev) => ({ ...prev, isOpen: false }))
					}}
				/>
			)}
		</>
	)
}

const queryClient = new QueryClient()

const AppWithProviders = () => (
	<ErrorBoundary>
		<ExtensionStateContextProvider>
			<TranslationProvider>
				<QueryClientProvider client={queryClient}>
					<TooltipProvider delayDuration={STANDARD_TOOLTIP_DELAY}>
						<App />
					</TooltipProvider>
				</QueryClientProvider>
			</TranslationProvider>
		</ExtensionStateContextProvider>
	</ErrorBoundary>
)

export default AppWithProviders

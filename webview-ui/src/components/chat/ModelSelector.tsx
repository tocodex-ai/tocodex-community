import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { Check, X } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { cn } from "@/lib/utils"
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"
import { Popover, PopoverContent, PopoverTrigger, StandardTooltip } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useRouterModels } from "@/components/ui/hooks/useRouterModels"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import type { RouterModels, ProviderName } from "@roo-code/types"
import { isDynamicProvider } from "@roo-code/types"
import { MODELS_BY_PROVIDER } from "@/components/settings/constants"
import { isImageOnlyModel } from "@/components/settings/utils/organizationFilters"

// provider → 模型 ID 字段映射（和设置界面 ModelPicker 的 modelIdKey 一致）
const MODEL_ID_KEY_MAP: Partial<Record<ProviderName, string>> = {
	openrouter: "openRouterModelId",
	requesty: "requestyModelId",
	unbound: "unboundModelId",
	openai: "openAiModelId",
	litellm: "litellmModelId",
	ollama: "ollamaModelId",
	lmstudio: "lmStudioModelId",
	"vercel-ai-gateway": "vercelAiGatewayModelId",
}

function getModelIdKey(provider: string): string {
	return MODEL_ID_KEY_MAP[provider as ProviderName] ?? "apiModelId"
}

interface ModelSelectorProps {
	disabled?: boolean
	triggerClassName?: string
}

function sortModels(modelIds: string[], modelsMap: Record<string, { isFree?: boolean; modelRatio?: number }>) {
	return modelIds
		.sort()
		.map((id) => ({ id, name: id, isFree: !!modelsMap[id]?.isFree, modelRatio: modelsMap[id]?.modelRatio }))
}

function getModelList(routerModels: RouterModels | undefined, apiProvider: string) {
	// 优先用动态 routerModels（roo、openrouter 等动态 provider）
	if (routerModels) {
		const models = (routerModels as Record<string, Record<string, { isFree?: boolean; modelRatio?: number }>>)[
			apiProvider
		]
		if (models && typeof models === "object" && Object.keys(models).length > 0) {
			// 过滤掉纯图像生成模型（如 gpt-image-*、dall-e-*、flux* 等），防止误选导致对话报错
			const chatModelIds = Object.keys(models).filter((id) => !isImageOnlyModel(id))
			return sortModels(chatModelIds, models)
		}
	}
	// Fallback：使用和设置界面相同的硬编码模型列表（deepseek、mistral、xai 等静态 provider）
	const staticModels = MODELS_BY_PROVIDER[apiProvider as keyof typeof MODELS_BY_PROVIDER]
	if (staticModels && Object.keys(staticModels).length > 0) {
		return Object.keys(staticModels)
			.filter((id) => !isImageOnlyModel(id))
			.sort()
			.map((id) => ({ id, name: id, isFree: !!(staticModels[id] as any)?.isFree, modelRatio: undefined }))
	}
	return []
}

export const ModelSelector = ({ disabled = false, triggerClassName = "" }: ModelSelectorProps) => {
	const { t } = useAppTranslation()
	const queryClient = useQueryClient()
	const { apiConfiguration, currentApiConfigName, routerModels: extensionRouterModels } = useExtensionState()
	const [open, setOpen] = useState(false)
	const [search, setSearch] = useState("")
	const searchRef = useRef<HTMLInputElement>(null)
	const portalContainer = useRooPortal("roo-portal")
	const [syncing, setSyncing] = useState(false)
	const [syncResult, setSyncResult] = useState<"success" | "error" | null>(null)
	const [syncCooldown, setSyncCooldown] = useState(false)
	const syncCooldownTimerRef = useRef<NodeJS.Timeout | null>(null)

	const apiProvider = apiConfiguration?.apiProvider ?? "roo"
	const modelIdKey = getModelIdKey(apiProvider)
	const currentModelId = (apiConfiguration as any)?.[modelIdKey] ?? ""

	// 获取 router 模型列表
	// OpenAI Compatible provider: model list via openAiModels message
	type OpenAiCompatModel = { id: string; isFree: boolean }
	const [openAiCompatModels, setOpenAiCompatModels] = useState<OpenAiCompatModel[]>([])
	const isOpenAiCompat = apiProvider === "openai"

	useEffect(() => {
		if (!isOpenAiCompat) return
		const handler = (e: MessageEvent) => {
			if (e.data?.type !== "openAiModels") return
			// 优先读取带 pricing 信息的新字段 values.openAiModelInfos
			const infos = e.data?.values?.openAiModelInfos
			if (Array.isArray(infos) && infos.length > 0) {
				setOpenAiCompatModels(
					infos
						.filter((m: any) => m && typeof m.id === "string")
						.map((m: any) => ({ id: m.id, isFree: !!m.isFree })),
				)
				return
			}
			// 兼容旧版只回 id 数组的情况
			if (Array.isArray(e.data.openAiModels)) {
				setOpenAiCompatModels(e.data.openAiModels.map((id: string) => ({ id, isFree: /:free$/i.test(id) })))
			}
		}
		window.addEventListener("message", handler)
		const baseUrl = apiConfiguration?.openAiBaseUrl
		const apiKey = apiConfiguration?.openAiApiKey
		if (baseUrl) {
			vscode.postMessage({
				type: "requestOpenAiModels",
				values: { baseUrl, apiKey, openAiHeaders: apiConfiguration?.openAiHeaders },
			})
		}
		return () => window.removeEventListener("message", handler)
	}, [isOpenAiCompat, apiConfiguration?.openAiBaseUrl, apiConfiguration?.openAiApiKey])
	// 只对动态 provider（roo、openrouter、requesty 等）请求模型列表
	// 静态 provider（deepseek、mistral、xai 等）直接用 MODELS_BY_PROVIDER，无需请求后端
	const isDynamic = apiProvider === "roo" || isDynamicProvider(apiProvider as ProviderName)
	const routerModelsQuery = useRouterModels({
		provider: apiProvider === "roo" ? "roo" : apiProvider,
		enabled: isDynamic,
	})

	useEffect(() => {
		const handler = (e: MessageEvent) => {
			const msg = e.data
			const messageProvider = msg?.values?.provider
			const isCurrentProvider = !messageProvider || messageProvider === apiProvider

			if (!isCurrentProvider || !syncing) {
				return
			}

			if (msg.type === "routerModels") {
				setSyncing(false)
				setSyncResult("success")
				setTimeout(() => setSyncResult(null), 2000)
				// 同步成功后 invalidate react-query 缓存，强制重新获取模型列表
				queryClient.invalidateQueries({ queryKey: ["routerModels"], exact: false })
				return
			}

			// OpenAI Compatible provider 的 ack：收到 openAiModels 消息立即清 syncing 状态，
			// 避免旋转图标一直转到 10s 冷却 setTimeout 兜底，造成"刷新很慢"的视觉错觉。
			// 注：openAiModels 消息不带 values.provider 字段，前面 isCurrentProvider 判断
			// 因 messageProvider 为 undefined 会通过（!undefined → true），所以这里能进入。
			if (msg.type === "openAiModels" && isOpenAiCompat) {
				setSyncing(false)
				setSyncResult("success")
				setTimeout(() => setSyncResult(null), 2000)
				return
			}

			if (msg.type === "singleRouterModelFetchResponse" && !msg.success) {
				setSyncing(false)
				setSyncResult("error")
				setTimeout(() => setSyncResult(null), 2000)
			}
		}
		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [syncing, apiProvider, isOpenAiCompat, queryClient])

	useEffect(() => {
		return () => {
			if (syncCooldownTimerRef.current) {
				clearTimeout(syncCooldownTimerRef.current)
			}
		}
	}, [])

	// 组件挂载后延迟 1 秒自动刷新动态 provider 的模型列表
	// 解决重启后 openrouter 等动态 provider 模型列表为空的问题
	const autoRefreshedRef = useRef(false)
	useEffect(() => {
		if (!isDynamic || isOpenAiCompat || autoRefreshedRef.current) return
		const timer = setTimeout(() => {
			autoRefreshedRef.current = true
			vscode.postMessage({
				type: "requestRouterModels",
				values: { provider: apiProvider === "roo" ? "roo" : apiProvider },
			})
		}, 1000)
		return () => clearTimeout(timer)
	}, [isDynamic, isOpenAiCompat, apiProvider])

	// 弹出模型列表后延时 500ms 自动刷新一次模型列表（等同于点击右上角同步图标）。
	// 通过 ref 调用 handleSync，避免把 handleSync 放进依赖导致每次配置变更都重启计时器。
	const handleSyncRef = useRef<() => void>(() => {})
	useEffect(() => {
		if (!open) return
		const timer = setTimeout(() => {
			handleSyncRef.current()
		}, 500)
		return () => clearTimeout(timer)
	}, [open])

	// 获取当前 provider 的模型列表
	// 合并 extensionRouterModels（来自后端推送）和 routerModelsQuery（来自 useRouterModels 请求）
	const mergedRouterModels = useMemo(() => {
		const base = extensionRouterModels ?? {}
		const queried = routerModelsQuery.data ?? {}
		return { ...base, ...queried } as RouterModels
	}, [extensionRouterModels, routerModelsQuery.data])

	const modelList = useMemo(() => {
		if (isOpenAiCompat && openAiCompatModels.length > 0) {
			return openAiCompatModels
				.filter((m) => !isImageOnlyModel(m.id))
				.slice()
				.sort((a, b) => a.id.localeCompare(b.id))
				.map((m) => ({ id: m.id, name: m.id, isFree: m.isFree, modelRatio: undefined }))
		}
		return getModelList(mergedRouterModels, apiProvider)
	}, [mergedRouterModels, apiProvider, isOpenAiCompat, openAiCompatModels])

	// 当模型列表加载完成后，若当前没有选中模型或模型不在列表中，自动选第一个
	useEffect(() => {
		if (modelList.length === 0 || currentModelId) return
		const modelIds = modelList.map((m) => m.id)
		const hasValidModel = currentModelId && modelIds.includes(currentModelId)
		if (!hasValidModel) {
			vscode.postMessage({
				type: "upsertApiConfiguration",
				text: currentApiConfigName,
				apiConfiguration: {
					...(apiConfiguration ?? {}),
					[modelIdKey]: modelList[0].id,
				},
			})
		}
	}, [modelList, apiProvider, currentModelId, currentApiConfigName, apiConfiguration, modelIdKey])

	// 搜索过滤
	const filteredList = useMemo(() => {
		if (!search) return modelList
		const lower = search.toLowerCase()
		return modelList.filter((m) => m.id.toLowerCase().includes(lower))
	}, [modelList, search])

	const displayName = currentModelId || t("chat:selectModel")

	const handleSelect = useCallback(
		(modelId: string) => {
			vscode.postMessage({
				type: "upsertApiConfiguration",
				text: currentApiConfigName,
				apiConfiguration: {
					...(apiConfiguration ?? {}),
					[modelIdKey]: modelId,
				},
			})
			setOpen(false)
			setSearch("")
		},
		[apiConfiguration, currentApiConfigName, modelIdKey],
	)

	// 防抖：10 秒内只允许触发一次刷新（无论手动点击还是 500ms 自动刷新）
	const lastSyncAtRef = useRef<number>(0)
	const SYNC_COOLDOWN_MS = 10_000
	const handleSync = useCallback(() => {
		// 早退守卫：正在请求中、显式冷却中、或距上次触发不到 10 秒，都不再发请求
		const now = Date.now()
		if (syncing || syncCooldown) return
		if (now - lastSyncAtRef.current < SYNC_COOLDOWN_MS) return
		lastSyncAtRef.current = now

		setSyncing(true)
		setSyncResult(null)
		setSyncCooldown(true)
		if (isOpenAiCompat) {
			const baseUrl = apiConfiguration?.openAiBaseUrl
			const apiKey = apiConfiguration?.openAiApiKey
			if (baseUrl) {
				vscode.postMessage({
					type: "requestOpenAiModels",
					values: { baseUrl, apiKey, openAiHeaders: apiConfiguration?.openAiHeaders },
				})
			}
		} else {
			vscode.postMessage({
				type: "requestRouterModels",
				values: { provider: apiProvider, refresh: true },
			})
		}

		if (syncCooldownTimerRef.current) {
			clearTimeout(syncCooldownTimerRef.current)
		}
		syncCooldownTimerRef.current = setTimeout(() => {
			setSyncCooldown(false)
			setSyncing(false)
		}, SYNC_COOLDOWN_MS)
	}, [apiProvider, isOpenAiCompat, apiConfiguration, syncing, syncCooldown])

	// 让 500ms-on-open 副作用通过 ref 调用最新的 handleSync
	useEffect(() => {
		handleSyncRef.current = handleSync
	}, [handleSync])

	return (
		<Popover
			open={open}
			onOpenChange={(v) => {
				setOpen(v)
				if (!v) setSearch("")
			}}>
			<StandardTooltip content={t("chat:selectModel")}>
				<PopoverTrigger
					disabled={disabled}
					className={cn(
						"min-w-0 inline-flex items-center relative whitespace-nowrap px-1.5 py-1 text-xs",
						"bg-transparent border border-[rgba(255,255,255,0.08)] rounded-md text-vscode-foreground",
						"transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder focus-visible:ring-inset",
						disabled
							? "opacity-50 cursor-not-allowed"
							: "opacity-90 hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)] cursor-pointer",
						triggerClassName,
					)}>
					<span className="truncate">{displayName}</span>
				</PopoverTrigger>
			</StandardTooltip>
			<PopoverContent
				align="start"
				sideOffset={4}
				container={portalContainer}
				className="p-0 overflow-hidden w-[300px]">
				<div className="flex flex-col w-full">
					{/* 搜索框 + 同步按钮 */}
					<div className="p-2 border-b border-vscode-dropdown-border">
						<div className="relative flex items-center gap-1">
							<div className="relative flex-1">
								<input
									ref={searchRef}
									type="text"
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									placeholder={t("settings:modelPicker.searchPlaceholder")}
									autoFocus
									className={cn(
										"w-full px-2 py-1 text-xs rounded",
										"bg-vscode-input-background text-vscode-input-foreground",
										"border border-vscode-input-border",
										"outline-none focus:border-vscode-focusBorder",
										search ? "pr-6" : "",
									)}
								/>
								{search && (
									<X
										className="absolute right-1.5 top-1/2 -translate-y-1/2 size-3.5 cursor-pointer opacity-50 hover:opacity-100 text-vscode-input-foreground"
										onClick={() => {
											setSearch("")
											searchRef.current?.focus()
										}}
									/>
								)}
							</div>
							{/* 同步按钮 */}
							<div className="flex items-center gap-0.5 shrink-0">
								<button
									onClick={handleSync}
									disabled={syncing || syncCooldown}
									title={t("settings:modelPicker.syncModels")}
									className={cn(
										"codicon bg-transparent border-none p-0.5 text-vscode-foreground opacity-70",
										syncing || syncCooldown
											? "cursor-not-allowed"
											: "cursor-pointer hover:opacity-100",
										syncing ? "codicon-loading animate-spin" : "codicon-sync",
									)}
								/>
								{syncResult === "success" && <span className="text-[10px] text-green-500">✓</span>}
								{syncResult === "error" && <span className="text-[10px] text-red-500">✗</span>}
							</div>
						</div>
					</div>
					{/* 区域法规说明：根据用户 IP 所在区域的法律政策显示可用模型 */}
					<div className="px-2 py-1.5 text-[10px] leading-snug text-vscode-descriptionForeground border-b border-vscode-dropdown-border">
						{t("chat:modelRegionNotice")}
					</div>
					{filteredList.length === 0 ? (
						<div className="py-4 px-3 text-sm text-vscode-foreground/70 text-center">
							{search ? t("settings:modelPicker.noMatchFound") : t("chat:noModelsAvailable")}
						</div>
					) : (
						<div className="max-h-[300px] overflow-y-auto py-1">
							{filteredList.map((model) => {
								const isSelected = model.id === currentModelId
								return (
									<div
										key={model.id}
										onClick={() => handleSelect(model.id)}
										className={cn(
											"px-3 py-1.5 text-sm cursor-pointer flex items-center",
											"hover:bg-vscode-list-hoverBackground",
											isSelected &&
												"bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground",
										)}>
										<span className="flex-1 min-w-0 truncate">
											{model.name}
											{apiProvider !== "roo" && model.modelRatio != null && (
												<span className="ml-1.5 text-[10px] text-vscode-descriptionForeground opacity-50">
													{model.modelRatio}x
												</span>
											)}
										</span>
										{isSelected && <Check className="ml-1 shrink-0 size-4 p-0.5" />}
										{model.isFree && (
											<span className="ml-1 shrink-0 text-[10px] px-1 py-0.5 rounded bg-green-600/20 text-green-400">
												Free
											</span>
										)}
									</div>
								)
							})}
						</div>
					)}
				</div>
			</PopoverContent>
		</Popover>
	)
}

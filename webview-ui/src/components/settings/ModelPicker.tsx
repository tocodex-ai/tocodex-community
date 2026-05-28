import { useMemo, useState, useCallback, useEffect, useRef } from "react"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Trans } from "react-i18next"
import { ChevronsUpDown, Check, X, Info } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { type ProviderSettings, type ModelInfo, type OrganizationAllowList, isRetiredProvider } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useSelectedModel } from "@/components/ui/hooks/useSelectedModel"
import { filterModels, isImageOnlyModel } from "./utils/organizationFilters"
import { cn } from "@src/lib/utils"
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Button,
} from "@src/components/ui"
import { useEscapeKey } from "@src/hooks/useEscapeKey"
import { vscode } from "@/utils/vscode"

import { ModelInfoView } from "./ModelInfoView"
import { ApiErrorMessage } from "./ApiErrorMessage"

type ModelIdKey = keyof Pick<
	ProviderSettings,
	| "openRouterModelId"
	| "requestyModelId"
	| "unboundModelId"
	| "openAiModelId"
	| "litellmModelId"
	| "vercelAiGatewayModelId"
	| "apiModelId"
	| "ollamaModelId"
	| "lmStudioModelId"
	| "lmStudioDraftModelId"
	| "vsCodeLmModelSelector"
>

interface ModelPickerProps {
	defaultModelId: string
	models: Record<string, ModelInfo> | null
	modelIdKey: ModelIdKey
	serviceName: string
	serviceUrl: string
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
	organizationAllowList?: OrganizationAllowList
	errorMessage?: string
	simplifySettings?: boolean
	hidePricing?: boolean
	/** Label for the model picker field - defaults to "Model" */
	label?: string
	/** Transform model ID string to the value stored in configuration (for compound types like VSCodeLM selector) */
	valueTransform?: (modelId: string) => unknown
	/** Transform stored configuration value back to display string */
	displayTransform?: (value: unknown) => string
	/** Callback when model changes - useful for side effects like clearing related fields */
	onModelChange?: (modelId: string) => void
}

export const ModelPicker = ({
	defaultModelId,
	models,
	modelIdKey,
	serviceName,
	serviceUrl,
	apiConfiguration,
	setApiConfigurationField,
	organizationAllowList,
	errorMessage,
	simplifySettings,
	hidePricing,
	label,
	valueTransform,
	displayTransform,
	onModelChange,
}: ModelPickerProps) => {
	const { t } = useAppTranslation()
	const { currentApiConfigName } = useExtensionState()
	const queryClient = useQueryClient()

	const [open, setOpen] = useState(false)
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
	const isInitialized = useRef(false)
	const searchInputRef = useRef<HTMLInputElement>(null)
	const selectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null)

	const { id: selectedModelId, info: selectedModelInfo } = useSelectedModel(apiConfiguration)

	// Get the display value for the current selection
	// If displayTransform is provided, use it to convert the stored value to a display string
	const displayValue = useMemo(() => {
		if (displayTransform) {
			const storedValue = apiConfiguration[modelIdKey]
			return storedValue ? displayTransform(storedValue) : undefined
		}
		return selectedModelId
	}, [displayTransform, apiConfiguration, modelIdKey, selectedModelId])

	const activeProvider =
		apiConfiguration.apiProvider && isRetiredProvider(apiConfiguration.apiProvider)
			? undefined
			: apiConfiguration.apiProvider

	const modelIds = useMemo(() => {
		const filteredModels = filterModels(models, activeProvider, organizationAllowList)

		// Include the currently selected model even if deprecated or image-only (so users can see what they have selected)
		// But filter out other deprecated models and pure image generation models from being newly selectable
		const availableModels = Object.entries(filteredModels ?? {})
			.filter(([modelId, modelInfo]) => {
				// Always include the currently selected model
				if (modelId === selectedModelId) return true
				// Filter out image-only models that aren't currently selected
				if (isImageOnlyModel(modelId)) return false
				// Filter out deprecated models that aren't currently selected
				return !modelInfo.deprecated
			})
			.reduce(
				(acc, [modelId, modelInfo]) => {
					acc[modelId] = modelInfo
					return acc
				},
				{} as Record<string, ModelInfo>,
			)

		return Object.keys(availableModels).sort((a, b) => a.localeCompare(b))
	}, [models, activeProvider, organizationAllowList, selectedModelId])

	const [searchValue, setSearchValue] = useState("")

	const onSelect = useCallback(
		(modelId: string) => {
			if (!modelId) {
				return
			}

			setOpen(false)

			// Apply value transform if provided (e.g., for VSCodeLM selector)
			const valueToStore = valueTransform ? valueTransform(modelId) : modelId
			setApiConfigurationField(modelIdKey, valueToStore as ProviderSettings[ModelIdKey])

			// 如果是自定义模型（不在列表中），保存并刷新模型列表
			if (!modelIds.includes(modelId)) {
				vscode.postMessage({
					type: "addCustomModel",
					text: modelId,
					values: { provider: apiConfiguration.apiProvider || "roo" },
				} as any)
				// 保存后立即刷新模型列表
				setTimeout(() => {
					vscode.postMessage({ type: "requestRouterModels" })
				}, 200)
			}

			// Call the optional change callback
			onModelChange?.(modelId)

			// Clear any existing timeout
			if (selectTimeoutRef.current) {
				clearTimeout(selectTimeoutRef.current)
			}

			// Delay to ensure the popover is closed before setting the search value.
			selectTimeoutRef.current = setTimeout(() => setSearchValue(""), 100)
		},
		[modelIdKey, setApiConfigurationField, valueTransform, onModelChange, modelIds, apiConfiguration],
	)

	const onOpenChange = useCallback((open: boolean) => {
		setOpen(open)

		// Abandon the current search if the popover is closed.
		if (!open) {
			// Clear any existing timeout
			if (closeTimeoutRef.current) {
				clearTimeout(closeTimeoutRef.current)
			}

			// Clear the search value when closing instead of prefilling it
			closeTimeoutRef.current = setTimeout(() => setSearchValue(""), 100)
		}
	}, [])

	const onClearSearch = useCallback(() => {
		setSearchValue("")
		searchInputRef.current?.focus()
	}, [])

	useEffect(() => {
		if (!selectedModelId && !isInitialized.current) {
			const initialValue = modelIds.includes(selectedModelId) ? selectedModelId : defaultModelId
			setApiConfigurationField(modelIdKey, initialValue, false) // false = automatic initialization
		}

		isInitialized.current = true
	}, [modelIds, setApiConfigurationField, modelIdKey, selectedModelId, defaultModelId])

	// Cleanup timeouts on unmount to prevent test flakiness
	useEffect(() => {
		return () => {
			if (selectTimeoutRef.current) {
				clearTimeout(selectTimeoutRef.current)
			}
			if (closeTimeoutRef.current) {
				clearTimeout(closeTimeoutRef.current)
			}
		}
	}, [])

	// Use the shared ESC key handler hook
	const [syncing, setSyncing] = useState(false)
	const [syncResult, setSyncResult] = useState<"success" | "error" | null>(null)
	// 防抖：按钮禁用状态（独立于 syncing，用于冷却时间）
	const [syncCooldown, setSyncCooldown] = useState(false)
	// 频率限制：记录 30 秒内的点击时间戳
	const syncTimestampsRef = useRef<number[]>([])
	const syncCooldownTimerRef = useRef<NodeJS.Timeout | null>(null)

	// 监听模型同步结果
	useEffect(() => {
		const handler = (e: MessageEvent) => {
			const msg = e.data
			if (msg.type === "routerModels" || msg.type === "singleRouterModelFetchResponse") {
				if (syncing) {
					const isError = msg.type === "singleRouterModelFetchResponse" && !msg.success
					setSyncing(false)
					setSyncResult(isError ? "error" : "success")
					setTimeout(() => setSyncResult(null), 2000)
					// 同步成功后自动触发保存，并刷新模型列表缓存
					if (!isError) {
						vscode.postMessage({
							type: "upsertApiConfiguration",
							text: currentApiConfigName,
							apiConfiguration,
						})
						// 当前 useRouterModels 的 queryKey 是 ["routerModels", provider || "all"]，
						// 这里需要按前缀失效所有相关缓存，否则某些 provider 视图不会重新取数。
						queryClient.invalidateQueries({ queryKey: ["routerModels"], exact: false })
					}
				}
			}
		}
		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [syncing, currentApiConfigName, apiConfiguration, queryClient])

	// 清理冷却计时器
	useEffect(() => {
		return () => {
			if (syncCooldownTimerRef.current) {
				clearTimeout(syncCooldownTimerRef.current)
			}
		}
	}, [])

	const handleSyncClick = useCallback(() => {
		const now = Date.now()
		// 清理 30 秒前的记录
		syncTimestampsRef.current = syncTimestampsRef.current.filter((t) => now - t < 30000)
		syncTimestampsRef.current.push(now)

		// 30 秒内超过 15 次，冷却 5 秒；否则冷却 2 秒
		const cooldownMs = syncTimestampsRef.current.length > 15 ? 5000 : 2000

		setSyncing(true)
		setSyncResult(null)
		setSyncCooldown(true)
		vscode.postMessage({
			type: "requestRouterModels",
			values: { provider: apiConfiguration.apiProvider || "roo", refresh: true },
		})

		if (syncCooldownTimerRef.current) {
			clearTimeout(syncCooldownTimerRef.current)
		}
		syncCooldownTimerRef.current = setTimeout(() => {
			setSyncCooldown(false)
		}, cooldownMs)
	}, [apiConfiguration.apiProvider])

	useEscapeKey(open, () => setOpen(false))

	return (
		<>
			<div>
				<div className="flex items-center gap-2 mb-1">
					<label className="block font-medium">{label ?? t("settings:modelPicker.label")}</label>
					<button
						onClick={handleSyncClick}
						disabled={syncing || syncCooldown}
						className={cn(
							"codicon bg-transparent border-none p-0 text-vscode-foreground opacity-70",
							syncing || syncCooldown ? "cursor-not-allowed" : "cursor-pointer hover:opacity-100",
							syncing ? "codicon-loading animate-spin" : "codicon-sync",
						)}
						title={t("settings:modelPicker.syncModels")}
					/>
					{syncResult === "success" && <span className="text-xs text-green-500">✓</span>}
					{syncResult === "error" && <span className="text-xs text-red-500">✗</span>}
				</div>
				<Popover open={open} onOpenChange={onOpenChange}>
					<PopoverTrigger asChild>
						<Button
							variant="combobox"
							role="combobox"
							aria-expanded={open}
							className="w-full justify-between"
							data-testid="model-picker-button">
							<div className="truncate">{displayValue ?? t("settings:common.select")}</div>
							<ChevronsUpDown className="opacity-50" />
						</Button>
					</PopoverTrigger>
					<PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
						<Command>
							<div className="relative">
								<CommandInput
									ref={searchInputRef}
									value={searchValue}
									onValueChange={setSearchValue}
									placeholder={t("settings:modelPicker.searchPlaceholder")}
									className="h-9 mr-4"
									data-testid="model-input"
								/>
								{searchValue.length > 0 && (
									<div className="absolute right-2 top-0 bottom-0 flex items-center justify-center">
										<X
											className="text-vscode-input-foreground opacity-50 hover:opacity-100 size-4 p-0.5 cursor-pointer"
											onClick={onClearSearch}
										/>
									</div>
								)}
							</div>
							<CommandList>
								<CommandEmpty>
									{searchValue && (
										<div className="py-2 px-1 text-sm">
											{t("settings:modelPicker.noMatchFound")}
										</div>
									)}
								</CommandEmpty>
								<CommandGroup>
									{modelIds.map((model) => {
										const modelInfo = models?.[model]
										const isFree = modelInfo?.isFree ?? false
										return (
											<CommandItem
												key={model}
												value={model}
												onSelect={onSelect}
												data-testid={`model-option-${model}`}>
												<span className="truncate" title={model}>
													{model}
												</span>
												{isFree && (
													<span className="ml-1 shrink-0 text-[10px] px-1 py-0.5 rounded bg-green-600/20 text-green-400">
														Free
													</span>
												)}
												<Check
													className={cn(
														"size-4 p-0.5 ml-1 shrink-0",
														model === displayValue ? "opacity-100" : "opacity-0",
													)}
												/>
											</CommandItem>
										)
									})}
								</CommandGroup>
							</CommandList>
							{searchValue && !modelIds.includes(searchValue) && (
								<div className="p-1 border-t border-vscode-input-border">
									<CommandItem data-testid="use-custom-model" value={searchValue} onSelect={onSelect}>
										{t("settings:modelPicker.useCustomModel", { modelId: searchValue })}
									</CommandItem>
								</div>
							)}
						</Command>
					</PopoverContent>
				</Popover>
			</div>
			{errorMessage && <ApiErrorMessage errorMessage={errorMessage} />}
			{selectedModelInfo?.deprecated && (
				<ApiErrorMessage errorMessage={t("settings:validation.modelDeprecated")} />
			)}

			{simplifySettings ? (
				<p className="text-xs text-vscode-descriptionForeground m-0">
					<Info className="size-3 inline mr-1" />
					{t("settings:modelPicker.simplifiedExplanation")}
				</p>
			) : (
				<div>
					{selectedModelId && selectedModelInfo && !selectedModelInfo.deprecated && (
						<ModelInfoView
							apiProvider={apiConfiguration.apiProvider}
							selectedModelId={selectedModelId}
							modelInfo={selectedModelInfo}
							isDescriptionExpanded={isDescriptionExpanded}
							setIsDescriptionExpanded={setIsDescriptionExpanded}
							hidePricing={hidePricing}
						/>
					)}
					{!hidePricing && (
						<div className="text-sm text-vscode-descriptionForeground">
							<Trans
								i18nKey="settings:modelPicker.automaticFetch"
								components={{
									serviceLink: <VSCodeLink href={serviceUrl} className="text-sm" />,
									defaultModelLink: (
										<VSCodeLink onClick={() => onSelect(defaultModelId)} className="text-sm" />
									),
								}}
								values={{ serviceName, defaultModelId }}
							/>
						</div>
					)}
				</div>
			)}
		</>
	)
}

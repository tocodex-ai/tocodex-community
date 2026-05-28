import React, { useMemo, useState, useCallback, useEffect } from "react"
import {
	VSCodeCheckbox,
	VSCodeTextField,
	VSCodeDropdown,
	VSCodeOption,
	VSCodeButton,
} from "@vscode/webview-ui-toolkit/react"
import {
	DEFAULT_IMAGE_GENERATION_MODELS,
	IMAGE_SIZE_PRESETS,
	DEFAULT_IMAGE_SIZE,
	DEFAULT_CUSTOM_IMAGE_BASE_URL,
	type ImageGenerationModel,
	type ImageGenerationProvider,
	getImageGenerationProvider,
} from "@roo-code/types"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface ImageGenerationSettingsProps {
	enabled: boolean
	onChange: (enabled: boolean) => void
	imageGenerationProvider?: ImageGenerationProvider
	openRouterImageApiKey?: string
	openRouterImageGenerationSelectedModel?: string
	imageGenerationModels?: ImageGenerationModel[]
	imageGenerationSize?: string
	customImageBaseUrl?: string
	customImageApiKey?: string
	setImageGenerationProvider: (provider: ImageGenerationProvider) => void
	setOpenRouterImageApiKey: (apiKey: string) => void
	setCustomImageBaseUrl: (baseUrl: string) => void
	setCustomImageApiKey: (apiKey: string) => void
	setImageGenerationSelectedModel: (model: string) => void
	setImageGenerationSize: (size: string) => void
}

export const ImageGenerationSettings = ({
	enabled,
	onChange,
	imageGenerationProvider,
	openRouterImageApiKey,
	openRouterImageGenerationSelectedModel,
	imageGenerationModels,
	imageGenerationSize,
	customImageBaseUrl,
	customImageApiKey,
	setImageGenerationProvider,
	setOpenRouterImageApiKey,
	setCustomImageBaseUrl,
	setCustomImageApiKey,
	setImageGenerationSelectedModel,
	setImageGenerationSize,
}: ImageGenerationSettingsProps) => {
	const { t } = useAppTranslation()

	// 使用从配置文件加载的模型列表，不存在时回退到内置默认值
	const models = imageGenerationModels ?? DEFAULT_IMAGE_GENERATION_MODELS

	// Use shared utility for backwards compatibility logic
	const currentProvider = getImageGenerationProvider(
		imageGenerationProvider,
		!!openRouterImageGenerationSelectedModel,
	)

	const availableModels = useMemo(() => {
		return models.filter((model) => model.provider === currentProvider)
	}, [currentProvider, models])

	// Derive the current model value - either from props or first available
	const currentModel = useMemo(() => {
		if (openRouterImageGenerationSelectedModel) {
			const modelInfo = models.find(
				(m) => m.value === openRouterImageGenerationSelectedModel && m.provider === currentProvider,
			)
			if (modelInfo) {
				return openRouterImageGenerationSelectedModel
			}
		}
		return availableModels[0]?.value || models[0]?.value || ""
	}, [openRouterImageGenerationSelectedModel, availableModels, currentProvider, models])

	// 尺寸相关状态
	const currentSize = imageGenerationSize || DEFAULT_IMAGE_SIZE
	const [isCustomSize, setIsCustomSize] = useState(() => {
		// 检查当前尺寸是否匹配预设
		return !IMAGE_SIZE_PRESETS.some((p) => `${p.width}x${p.height}` === currentSize)
	})

	const parsedSize = useMemo(() => {
		const parts = currentSize.split("x")
		return {
			width: parseInt(parts[0]) || 1024,
			height: parseInt(parts[1]) || 1024,
		}
	}, [currentSize])

	// Handle provider changes
	const handleProviderChange = (value: string) => {
		const newProvider = value as ImageGenerationProvider
		setImageGenerationProvider(newProvider)

		const providerModels = models.filter((m) => m.provider === newProvider)
		if (providerModels.length > 0) {
			// Check if current model exists for new provider
			const currentModelForNewProvider = providerModels.find(
				(m) => m.value === openRouterImageGenerationSelectedModel,
			)
			if (currentModelForNewProvider) {
				// Current model exists for new provider, keep it
				// No need to call setImageGenerationSelectedModel since the value doesn't change
			} else {
				// Current model doesn't exist for new provider, switch to first available
				setImageGenerationSelectedModel(providerModels[0].value)
			}
		}
	}

	// Handle API key changes
	const handleApiKeyChange = (value: string) => {
		setOpenRouterImageApiKey(value)
	}

	const handleCustomBaseUrlChange = (value: string) => {
		setCustomImageBaseUrl(value)
	}

	const handleCustomApiKeyChange = (value: string) => {
		setCustomImageApiKey(value)
	}

	// 自定义模型输入状态
	const [customModelInput, setCustomModelInput] = useState("")
	const [isCustomModel, setIsCustomModel] = useState(() => {
		// 自定义 provider 没有预设模型，强制使用自定义输入
		if (currentProvider === "custom") return true
		// 检查当前选中的模型是否不在预设列表中
		if (!openRouterImageGenerationSelectedModel) return false
		return !models.some((m) => m.value === openRouterImageGenerationSelectedModel && m.provider === currentProvider)
	})

	// 切换到 custom 时自动进入自定义模型输入模式（自定义 provider 没有预设模型列表）
	useEffect(() => {
		if (currentProvider === "custom" && !isCustomModel) {
			setIsCustomModel(true)
		}
	}, [currentProvider, isCustomModel])

	// Handle model selection changes
	const handleModelChange = (value: string) => {
		if (value === "__custom__") {
			setIsCustomModel(true)
			return
		}
		setIsCustomModel(false)
		setImageGenerationSelectedModel(value)
	}

	// Handle custom model input confirm
	const handleCustomModelConfirm = useCallback(() => {
		const trimmed = customModelInput.trim()
		if (trimmed) {
			setImageGenerationSelectedModel(trimmed)
			setIsCustomModel(true)
		}
	}, [customModelInput, setImageGenerationSelectedModel])

	// Handle size preset selection
	const handleSizePresetChange = (value: string) => {
		if (value === "custom") {
			setIsCustomSize(true)
		} else {
			setIsCustomSize(false)
			setImageGenerationSize(value)
		}
	}

	// Handle custom width/height changes
	const handleCustomWidthChange = (width: string) => {
		const w = parseInt(width) || 1024
		setImageGenerationSize(`${w}x${parsedSize.height}`)
	}

	const handleCustomHeightChange = (height: string) => {
		const h = parseInt(height) || 1024
		setImageGenerationSize(`${parsedSize.width}x${h}`)
	}

	const requiresApiKey = currentProvider === "openrouter" || currentProvider === "custom"
	const customBaseUrl = customImageBaseUrl || DEFAULT_CUSTOM_IMAGE_BASE_URL
	const isConfigured =
		currentProvider === "custom"
			? !!customBaseUrl.trim() && !!customImageApiKey
			: !requiresApiKey || (requiresApiKey && openRouterImageApiKey)

	// 按 category 分组的预设
	const presetsByCategory = useMemo(() => {
		const groups: Record<string, typeof IMAGE_SIZE_PRESETS> = {}
		for (const preset of IMAGE_SIZE_PRESETS) {
			if (!groups[preset.category]) {
				groups[preset.category] = []
			}
			groups[preset.category].push(preset)
		}
		return groups
	}, [])

	return (
		<div className="space-y-4">
			<div>
				<div className="flex items-center gap-2">
					<VSCodeCheckbox checked={enabled} onChange={(e: any) => onChange(e.target.checked)}>
						<span className="font-medium">{t("settings:experimental.IMAGE_GENERATION.name")}</span>
					</VSCodeCheckbox>
				</div>
				<p className="text-vscode-descriptionForeground text-sm mt-0">
					{t("settings:experimental.IMAGE_GENERATION.description")}
				</p>
			</div>

			{enabled && (
				<div className="ml-2 space-y-3">
					{/* Provider Selection */}
					<div>
						<label className="block font-medium mb-1">
							{t("settings:experimental.IMAGE_GENERATION.providerLabel")}
						</label>
						<VSCodeDropdown
							value={currentProvider}
							onChange={(e: any) => handleProviderChange(e.target.value)}
							className="w-full">
							<VSCodeOption value="roo" className="py-2 px-3">
								ToCodex Cloud
							</VSCodeOption>
							<VSCodeOption value="openrouter" className="py-2 px-3">
								OpenRouter
							</VSCodeOption>
							<VSCodeOption value="custom" className="py-2 px-3">
								自定义
							</VSCodeOption>
						</VSCodeDropdown>
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:experimental.IMAGE_GENERATION.providerDescription")}
						</p>
					</div>

					{/* API Key Configuration (only for OpenRouter) */}
					{currentProvider === "openrouter" && (
						<div>
							<label className="block font-medium mb-1">
								{t("settings:experimental.IMAGE_GENERATION.openRouterApiKeyLabel")}
							</label>
							<VSCodeTextField
								value={openRouterImageApiKey || ""}
								onInput={(e: any) => handleApiKeyChange(e.target.value)}
								placeholder={t("settings:experimental.IMAGE_GENERATION.openRouterApiKeyPlaceholder")}
								className="w-full"
								type="password"
							/>
							<p className="text-vscode-descriptionForeground text-xs mt-1">
								{t("settings:experimental.IMAGE_GENERATION.getApiKeyText")}{" "}
								<a
									href="https://openrouter.ai/keys"
									target="_blank"
									rel="noopener noreferrer"
									className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
									openrouter.ai/keys
								</a>
							</p>
						</div>
					)}

					{/* Custom Provider Configuration */}
					{currentProvider === "custom" && (
						<div className="space-y-3">
							<div>
								<label className="block font-medium mb-1">自定义生图 URL</label>
								<VSCodeTextField
									value={customBaseUrl}
									onInput={(e: any) => handleCustomBaseUrlChange(e.target.value)}
									placeholder={DEFAULT_CUSTOM_IMAGE_BASE_URL}
									className="w-full"
								/>
								<p className="text-vscode-descriptionForeground text-xs mt-1">
									请输入 OpenAI 兼容的生图 API Base URL，例如{" "}
									<code>{DEFAULT_CUSTOM_IMAGE_BASE_URL}</code>。 工具会请求{" "}
									<code>/images/generations</code> 或 <code>/images/edits</code>。
								</p>
							</div>
							<div>
								<label className="block font-medium mb-1">自定义生图 API Key</label>
								<VSCodeTextField
									value={customImageApiKey || ""}
									onInput={(e: any) => handleCustomApiKeyChange(e.target.value)}
									placeholder="sk-..."
									className="w-full"
									type="password"
								/>
								<p className="text-vscode-descriptionForeground text-xs mt-1">
									该 Key 只用于自定义生图提供商，不影响对话模型配置。
								</p>
							</div>
						</div>
					)}

					{/* Model Selection */}
					<div>
						<label className="block font-medium mb-1">
							{t("settings:experimental.IMAGE_GENERATION.modelSelectionLabel")}
						</label>
						<VSCodeDropdown
							value={isCustomModel ? "__custom__" : currentModel}
							onChange={(e: any) => handleModelChange(e.target.value)}
							className="w-full">
							{availableModels.map((model) => (
								<VSCodeOption key={model.value} value={model.value} className="py-2 px-3">
									{model.label}
								</VSCodeOption>
							))}
							<VSCodeOption value="__custom__" className="py-2 px-3">
								✏️ 自定义模型...
							</VSCodeOption>
						</VSCodeDropdown>
						{/* 自定义模型输入框 */}
						{isCustomModel && (
							<div className="flex gap-2 mt-2">
								<VSCodeTextField
									value={customModelInput || openRouterImageGenerationSelectedModel || ""}
									onInput={(e: any) => setCustomModelInput(e.target.value)}
									placeholder="输入模型名称，如 gpt-image-2"
									className="flex-1"
									onKeyDown={(e: any) => {
										if (e.key === "Enter") handleCustomModelConfirm()
									}}
								/>
								<VSCodeButton appearance="secondary" onClick={handleCustomModelConfirm}>
									确认
								</VSCodeButton>
							</div>
						)}
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:experimental.IMAGE_GENERATION.modelSelectionDescription")}
							{isCustomModel && openRouterImageGenerationSelectedModel && (
								<span className="ml-1">
									当前:{" "}
									<code className="text-vscode-textPreformat-foreground">
										{openRouterImageGenerationSelectedModel}
									</code>
								</span>
							)}
						</p>
					</div>

					{/* Size Selection */}
					<div>
						<label className="block font-medium mb-1">
							{t("settings:experimental.IMAGE_GENERATION.sizeLabel")}
						</label>
						<VSCodeDropdown
							value={isCustomSize ? "custom" : currentSize}
							onChange={(e: any) => handleSizePresetChange(e.target.value)}
							className="w-full">
							{Object.entries(presetsByCategory).map(([category, presets]) => (
								<React.Fragment key={category}>
									{presets.map((preset) => (
										<VSCodeOption
											key={`${preset.width}x${preset.height}`}
											value={`${preset.width}x${preset.height}`}
											className="py-2 px-3">
											{preset.label}
										</VSCodeOption>
									))}
								</React.Fragment>
							))}
							<VSCodeOption value="custom" className="py-2 px-3">
								{t("settings:experimental.IMAGE_GENERATION.customSize")}
							</VSCodeOption>
						</VSCodeDropdown>
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:experimental.IMAGE_GENERATION.sizeDescription")}
						</p>
					</div>

					{/* Custom Size Inputs */}
					{isCustomSize && (
						<div className="flex gap-3">
							<div className="flex-1">
								<label className="block font-medium mb-1">
									{t("settings:experimental.IMAGE_GENERATION.widthLabel")}
								</label>
								<VSCodeTextField
									value={String(parsedSize.width)}
									onInput={(e: any) => handleCustomWidthChange(e.target.value)}
									className="w-full"
								/>
							</div>
							<div className="flex-1">
								<label className="block font-medium mb-1">
									{t("settings:experimental.IMAGE_GENERATION.heightLabel")}
								</label>
								<VSCodeTextField
									value={String(parsedSize.height)}
									onInput={(e: any) => handleCustomHeightChange(e.target.value)}
									className="w-full"
								/>
							</div>
						</div>
					)}

					{/* Status Message */}
					{enabled && !isConfigured && (
						<div className="p-2 bg-vscode-editorWarning-background text-vscode-editorWarning-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.warningMissingKey")}
						</div>
					)}

					{enabled && isConfigured && (
						<div className="p-2 bg-vscode-editorInfo-background text-vscode-editorInfo-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.successConfigured")}
						</div>
					)}
				</div>
			)}
		</div>
	)
}

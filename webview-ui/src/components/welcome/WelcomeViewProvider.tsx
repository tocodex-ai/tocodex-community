import { useCallback, useEffect, useRef, useState } from "react"
import {
	VSCodeLink,
	VSCodeProgressRing,
	VSCodeRadio,
	VSCodeRadioGroup,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import type { ProviderSettings } from "@roo-code/types"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { validateApiConfiguration } from "@src/utils/validate"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button } from "@src/components/ui"

import ApiOptions from "../settings/ApiOptions"
import { Tab, TabContent } from "../common/Tab"

import RooHero from "./RooHero"
import { Trans } from "react-i18next"
import { ArrowLeft, ArrowRight, BadgeInfo, TriangleAlert, X } from "lucide-react"
import { buildDocLink } from "@/utils/docLinks"
import VersionIndicator from "../common/VersionIndicator"

type ProviderOption = "roo" | "custom"
type AuthOrigin = "landing" | "providerSelection"

const WelcomeViewProvider = () => {
	const {
		apiConfiguration,
		currentApiConfigName,
		setApiConfiguration,
		uriScheme,
		cloudIsAuthenticated,
		cloudAuthSkipModel,
	} = useExtensionState()
	const { t } = useAppTranslation()
	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
	const [selectedProvider, setSelectedProvider] = useState<ProviderOption | null>(null)
	const [authInProgress, setAuthInProgress] = useState(false)
	const [authOrigin, setAuthOrigin] = useState<AuthOrigin | null>(null)
	const [showManualEntry, setShowManualEntry] = useState(false)
	const [manualUrl, setManualUrl] = useState("")
	const [manualErrorMessage, setManualErrorMessage] = useState<boolean | undefined>(undefined)
	const manualUrlInputRef = useRef<HTMLInputElement | null>(null)
	const [showApiKeyInput, setShowApiKeyInput] = useState(false)
	const [apiKeyValue, setApiKeyValue] = useState("")
	const apiKeyInputRef = useRef<HTMLInputElement | null>(null)

	// 手动绑定 API Key（官方 key）
	// 后端 rooCloudManualApiKey 会统一处理：存储 key、更新认证状态、清除第三方配置、刷新设置页
	// ⚠️ 严格校验：API Key 必须是 ASCII，长度 >= 20，否则会导致 HTTP Authorization 头部 ByteString 错误
	const handleBindApiKey = useCallback(() => {
		const key = apiKeyValue.trim()
		if (!key) return
		// 1. 必须是纯 ASCII 可见字符（HTTP 头部只接受 ISO-8859-1，中文/emoji 会导致 fetch 抛 ByteString 异常）
		// eslint-disable-next-line no-control-regex
		if (!/^[\x21-\x7E]+$/.test(key)) {
			console.error("[WelcomeView] API Key 含非 ASCII 字符，已拒绝：", JSON.stringify(key))
			alert("API Key 包含中文或特殊字符，无法使用。请粘贴正确的 sk- 开头的官方 Key。")
			setApiKeyValue("")
			return
		}
		// 2. 长度过短大概率是误触（比如按钮文本被错误捕获）
		if (key.length < 16) {
			console.error("[WelcomeView] API Key 长度不足 16，已拒绝：", JSON.stringify(key))
			alert("API Key 长度不足，请粘贴完整的官方 Key（通常以 sk- 开头）。")
			return
		}
		vscode.postMessage({
			type: "rooCloudManualApiKey",
			text: key,
		} as any)
	}, [apiKeyValue])

	// 当认证完成时，清除等待状态（重置供应商由 App.tsx 统一处理）
	useEffect(() => {
		if (cloudIsAuthenticated) {
			setAuthInProgress(false)
			setShowManualEntry(false)
		}
	}, [cloudIsAuthenticated])

	// Focus the manual URL input when it becomes visible
	useEffect(() => {
		if (showManualEntry && manualUrlInputRef.current) {
			setTimeout(() => {
				manualUrlInputRef.current?.focus()
			}, 50)
		}
	}, [showManualEntry])

	// Memoize the setApiConfigurationField function to pass to ApiOptions
	const setApiConfigurationFieldForApiOptions = useCallback(
		<K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => {
			setApiConfiguration({ [field]: value })
		},
		[setApiConfiguration], // setApiConfiguration from context is stable
	)

	const handleGetStarted = useCallback(() => {
		// Landing screen - always trigger auth with Roo
		if (selectedProvider === null) {
			setAuthOrigin("landing")
			vscode.postMessage({ type: "rooCloudSignIn", useProviderSignup: true })
			setAuthInProgress(true)
		}
		// Provider Selection screen
		else if (selectedProvider === "roo") {
			if (cloudIsAuthenticated) {
				// Already authenticated - save config and finish
				const rooConfig: ProviderSettings = {
					apiProvider: "roo",
				}
				vscode.postMessage({
					type: "upsertApiConfiguration",
					text: currentApiConfigName,
					apiConfiguration: rooConfig,
				})
			} else {
				// Need to authenticate
				setAuthOrigin("providerSelection")
				vscode.postMessage({ type: "rooCloudSignIn", useProviderSignup: true })
				setAuthInProgress(true)
			}
		} else {
			// Custom provider - validate first
			const error = apiConfiguration ? validateApiConfiguration(apiConfiguration) : undefined

			if (error) {
				setErrorMessage(error)
				return
			}

			setErrorMessage(undefined)
			vscode.postMessage({ type: "upsertApiConfiguration", text: currentApiConfigName, apiConfiguration })
		}
	}, [selectedProvider, cloudIsAuthenticated, apiConfiguration, currentApiConfigName])

	const handleNoAccount = useCallback(() => {
		// Navigate to Provider Selection, defaulting to Roo option
		setSelectedProvider("roo")
	}, [])

	const handleBackToLanding = useCallback(() => {
		// Return to the landing screen
		setSelectedProvider(null)
		setErrorMessage(undefined)
	}, [])

	const handleGoBack = useCallback(() => {
		setAuthInProgress(false)
		setShowManualEntry(false)
		setManualUrl("")
		setManualErrorMessage(false)

		// Return to the appropriate screen based on origin
		if (authOrigin === "providerSelection") {
			// Keep selectedProvider as-is, user returns to Provider Selection
		} else {
			// Return to Landing
			setSelectedProvider(null)
		}
		setAuthOrigin(null)
	}, [authOrigin])

	const handleManualUrlChange = (e: any) => {
		const url = e.target.value
		setManualUrl(url)

		// Auto-trigger authentication when a complete URL is pasted
		setTimeout(() => {
			if (url.trim() && url.includes("://") && url.includes("/auth/callback")) {
				setManualErrorMessage(false)
				vscode.postMessage({ type: "rooCloudManualUrl", text: url.trim() })
			}
		}, 100)
	}

	const handleSubmit = useCallback(() => {
		const url = manualUrl.trim()
		if (url && url.includes("://") && url.includes("/auth/callback")) {
			setManualErrorMessage(false)
			vscode.postMessage({ type: "rooCloudManualUrl", text: url })
		} else {
			setManualErrorMessage(true)
		}
	}, [manualUrl])

	const handleOpenSignupUrl = () => {
		vscode.postMessage({ type: "rooCloudSignIn", useProviderSignup: false })
	}

	// Render the waiting for cloud state
	if (authInProgress) {
		return (
			<Tab>
				<div className="absolute top-2 right-3 z-10">
					<VersionIndicator />
				</div>
				<TabContent className="flex flex-col gap-4 p-6 justify-center">
					<div className="flex flex-col items-start gap-4 pt-8">
						<VSCodeProgressRing className="size-6" />
						<h2 className="my-0 text-xl font-semibold">{t("welcome:waitingForCloud.heading")}</h2>
						<p className="text-vscode-descriptionForeground mt-0">
							{t("welcome:waitingForCloud.description")}
						</p>

						<div className="flex gap-2 items-start pr-4 text-vscode-descriptionForeground">
							<BadgeInfo className="size-4 inline shrink-0" />
							<p className="m-0">
								<Trans
									i18nKey="welcome:waitingForCloud.noPrompt"
									components={{
										clickHere: (
											<button
												onClick={handleOpenSignupUrl}
												className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline cursor-pointer bg-transparent border-none p-0"
											/>
										),
									}}
								/>
							</p>
						</div>

						<div className="flex gap-2 items-start pr-4 text-vscode-descriptionForeground">
							<TriangleAlert className="size-4 inline shrink-0" />
							<div>
								{!showManualEntry ? (
									<p className="m-0">
										<Trans
											i18nKey="welcome:waitingForCloud.havingTrouble"
											components={{
												clickHere: (
													<button
														onClick={() => setShowManualEntry(true)}
														className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline cursor-pointer bg-transparent border-none p-0	"
													/>
												),
											}}
										/>
									</p>
								) : (
									<div className="w-full max-w-sm">
										<p className="text-vscode-descriptionForeground mt-0">
											{t("welcome:waitingForCloud.pasteUrl")}
										</p>
										<div className="flex gap-2 items-center">
											<VSCodeTextField
												ref={manualUrlInputRef as any}
												value={manualUrl}
												onKeyUp={handleManualUrlChange}
												placeholder="vscode://ToCodex.tocodex/auth/callback?state=..."
												className="flex-1"
											/>
											<Button
												onClick={handleSubmit}
												disabled={manualUrl.length < 40}
												variant="secondary">
												<ArrowRight className="size-4" />
											</Button>
										</div>
										<p className="mt-2">
											<Trans
												i18nKey="welcome:waitingForCloud.docsLink"
												components={{
													DocsLink: (
														<a
															href={buildDocLink("roo-code-cloud/login", "setup")}
															target="_blank"
															rel="noopener noreferrer"
															className="text-vscode-textLink-foreground hover:underline">
															{t("common:docsLink.label")}
														</a>
													),
												}}
											/>
										</p>
										{manualUrl && manualErrorMessage && (
											<p className="text-vscode-errorForeground mt-2">
												{t("welcome:waitingForCloud.invalidURL")}
											</p>
										)}
									</div>
								)}
							</div>
						</div>
					</div>

					<div className="mt-4">
						<Button onClick={handleGoBack} variant="secondary">
							<ArrowLeft className="size-4" />
							{t("welcome:waitingForCloud.goBack")}
						</Button>
					</div>
				</TabContent>
			</Tab>
		)
	}

	// Landing screen - shown when selectedProvider === null
	if (selectedProvider === null) {
		return (
			<Tab>
				{/* 版本号固定在右上角 */}
				<div className="absolute top-2 right-3 z-10">
					<VersionIndicator />
				</div>
				<TabContent className="relative flex flex-col gap-4 p-6 justify-center welcome-glow-bg">
					{/* 整体内容上移 100px */}
					<div className="flex flex-col gap-4 -mt-[100px]">
						<RooHero />
						<h2 className="mt-0 mb-0 text-xl w-full">{t("welcome:landing.greeting")}</h2>

						<div className="space-y-4 leading-normal">
							<p className="text-base text-vscode-foreground">{t("welcome:landing.introduction")}</p>
							<p className="mb-0 font-semibold">{t("welcome:landing.accountMention")}</p>
						</div>

						<div className="mt-2 flex gap-2 items-center">
							<Button onClick={handleGetStarted} variant="primary">
								{t("welcome:landing.getStarted")}
							</Button>
							<VSCodeLink onClick={handleNoAccount} className="cursor-pointer">
								{t("welcome:landing.noAccount")}
							</VSCodeLink>
						</div>

						{/* 手动绑定 API Key */}
						<div className="mt-4 space-y-2">
							<div className="flex items-center gap-2">
								<button
									onClick={() => setShowApiKeyInput(!showApiKeyInput)}
									className="cursor-pointer bg-transparent border-none p-0 text-vscode-textLink-foreground hover:underline text-sm">
									{t("welcome:landing.bindApiKey")}
								</button>
								<span className="text-vscode-descriptionForeground text-xs">|</span>
								<VSCodeLink href="https://ruteapi.com/console/token" className="text-sm">
									{t("welcome:landing.howToGetKey")}
								</VSCodeLink>
							</div>
							{showApiKeyInput && (
								<div className="flex gap-2 items-center w-full">
									<VSCodeTextField
										ref={apiKeyInputRef as any}
										value={apiKeyValue}
										onInput={(e: any) => setApiKeyValue(e.target.value)}
										placeholder="sk-..."
										className="flex-1"
									/>
									<Button
										onClick={handleBindApiKey}
										disabled={!apiKeyValue.trim()}
										variant="secondary">
										{t("welcome:landing.bind")}
									</Button>
									{apiKeyValue && (
										<button
											onClick={() => setApiKeyValue("")}
											className="cursor-pointer bg-transparent border-none p-0.5 text-vscode-descriptionForeground hover:text-vscode-foreground"
											title="Clear">
											<X className="size-3.5" />
										</button>
									)}
								</div>
							)}
						</div>
					</div>
				</TabContent>
			</Tab>
		)
	}

	// Provider Selection screen - shown when selectedProvider is "roo" or "custom"
	return (
		<Tab>
			<div className="absolute top-2 right-3 z-10">
				<VersionIndicator />
			</div>
			<TabContent className="flex flex-col gap-4 p-6 justify-center">
				<RooHero />
				<h2 className="mt-0 mb-0 text-xl">{t("welcome:providerSignup.heading")}</h2>

				<p className="text-base text-vscode-foreground">
					<Trans i18nKey="welcome:providerSignup.chooseProvider" />
				</p>

				<div>
					<VSCodeRadioGroup
						value={selectedProvider}
						onChange={(e: Event | React.FormEvent<HTMLElement>) => {
							const target = ((e as CustomEvent)?.detail?.target ||
								(e.target as HTMLInputElement)) as HTMLInputElement
							setSelectedProvider(target.value as ProviderOption)
						}}>
						{/* ToCodex Option */}
						<VSCodeRadio value="roo" className="flex items-start gap-2">
							<div className="flex-1 space-y-1 cursor-pointer">
								<p className="text-lg font-semibold block -mt-1">
									{t("welcome:providerSignup.rooCloudProvider")}
								</p>
								<p className="text-base text-vscode-descriptionForeground mt-0">
									{t("welcome:providerSignup.rooCloudDescription")}{" "}
									<VSCodeLink href="https://ruteapi.com" className="cursor-pointer">
										{t("welcome:providerSignup.learnMore")}
									</VSCodeLink>
								</p>
							</div>
						</VSCodeRadio>

						{/* Use Another Provider Option */}
						<VSCodeRadio value="custom" className="flex items-start gap-2">
							<div className="flex-1 space-y-1 cursor-pointer">
								<p className="text-lg font-semibold block -mt-1">
									{t("welcome:providerSignup.useAnotherProvider")}
								</p>
								<p className="text-base text-vscode-descriptionForeground mt-0">
									{t("welcome:providerSignup.useAnotherProviderDescription")}
								</p>
							</div>
						</VSCodeRadio>
					</VSCodeRadioGroup>

					{/* Expand API options only when custom provider is selected, max height is used to force a transition */}
					<div className="mb-8 border-l-2 border-vscode-panel-border pl-6 ml-[7px]">
						<div
							className={`overflow-clip transition-[max-height] ease-in-out duration-300 ${selectedProvider === "custom" ? "max-h-[600px]" : "max-h-0"}`}>
							<ApiOptions
								fromWelcomeView
								apiConfiguration={apiConfiguration || {}}
								uriScheme={uriScheme}
								setApiConfigurationField={setApiConfigurationFieldForApiOptions}
								errorMessage={errorMessage}
								setErrorMessage={setErrorMessage}
							/>
						</div>
					</div>
				</div>

				<div className="-mt-4 flex gap-2">
					<Button onClick={handleBackToLanding} variant="secondary">
						<ArrowLeft className="size-4" />
						{t("welcome:providerSignup.goBack")}
					</Button>
					<Button onClick={handleGetStarted} variant="primary">
						{t("welcome:providerSignup.finish")} →
					</Button>
				</div>
			</TabContent>
		</Tab>
	)
}

export default WelcomeViewProvider

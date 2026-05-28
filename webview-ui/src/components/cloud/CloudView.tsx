import { useCallback, useEffect, useRef, useState } from "react"

import type { CloudUserInfo } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { ArrowRight, LogOut, User, KeyRound, ExternalLink, Eye, EyeOff, X, Copy } from "lucide-react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Tab, TabContent } from "../common/Tab"
import { Button } from "@/components/ui/button"
import RooHero from "../welcome/RooHero"

type CloudViewProps = {
	userInfo: CloudUserInfo | null
	isAuthenticated: boolean
	onBackToChat?: () => void
	onShowWelcome?: () => void
}

export const CloudView = ({ userInfo, isAuthenticated, onBackToChat, onShowWelcome }: CloudViewProps) => {
	const { t } = useAppTranslation()
	const wasAuthenticatedRef = useRef(false)
	const [authInProgress, setAuthInProgress] = useState(false)
	const [showApiKey, setShowApiKey] = useState(false)
	const [storedApiKey, setStoredApiKey] = useState("")
	const [showBindInput, setShowBindInput] = useState(false)
	const [apiKeyInput, setApiKeyInput] = useState("")
	const [apiKeyEdited, setApiKeyEdited] = useState(false)

	useEffect(() => {
		if (isAuthenticated) {
			wasAuthenticatedRef.current = true
			setAuthInProgress(false)
			// 请求获取当前存储的 API Key
			vscode.postMessage({ type: "getApiKey" } as any)
		} else if (wasAuthenticatedRef.current && !isAuthenticated) {
			wasAuthenticatedRef.current = false
			setStoredApiKey("")
		}
	}, [isAuthenticated])

	// 监听来自扩展的消息
	useEffect(() => {
		const handler = (e: MessageEvent) => {
			const msg = e.data
			if (msg.type === "apiKeyValue" && msg.text) {
				setStoredApiKey(msg.text)
				// 只有当用户没有手动编辑且输入框为空时，才回填登录获取的密钥
				if (!apiKeyEdited && !apiKeyInput.trim()) {
					setApiKeyInput(msg.text)
				}
			}
		}
		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [apiKeyEdited, apiKeyInput])

	const handleConnectClick = () => {
		vscode.postMessage({ type: "rooCloudSignIn" })
		setAuthInProgress(true)
	}

	const handleLogoutClick = () => {
		vscode.postMessage({ type: "rooCloudSignOut" })
		setStoredApiKey("")
		setApiKeyInput("")
		setApiKeyEdited(false)
	}

	const handleVisitWebsite = () => {
		vscode.postMessage({ type: "openExternal", url: "https://tocodex.com" })
	}

	const handleRegister = () => {
		vscode.postMessage({ type: "openExternal", url: "https://tocodex.com/register" })
	}

	const handleBindApiKey = useCallback(() => {
		const key = apiKeyInput.trim()
		if (!key) return
		vscode.postMessage({
			type: "rooCloudManualApiKey",
			text: key,
		} as any)
		setStoredApiKey(key)
		setApiKeyEdited(false)
		setShowBindInput(false)
	}, [apiKeyInput])

	const handleSaveApiKey = useCallback(() => {
		const key = apiKeyInput.trim()
		if (key === storedApiKey) return
		if (!key) {
			// 保存空密钥 = 清除密钥并登出
			vscode.postMessage({ type: "rooCloudSignOut" })
			setStoredApiKey("")
			setApiKeyEdited(false)
			return
		}
		vscode.postMessage({
			type: "rooCloudManualApiKey",
			text: key,
		} as any)
		setStoredApiKey(key)
		setApiKeyEdited(false)
	}, [apiKeyInput, storedApiKey])

	return (
		<Tab>
			<TabContent className="">
				{isAuthenticated ? (
					<div className="flex flex-col items-center px-4 max-w-lg mx-auto w-full">
						{/* 动画 Logo 居中 */}
						<RooHero />
						{/* 下方内容 */}
						<div className="mt-[50px] w-full flex flex-col items-start">
							{/* 用户信息 */}
							<div className="flex items-center gap-3 mb-6">
								<div className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center bg-vscode-button-background text-vscode-button-foreground">
									{userInfo?.picture ? (
										<img
											src={userInfo.picture}
											alt={userInfo?.name || "User"}
											className="w-full h-full object-cover"
										/>
									) : (
										<User className="size-6" />
									)}
								</div>
								<div>
									<h2 className="text-lg font-medium text-vscode-foreground my-0">
										{userInfo?.name || t("cloud:title")}
									</h2>
									{userInfo?.email && (
										<p className="text-sm text-vscode-descriptionForeground my-0">
											{userInfo.email}
										</p>
									)}
								</div>
							</div>

							{/* API Key 输入框 - 可查看/编辑/保存 */}
							<div className="w-full p-3 rounded border border-vscode-widget-border mb-6">
								{/* 分组和额度信息 */}
								{(userInfo?.group || userInfo?.quota != null) && (
									<div className="flex items-center gap-4 text-sm mb-3 pb-3 border-b border-vscode-widget-border">
										{userInfo?.group && (
											<div className="flex items-center gap-1">
												<span className="text-vscode-descriptionForeground">
													{t("cloud:group")}:
												</span>
												<span className="text-vscode-foreground font-medium">
													{userInfo.group}
												</span>
											</div>
										)}
										{userInfo?.quota != null && (
											<div className="flex flex-col gap-0.5">
												<div className="flex items-center gap-1">
													<span className="text-vscode-descriptionForeground">
														{t("cloud:quota")}:
													</span>
													<span className="text-vscode-foreground font-medium">
														{userInfo.usedQuota ?? 0} /{" "}
														{userInfo.quota === 0 ? "∞" : userInfo.quota}
													</span>
												</div>
												<span className="text-xs text-vscode-descriptionForeground">
													{t("cloud:quotaNote")}
												</span>
											</div>
										)}
									</div>
								)}
								<div className="flex items-center gap-2 text-sm text-vscode-foreground mb-2">
									<KeyRound className="size-4 text-vscode-descriptionForeground" />
									<span>API Key</span>
									<span className="ml-auto text-green-500">●</span>
									<span className="text-vscode-descriptionForeground">{t("cloud:connected")}</span>
								</div>
								<div className="flex items-center gap-2">
									<input
										type={showApiKey ? "text" : "password"}
										value={apiKeyInput}
										onChange={(e) => {
											setApiKeyInput(e.target.value)
											setApiKeyEdited(e.target.value !== storedApiKey)
										}}
										placeholder="sk-..."
										className="flex-1 text-xs bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1 focus:outline-none focus:border-vscode-focusBorder"
									/>
									<button
										onClick={() => setShowApiKey(!showApiKey)}
										className="cursor-pointer bg-transparent border-none p-1 text-vscode-descriptionForeground hover:text-vscode-foreground"
										title={showApiKey ? "Hide" : "Show"}>
										{showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
									</button>
									<button
										onClick={() => {
											if (apiKeyInput) {
												navigator.clipboard.writeText(apiKeyInput)
											}
										}}
										className="cursor-pointer bg-transparent border-none p-1 text-vscode-descriptionForeground hover:text-vscode-foreground"
										title="Copy">
										<Copy className="size-4" />
									</button>
									{apiKeyInput && (
										<button
											onClick={() => {
												setApiKeyInput("")
												setApiKeyEdited("" !== storedApiKey)
											}}
											className="cursor-pointer bg-transparent border-none p-1 text-vscode-descriptionForeground hover:text-vscode-foreground"
											title="Clear">
											<X className="size-4" />
										</button>
									)}
									{apiKeyEdited && (
										<Button
											onClick={handleSaveApiKey}
											variant="secondary"
											className="text-xs px-2 py-1">
											{t("cloud:save")}
										</Button>
									)}
								</div>
							</div>

							{/* 操作按钮 */}
							<div className="flex flex-col gap-2 w-full">
								{onBackToChat && (
									<Button variant="primary" onClick={onBackToChat} className="w-full max-w-80">
										<ArrowRight className="size-4 mr-1" />
										{t("cloud:backToChat")}
									</Button>
								)}
								<Button variant="secondary" onClick={handleVisitWebsite} className="w-full max-w-80">
									<ExternalLink className="size-4 mr-1" />
									{t("cloud:visitCloudWebsite")}
								</Button>
								<Button variant="secondary" onClick={handleLogoutClick} className="w-full max-w-80">
									<LogOut className="size-4 mr-1" />
									{t("cloud:logOut")}
								</Button>
							</div>
						</div>
					</div>
				) : (
					<div className="flex flex-col items-start gap-6 px-4 max-w-lg">
						{/* ToCodex 标题和描述 */}
						<div>
							<h1 className="text-xl font-bold text-vscode-foreground mb-2">
								{t("cloud:tocodexAccountTitle")}
							</h1>
							<p className="text-base text-vscode-descriptionForeground">
								{t("cloud:tocodexAccountDescription")}
							</p>
						</div>

						{/* 登录按钮 */}
						{!authInProgress ? (
							<div className="flex flex-col gap-3 w-full">
								<Button variant="primary" onClick={handleConnectClick}>
									{t("cloud:signIn")}
									<ArrowRight className="ml-1" />
								</Button>

								{/* 手动绑定 API Key */}
								<div className="mt-2 space-y-2">
									<div className="flex items-center gap-3">
										<button
											onClick={() => setShowBindInput(!showBindInput)}
											className="cursor-pointer bg-transparent border-none p-0 text-vscode-textLink-foreground hover:underline text-sm">
											{t("cloud:bindApiKey")}
										</button>
									</div>
									{showBindInput && (
										<div className="flex gap-2 items-center">
											<VSCodeTextField
												value={apiKeyInput}
												onInput={(e: any) => setApiKeyInput(e.target.value)}
												placeholder="sk-..."
												className="flex-1"
											/>
											<Button
												onClick={handleBindApiKey}
												disabled={!apiKeyInput.trim()}
												variant="secondary">
												{t("cloud:bind")}
											</Button>
											{apiKeyInput && (
												<button
													onClick={() => setApiKeyInput("")}
													className="cursor-pointer bg-transparent border-none p-0.5 text-vscode-descriptionForeground hover:text-vscode-foreground"
													title="Clear">
													<X className="size-4" />
												</button>
											)}
										</div>
									)}
								</div>

								<p className="text-sm text-vscode-descriptionForeground">
									{t("cloud:noAccount")}{" "}
									<button
										onClick={handleRegister}
										className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline cursor-pointer bg-transparent border-none p-0 text-sm">
										{t("cloud:register")}
									</button>
								</p>
							</div>
						) : (
							<div className="flex flex-col items-start gap-2">
								<div className="flex items-center gap-2 text-base text-vscode-descriptionForeground">
									<span className="animate-pulse">●</span>
									{t("cloud:authWaiting")}
								</div>
								<button
									onClick={() => setAuthInProgress(false)}
									className="text-sm text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline cursor-pointer bg-transparent border-none p-0">
									{t("cloud:startOver")}
								</button>
							</div>
						)}
					</div>
				)}
			</TabContent>
		</Tab>
	)
}

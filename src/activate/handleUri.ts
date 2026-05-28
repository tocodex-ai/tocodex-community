import * as vscode from "vscode"

import { CloudService, WebAuthService } from "@roo-code/cloud"

import { ClineProvider } from "../core/webview/ClineProvider"

/**
 * 解析回调 URI 的 query 参数，处理可能的双重编码
 */
function parseCallbackQuery(rawQuery: string): URLSearchParams {
	// 先尝试正常解析
	let query = new URLSearchParams(rawQuery.replace(/\+/g, "%2B"))

	// 如果 code 参数存在且有效，直接返回
	if (query.get("code") && query.get("state")) {
		return query
	}

	// 尝试 URL 解码后再解析（处理双重编码）
	try {
		const decoded = decodeURIComponent(rawQuery)
		query = new URLSearchParams(decoded.replace(/\+/g, "%2B"))
		if (query.get("code") && query.get("state")) {
			return query
		}
	} catch {
		// 忽略解码错误
	}

	// 尝试手动解析（处理格式异常的 query string）
	try {
		const params = new URLSearchParams()
		// 匹配 code=xxx 模式
		const codeMatch = rawQuery.match(/code[=％]([^&％]+)/i)
		const stateMatch = rawQuery.match(/state[=％]([^&％]+)/i)
		const usernameMatch = rawQuery.match(/username[=％]([^&％]+)/i)
		const displayNameMatch = rawQuery.match(/display_name[=％]([^&％]+)/i)
		const groupMatch = rawQuery.match(/group[=％]([^&％]+)/i)
		const quotaMatch = rawQuery.match(/quota[=％]([^&％]+)/i)
		const usedQuotaMatch = rawQuery.match(/used_quota[=％]([^&％]+)/i)

		if (codeMatch) params.set("code", decodeURIComponent(codeMatch[1]))
		if (stateMatch) params.set("state", decodeURIComponent(stateMatch[1]))
		if (usernameMatch) params.set("username", decodeURIComponent(usernameMatch[1]))
		if (displayNameMatch) params.set("display_name", decodeURIComponent(displayNameMatch[1]))
		if (groupMatch) params.set("group", decodeURIComponent(groupMatch[1]))
		if (quotaMatch) params.set("quota", decodeURIComponent(quotaMatch[1]))
		if (usedQuotaMatch) params.set("used_quota", decodeURIComponent(usedQuotaMatch[1]))

		return params
	} catch {
		return query
	}
}

async function handleAuthCallback(query: URLSearchParams) {
	const code = query.get("code")
	const state = query.get("state")
	const username = query.get("username")
	const displayName = query.get("display_name")
	const group = query.get("group")
	const quota = query.get("quota")
	const usedQuota = query.get("used_quota")

	console.log("[handleUri] Auth callback params:", {
		hasCode: !!code,
		hasState: !!state,
		username,
		displayName,
		group,
		quota,
		usedQuota,
	})

	if (!code) {
		console.error("[handleUri] No code in auth callback")
		vscode.window.showErrorMessage("[ToCodex Auth] 回调中没有 code 参数")
		return
	}

	try {
		await CloudService.instance.handleAuthCallback(code, state)

		if (username || displayName || group || quota || usedQuota) {
			const authService = CloudService.instance.authService
			if (authService && authService instanceof WebAuthService) {
				await authService.setUserInfoFromCallback(
					username ?? undefined,
					displayName ?? undefined,
					group ?? undefined,
					quota != null ? Number(quota) : undefined,
					usedQuota != null ? Number(usedQuota) : undefined,
				)
			}
		}

		// 认证成功后只投递完整 state。上一版登录正常依赖的就是 state 刷新链路，
		// 不额外发送 authenticatedUser，避免无 userInfo 的回调把前端认证态覆盖成 false。
		const refreshWebview = async () => {
			const provider = await ClineProvider.getInstance()
			if (provider) {
				await provider.postStateToWebview()
				console.log("[handleUri] Auth success, webview state refreshed")
				return true
			}
			return false
		}

		// 立即尝试一次
		if (!(await refreshWebview())) {
			console.warn("[handleUri] Auth success but no ClineProvider on first attempt, will retry")
		}

		// 延迟重试 2 次（500ms 和 1500ms），确保 webview 可见后能收到状态
		setTimeout(async () => {
			try {
				await refreshWebview()
			} catch (e) {
				console.warn("[handleUri] Retry 1 failed:", e)
			}
		}, 500)
		setTimeout(async () => {
			try {
				await refreshWebview()
			} catch (e) {
				console.warn("[handleUri] Retry 2 failed:", e)
			}
		}, 1500)

		vscode.window.showInformationMessage("ToCodex 登录成功！")
	} catch (error) {
		console.error("[handleUri] Error handling auth callback:", error)
		const errMsg = error instanceof Error ? error.message : String(error)
		vscode.window.showErrorMessage(`[ToCodex Auth] 登录回调处理失败: ${errMsg}`)
	}
}

export const handleUri = async (uri: vscode.Uri) => {
	const path = uri.path
	const rawQuery = uri.query

	// 入口诊断日志 — 如果能看到这条消息，说明 URI 回调到达了扩展
	console.log("[handleUri] ★ Received URI:", uri.toString())
	console.log("[handleUri] path:", JSON.stringify(path), "query:", rawQuery)

	const query = parseCallbackQuery(rawQuery)

	// Auth callback 路径不需要 visibleProvider，直接处理
	// 这对桌面壳 tocodex:// 协议回调尤其重要
	if (path === "/auth/callback" || path.startsWith("/auth/")) {
		console.log("[handleUri] Matched /auth/ path, handling auth callback")
		await handleAuthCallback(query)
		return
	}

	// 桌面壳 OAuth 回调：tocodex://tocodex-community.tocodex?code=xxx&state=yyy
	// 服务器直接把 code/state 拼到 auth_redirect 后面，没有 /auth/callback 路径
	if ((!path || path === "/") && query.get("code") && query.get("state")) {
		console.log("[handleUri] Empty path with code+state, treating as auth callback")
		await handleAuthCallback(query)
		return
	}

	// 其他路径需要 visibleProvider
	const visibleProvider = ClineProvider.getVisibleInstance()
	if (!visibleProvider) {
		console.error("[handleUri] No visible provider")
		return
	}

	switch (path) {
		case "/openrouter": {
			const code = query.get("code")
			if (code) {
				await visibleProvider.handleOpenRouterCallback(code)
			}
			break
		}
		case "/requesty": {
			const code = query.get("code")
			const baseUrl = query.get("baseUrl")
			if (code) {
				await visibleProvider.handleRequestyCallback(code, baseUrl)
			}
			break
		}
	}
}

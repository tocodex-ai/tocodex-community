import EventEmitter from "events"
import type { Disposable, ExtensionContext } from "vscode"
import type { AuthState, CloudServiceEvents, CloudUserInfo } from "@roo-code/types"

type HandlerMap = Partial<{
	"auth-state-changed": (data: { state: AuthState; previousState: AuthState }) => void | Promise<void>
	"settings-updated": () => void | Promise<void>
	"user-info": (data: { userInfo: CloudUserInfo }) => void | Promise<void>
}>

class CommunityAuthService extends EventEmitter {
	private state: AuthState = "logged-out"
	private apiKey: string | null = null
	private userInfo: CloudUserInfo | null = null
	private readonly secretKey = "tocodex-community-api-key"

	constructor(
		private readonly context: ExtensionContext,
		private readonly log: (...args: unknown[]) => void = () => {},
	) {
		super()
	}

	async initialize(): Promise<void> {
		this.apiKey = (await this.context.secrets.get(this.secretKey)) ?? null
		this.changeState(this.apiKey ? "active-session" : "logged-out")
	}

	async login(): Promise<void> {
		const vscode = await import("vscode")
		await vscode.env.openExternal(vscode.Uri.parse(getToCodexWebsiteUrl()))
		this.changeState(this.apiKey ? "active-session" : "logged-out")
	}

	async logout(): Promise<void> {
		this.apiKey = null
		this.userInfo = null
		await this.context.secrets.delete(this.secretKey)
		this.changeState("logged-out")
	}

	isAuthenticated(): boolean {
		return this.state === "active-session"
	}
	hasActiveSession(): boolean {
		return this.isAuthenticated()
	}
	hasOrIsAcquiringActiveSession(): boolean {
		return this.isAuthenticated()
	}
	getUserInfo(): CloudUserInfo | null {
		return this.userInfo
	}
	getSessionToken(): string | undefined {
		return this.apiKey ?? undefined
	}
	getState(): AuthState {
		return this.state
	}
	broadcast(): void {}

	async handleCallback(code: string | null, _state: string | null): Promise<void> {
		if (!code) return
		this.apiKey = code.startsWith("sk-") ? code : `sk-${code}`
		await this.context.secrets.store(this.secretKey, this.apiKey)
		this.changeState("active-session")
	}

	async setManualApiKey(apiKey: string): Promise<void> {
		this.apiKey = apiKey
		await this.context.secrets.store(this.secretKey, apiKey)
		this.changeState("active-session")
	}

	async setUserInfoFromCallback(
		username?: string,
		displayName?: string,
		group?: string,
		quota?: number,
		usedQuota?: number,
	): Promise<void> {
		this.userInfo = { name: displayName || username, group, quota, usedQuota }
		this.emit("user-info", { userInfo: this.userInfo })
	}

	private changeState(next: AuthState): void {
		const previousState = this.state
		this.state = next
		this.emit("auth-state-changed", { state: next, previousState })
	}
}

class CommunitySettingsService extends EventEmitter {
	async initialize(): Promise<void> {}
	getSettings(): null {
		return null
	}
	getAllowList(): null {
		return null
	}
	getUserSettingsConfig(): null {
		return null
	}
	getUserSettingsData(): null {
		return null
	}
	getOrganizationSettings() {
		return { version: 1, providerProfiles: {}, defaultSettings: {}, allowList: { allowAll: true, providers: {} } }
	}
	getUserFeatures(): null {
		return null
	}
	isTaskSyncEnabled(): boolean {
		return false
	}
	isTaskShareEnabled(): boolean {
		return false
	}
	isSettingsSyncEnabled(): boolean {
		return false
	}
	isTelemetryEnabled(): boolean {
		return false
	}
	dispose(): void {}
}

class CommunityShareService {
	async shareTask(): Promise<{ success: boolean; shareUrl?: string; error?: string }> {
		return { success: false, error: "Task sharing is disabled in ToCodex Community." }
	}
	async updateTaskVisibility(): Promise<null> {
		return null
	}
}

class CommunityCloudAPI {
	async creditBalance(): Promise<null> {
		return null
	}
}
class CommunityTelemetryClient {
	setProvider(): void {}
	updateTelemetryState(): void {}
	capture(): void {}
	captureException(): void {}
	shutdown(): void {}
}

export class WebAuthService extends CommunityAuthService {}

export class CloudService extends EventEmitter<CloudServiceEvents> implements Disposable {
	private static _instance: CloudService | null = null
	public readonly authService: CommunityAuthService
	public readonly settingsService: CommunitySettingsService
	public readonly telemetryClient: CommunityTelemetryClient
	public readonly shareService: CommunityShareService
	public readonly cloudAPI: CommunityCloudAPI

	private constructor(context: ExtensionContext, log?: (...args: unknown[]) => void) {
		super()
		this.authService = new CommunityAuthService(context, log)
		this.settingsService = new CommunitySettingsService()
		this.telemetryClient = new CommunityTelemetryClient()
		this.shareService = new CommunityShareService()
		this.cloudAPI = new CommunityCloudAPI()
		this.authService.on("auth-state-changed", (data) => this.emit("auth-state-changed", data))
		this.authService.on("user-info", (data) => this.emit("user-info", data))
		this.settingsService.on("settings-updated", (data) => this.emit("settings-updated", data))
	}

	static async createInstance(
		context: ExtensionContext,
		log?: (...args: unknown[]) => void,
		handlers?: HandlerMap,
	): Promise<CloudService> {
		const instance = new CloudService(context, log)
		this._instance = instance
		if (handlers?.["auth-state-changed"]) instance.on("auth-state-changed", handlers["auth-state-changed"])
		if (handlers?.["settings-updated"]) instance.on("settings-updated", handlers["settings-updated"])
		if (handlers?.["user-info"]) instance.on("user-info", handlers["user-info"])
		await instance.initialize()
		return instance
	}

	static get instance(): CloudService {
		if (!this._instance) throw new Error("CloudService has not been initialized")
		return this._instance
	}

	static hasInstance(): boolean {
		return this._instance !== null
	}
	static isEnabled(): boolean {
		return false
	}
	async initialize(): Promise<void> {
		await this.authService.initialize()
		await this.settingsService.initialize()
	}
	async login(..._args: unknown[]): Promise<void> {
		return this.authService.login()
	}
	async logout(): Promise<void> {
		return this.authService.logout()
	}
	isAuthenticated(): boolean {
		return this.authService.isAuthenticated()
	}
	hasActiveSession(): boolean {
		return this.authService.hasActiveSession()
	}
	hasOrIsAcquiringActiveSession(): boolean {
		return this.authService.hasOrIsAcquiringActiveSession()
	}
	getUserInfo(): CloudUserInfo | null {
		return this.authService.getUserInfo()
	}
	getOrganizationId(): string | null {
		return null
	}
	getStoredOrganizationId(): string | null {
		return null
	}
	getOrganizationSettings() {
		return { version: 1, providerProfiles: {}, defaultSettings: {}, allowList: { allowAll: true, providers: {} } }
	}
	getOrganizationMemberships(): [] {
		return []
	}
	getAllowList() {
		return { allowAll: true, providers: {} }
	}
	canShareTask(): boolean {
		return false
	}
	canSharePublicly(): boolean {
		return false
	}
	isTaskSyncEnabled(): boolean {
		return false
	}
	captureEvent(..._args: unknown[]): void {}
	async shareTask(..._args: unknown[]): Promise<{ success: boolean; shareUrl?: string; error?: string }> {
		return { success: false, error: "Task sharing is disabled in ToCodex Community." }
	}
	async updateUserSettings(..._args: unknown[]): Promise<null> {
		return null
	}
	async switchOrganization(..._args: unknown[]): Promise<null> {
		return null
	}
	async handleAuthCallback(code: string | null, state: string | null, ..._args: unknown[]): Promise<void> {
		return this.authService.handleCallback(code, state)
	}
	dispose(): void {
		this.removeAllListeners()
		CloudService._instance = null
	}
}

export const getRooCodeApiUrl = () => "https://ruteapi.com"
export const getRooCodeWebsiteUrl = () => "https://ruteapi.com"
export const getToCodexApiUrl = () => "https://ruteapi.com"
export const getToCodexWebsiteUrl = () => "https://ruteapi.com"
export const getClerkBaseUrl = () => ""
export const PRODUCTION_CLERK_BASE_URL = ""

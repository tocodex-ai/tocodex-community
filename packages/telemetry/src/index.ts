export class TelemetryService {
	static _instance: TelemetryService | undefined
	static createInstance(..._args: unknown[]): TelemetryService { return (this._instance = new TelemetryService()) }
	static get instance(): TelemetryService { return this._instance ?? this.createInstance() }
	static hasInstance(): boolean { return this._instance !== undefined }
	register(_client: unknown): void {}
	setProvider(_provider: unknown): void {}
	updateTelemetryState(_value: unknown): void {}
	captureEvent(_name: unknown, _properties?: unknown): void {}
	captureException(_error: unknown, _properties?: unknown): void {}
	shutdown(): void {}
	captureTaskCreated(_value: string): void {}
	captureTaskRestarted(_value: string): void {}
	captureTaskCompleted(_value: string): void {}
	captureConversationMessage(_a: string, _b: string): void {}
	captureLlmCompletion(_a: string, _b: unknown): void {}
	captureModeSwitch(_a: string, _b: string): void {}
	captureToolUsage(_a: string, _b: string): void {}
	captureCheckpointCreated(_value: string): void {}
	captureCheckpointDiffed(_value: string): void {}
	captureCheckpointRestored(_value: string): void {}
	captureContextCondensed(_a: string, _b: boolean, _c?: boolean): void {}
	captureSlidingWindowTruncation(_value: string): void {}
	captureCodeActionUsed(_value: string): void {}
	capturePromptEnhanced(_value?: string): void {}
	captureSchemaValidationError(_value: unknown): void {}
	captureDiffApplicationError(_a: string, _b: number): void {}
	captureShellIntegrationError(_value: string): void {}
	captureConsecutiveMistakeError(_value: string): void {}
	captureTitleButtonClicked(_value: string): void {}
	captureTelemetrySettingsChanged(..._args: unknown[]): void {}
	captureModeSettingChanged(..._args: unknown[]): void {}
	captureCustomModeCreated(..._args: unknown[]): void {}
	captureTabShown(..._args: unknown[]): void {}
	captureMarketplaceItemInstalled(..._args: unknown[]): void {}
	captureMarketplaceItemRemoved(..._args: unknown[]): void {}
}

export class NoopTelemetryClient { setProvider(): void {} updateTelemetryState(): void {} capture(): void {} captureException(): void {} shutdown(): void {} }
export class BaseTelemetryClient extends NoopTelemetryClient {}
export { NoopTelemetryClient as PostHogTelemetryClient }

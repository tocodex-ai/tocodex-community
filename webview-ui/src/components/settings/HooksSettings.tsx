import { HTMLAttributes, useCallback, useState } from "react"
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Button } from "@/components/ui"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"

// ── 类型定义（与 HooksRunner 保持一致）──────────────────

export interface HookEntry {
	command: string
	toolFilter?: string[]
	timeout?: number
}

export interface HookConfig {
	PreToolUse?: HookEntry[]
	PostToolUse?: HookEntry[]
	Stop?: HookEntry[]
}

type HookPhase = keyof HookConfig

// ── Props ──────────────────────────────────────────────

type HooksSettingsProps = HTMLAttributes<HTMLDivElement> & {
	hooksConfig: HookConfig
	setHooksConfig: (config: HookConfig) => void
}

// ── 单个 Hook 条目编辑器 ──────────────────────────────

function HookEntryEditor({
	entry,
	onChange,
	onRemove,
}: {
	entry: HookEntry
	onChange: (entry: HookEntry) => void
	onRemove: () => void
}) {
	const { t } = useAppTranslation()

	return (
		<div className="flex flex-col gap-2 p-3 border border-vscode-input-border rounded bg-vscode-input-background">
			<div className="flex items-center gap-2">
				<input
					type="text"
					className="flex-1 px-2 py-1 text-sm bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded focus:outline-none focus:border-vscode-focusBorder"
					placeholder={t("settings:hooks.commandPlaceholder")}
					value={entry.command}
					onChange={(e) => onChange({ ...entry, command: e.target.value })}
				/>
				<Button
					variant="ghost"
					className="p-1 h-auto"
					onClick={onRemove}
					aria-label={t("settings:hooks.removeHook")}>
					<Trash2 className="w-4 h-4 text-vscode-errorForeground" />
				</Button>
			</div>
			<div className="flex items-center gap-2">
				<input
					type="text"
					className="flex-1 px-2 py-1 text-xs bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded focus:outline-none focus:border-vscode-focusBorder"
					placeholder={t("settings:hooks.toolFilterPlaceholder")}
					value={entry.toolFilter?.join(", ") ?? ""}
					onChange={(e) => {
						const raw = e.target.value
						const filters = raw
							? raw
									.split(",")
									.map((s) => s.trim())
									.filter(Boolean)
							: undefined
						onChange({ ...entry, toolFilter: filters })
					}}
				/>
				<input
					type="number"
					className="w-20 px-2 py-1 text-xs bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded focus:outline-none focus:border-vscode-focusBorder"
					placeholder="30000"
					min={1000}
					max={300000}
					value={entry.timeout ?? ""}
					onChange={(e) => {
						const val = e.target.value ? parseInt(e.target.value, 10) : undefined
						onChange({ ...entry, timeout: val })
					}}
				/>
				<span className="text-xs text-vscode-descriptionForeground">ms</span>
			</div>
		</div>
	)
}

// ── 单个阶段面板 ──────────────────────────────────────

function HookPhasePanel({
	phase,
	entries,
	onChange,
}: {
	phase: HookPhase
	entries: HookEntry[]
	onChange: (entries: HookEntry[]) => void
}) {
	const { t } = useAppTranslation()
	const [expanded, setExpanded] = useState(entries.length > 0)

	const phaseLabels: Record<HookPhase, string> = {
		PreToolUse: t("settings:hooks.phases.preToolUse"),
		PostToolUse: t("settings:hooks.phases.postToolUse"),
		Stop: t("settings:hooks.phases.stop"),
	}

	const phaseDescriptions: Record<HookPhase, string> = {
		PreToolUse: t("settings:hooks.phases.preToolUseDesc"),
		PostToolUse: t("settings:hooks.phases.postToolUseDesc"),
		Stop: t("settings:hooks.phases.stopDesc"),
	}

	const addEntry = useCallback(() => {
		onChange([...entries, { command: "" }])
		setExpanded(true)
	}, [entries, onChange])

	const updateEntry = useCallback(
		(index: number, entry: HookEntry) => {
			const next = [...entries]
			next[index] = entry
			onChange(next)
		},
		[entries, onChange],
	)

	const removeEntry = useCallback(
		(index: number) => {
			onChange(entries.filter((_, i) => i !== index))
		},
		[entries, onChange],
	)

	return (
		<div className="border border-vscode-panel-border rounded">
			<button
				type="button"
				className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-vscode-foreground hover:bg-vscode-list-hoverBackground cursor-pointer bg-transparent border-none text-left"
				onClick={() => setExpanded(!expanded)}>
				<div className="flex items-center gap-2">
					{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
					<span>{phaseLabels[phase]}</span>
					{entries.length > 0 && (
						<span className="text-xs text-vscode-descriptionForeground">({entries.length})</span>
					)}
				</div>
				<Button
					variant="ghost"
					className="p-1 h-auto"
					onClick={(e) => {
						e.stopPropagation()
						addEntry()
					}}
					aria-label={t("settings:hooks.addHook")}>
					<Plus className="w-4 h-4" />
				</Button>
			</button>
			{expanded && (
				<div className="px-3 pb-3 flex flex-col gap-2">
					<div className="text-xs text-vscode-descriptionForeground">{phaseDescriptions[phase]}</div>
					{entries.length === 0 ? (
						<div className="text-xs text-vscode-descriptionForeground italic py-2">
							{t("settings:hooks.noHooks")}
						</div>
					) : (
						entries.map((entry, index) => (
							<HookEntryEditor
								key={index}
								entry={entry}
								onChange={(e) => updateEntry(index, e)}
								onRemove={() => removeEntry(index)}
							/>
						))
					)}
				</div>
			)}
		</div>
	)
}

// ── 主组件 ──────────────────────────────────────────────

export const HooksSettings = ({ hooksConfig, setHooksConfig, ...props }: HooksSettingsProps) => {
	const { t } = useAppTranslation()

	const phases: HookPhase[] = ["PreToolUse", "PostToolUse", "Stop"]

	const updatePhase = useCallback(
		(phase: HookPhase, entries: HookEntry[]) => {
			setHooksConfig({
				...hooksConfig,
				[phase]: entries,
			})
		},
		[hooksConfig, setHooksConfig],
	)

	return (
		<div {...props}>
			<SectionHeader>{t("settings:sections.hooks")}</SectionHeader>

			<Section>
				<SearchableSetting settingId="hooks-config" section="scheduled" label={t("settings:hooks.title")}>
					<div className="text-vscode-descriptionForeground text-sm mb-3">
						{t("settings:hooks.description")}
					</div>
					<div className="text-xs text-vscode-descriptionForeground mb-3">
						{t("settings:hooks.envVarsHint")}
					</div>
					<div className="flex flex-col gap-2">
						{phases.map((phase) => (
							<HookPhasePanel
								key={phase}
								phase={phase}
								entries={hooksConfig[phase] ?? []}
								onChange={(entries) => updatePhase(phase, entries)}
							/>
						))}
					</div>
				</SearchableSetting>
			</Section>
		</div>
	)
}

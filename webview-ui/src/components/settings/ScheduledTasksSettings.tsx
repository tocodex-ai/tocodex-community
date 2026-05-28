import { HTMLAttributes, useCallback, useEffect, useMemo, useState } from "react"
import { Plus, Trash2, Play, Power, PowerOff, ChevronDown, ChevronRight, Edit2, Clock } from "lucide-react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
} from "@/components/ui"
import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getAllModes } from "@roo/modes"

// ── Types (mirrors packages/types/src/scheduled-task.ts) ───────────────────────

type ScheduleTrigger =
	| { kind: "cron"; expression: string; timezone?: string }
	| { kind: "interval"; intervalMs: number; startAt?: number }
	| { kind: "once"; runAt: number }

interface ScheduledTaskRun {
	runId: string
	startedAt: number
	finishedAt?: number
	status: "running" | "completed" | "failed" | "skipped" | "cancelled" | "timeout"
	taskId?: string
	error?: string
}

interface ScheduledTask {
	id: string
	name: string
	description?: string
	trigger: ScheduleTrigger
	mode: string
	prompt: string
	apiConfigName?: string
	scope: "workspace" | "global"
	enabled: boolean
	maxRuntimeMs: number
	concurrency: "skip" | "queue" | "cancel-previous"
	notifyOn: ("success" | "failure")[]
	catchUpPolicy: "skip" | "run-once"
	createdAt: number
	updatedAt: number
	createdBy: "user" | "model"
	lastRun?: ScheduledTaskRun
	nextRunAt?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTrigger(t: ScheduleTrigger): string {
	if (t.kind === "cron") return `cron: ${t.expression}${t.timezone ? ` (${t.timezone})` : ""}`
	if (t.kind === "interval") {
		const sec = Math.round(t.intervalMs / 1000)
		if (sec < 60) return `interval: ${sec}s`
		if (sec < 3600) return `interval: ${Math.round(sec / 60)}min`
		return `interval: ${(sec / 3600).toFixed(1)}h`
	}
	return `once: ${new Date(t.runAt).toLocaleString()}`
}

function formatTime(ts?: number): string {
	if (!ts) return "-"
	return new Date(ts).toLocaleString()
}

// ── Editor for a single task (used for both create and edit) ──────────────────

interface TaskFormState {
	name: string
	description: string
	mode: string
	prompt: string
	triggerKind: "cron" | "interval" | "once"
	cronExpression: string
	intervalMinutes: number
	onceRunAt: string // ISO datetime-local
	scope: "workspace" | "global"
	enabled: boolean
}

function makeDefaultForm(): TaskFormState {
	return {
		name: "",
		description: "",
		mode: "orchestrator", // Auto mode: orchestrator can switch to other modes as needed
		prompt: "",
		triggerKind: "interval",
		cronExpression: "0 9 * * *",
		intervalMinutes: 60,
		onceRunAt: new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16),
		scope: "global",
		enabled: true,
	}
}

function formToTrigger(f: TaskFormState): ScheduleTrigger {
	if (f.triggerKind === "cron") return { kind: "cron", expression: f.cronExpression }
	if (f.triggerKind === "interval")
		// 后端最低限制为 10 秒（minIntervalMs: 10000），按分钟计算最少为 1 分钟即可。
		return { kind: "interval", intervalMs: Math.max(1, f.intervalMinutes) * 60 * 1000 }
	return { kind: "once", runAt: new Date(f.onceRunAt).getTime() }
}

function taskToForm(task: ScheduledTask): TaskFormState {
	const t = task.trigger
	return {
		name: task.name,
		description: task.description ?? "",
		mode: task.mode,
		prompt: task.prompt,
		triggerKind: t.kind,
		cronExpression: t.kind === "cron" ? t.expression : "0 9 * * *",
		intervalMinutes: t.kind === "interval" ? Math.round(t.intervalMs / 60000) : 60,
		onceRunAt:
			t.kind === "once"
				? new Date(t.runAt).toISOString().slice(0, 16)
				: new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16),
		scope: task.scope,
		enabled: task.enabled,
	}
}

// ── Task Form (collapsible) ───────────────────────────────────────────────────

function TaskForm({
	initial,
	onSubmit,
	onCancel,
	submitLabel,
	availableModes,
}: {
	initial: TaskFormState
	onSubmit: (form: TaskFormState) => void
	onCancel: () => void
	submitLabel: string
	availableModes: { slug: string; name: string; localizedName: string }[]
}) {
	const { t } = useAppTranslation()
	const [form, setForm] = useState<TaskFormState>(initial)

	const update = useCallback((patch: Partial<TaskFormState>) => {
		setForm((prev) => ({ ...prev, ...patch }))
	}, [])

	return (
		<div className="flex flex-col gap-2 p-3 border border-vscode-input-border rounded bg-vscode-input-background">
			<div className="grid grid-cols-2 gap-2">
				<div className="flex flex-col gap-1">
					<label className="text-xs text-vscode-descriptionForeground">
						{t("settings:scheduled.fields.name")}
					</label>
					<input
						type="text"
						className="px-2 py-1 text-sm bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded focus:outline-none focus:border-vscode-focusBorder"
						value={form.name}
						placeholder={t("settings:scheduled.placeholders.name")}
						onChange={(e) => update({ name: e.target.value })}
					/>
				</div>
				<div className="flex flex-col gap-1">
					<label className="text-xs text-vscode-descriptionForeground">
						{t("settings:scheduled.fields.mode")}
					</label>
					<select
						className="px-2 py-1 text-sm bg-vscode-dropdown-background text-vscode-dropdown-foreground border border-vscode-dropdown-border rounded focus:outline-none focus:border-vscode-focusBorder"
						value={form.mode}
						onChange={(e) => update({ mode: e.target.value })}>
						{availableModes.map((m) => (
							<option key={m.slug} value={m.slug}>
								{m.localizedName} ({m.slug})
							</option>
						))}
					</select>
				</div>
			</div>

			<div className="flex flex-col gap-1">
				<label className="text-xs text-vscode-descriptionForeground">
					{t("settings:scheduled.fields.description")}
				</label>
				<input
					type="text"
					className="px-2 py-1 text-sm bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded focus:outline-none focus:border-vscode-focusBorder"
					value={form.description}
					placeholder={t("settings:scheduled.placeholders.description")}
					onChange={(e) => update({ description: e.target.value })}
				/>
			</div>

			<div className="flex flex-col gap-1">
				<label className="text-xs text-vscode-descriptionForeground">
					{t("settings:scheduled.fields.prompt")}
				</label>
				<textarea
					className="px-2 py-1 text-sm bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded focus:outline-none focus:border-vscode-focusBorder font-mono"
					rows={3}
					value={form.prompt}
					placeholder={t("settings:scheduled.placeholders.prompt")}
					onChange={(e) => update({ prompt: e.target.value })}
				/>
			</div>

			<div className="grid grid-cols-2 gap-2">
				<div className="flex flex-col gap-1">
					<label className="text-xs text-vscode-descriptionForeground">
						{t("settings:scheduled.fields.trigger")}
					</label>
					<select
						className="px-2 py-1 text-sm bg-vscode-dropdown-background text-vscode-dropdown-foreground border border-vscode-dropdown-border rounded focus:outline-none focus:border-vscode-focusBorder"
						value={form.triggerKind}
						onChange={(e) =>
							update({ triggerKind: e.target.value as "cron" | "interval" | "once" })
						}>
						<option value="interval">{t("settings:scheduled.triggers.interval")}</option>
						<option value="cron">{t("settings:scheduled.triggers.cron")}</option>
						<option value="once">{t("settings:scheduled.triggers.once")}</option>
					</select>
				</div>
				<div className="flex flex-col gap-1">
					<label className="text-xs text-vscode-descriptionForeground">
						{t("settings:scheduled.fields.scope")}
					</label>
					<select
						className="px-2 py-1 text-sm bg-vscode-dropdown-background text-vscode-dropdown-foreground border border-vscode-dropdown-border rounded focus:outline-none focus:border-vscode-focusBorder"
						value={form.scope}
						onChange={(e) => update({ scope: e.target.value as "workspace" | "global" })}>
						<option value="workspace">{t("settings:scheduled.scopes.workspace")}</option>
						<option value="global">{t("settings:scheduled.scopes.global")}</option>
					</select>
				</div>
			</div>

			{form.triggerKind === "interval" && (
				<div className="flex flex-col gap-1">
					<label className="text-xs text-vscode-descriptionForeground">
						{t("settings:scheduled.fields.intervalMinutes")}
					</label>
					<input
						type="number"
						min={1}
						className="px-2 py-1 text-sm bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded focus:outline-none focus:border-vscode-focusBorder"
						value={form.intervalMinutes}
						onChange={(e) => update({ intervalMinutes: Number(e.target.value) })}
					/>
				</div>
			)}

			{form.triggerKind === "cron" && (
				<div className="flex flex-col gap-1">
					<label className="text-xs text-vscode-descriptionForeground">
						{t("settings:scheduled.fields.cronExpression")}
					</label>
					<input
						type="text"
						className="px-2 py-1 text-sm bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded focus:outline-none focus:border-vscode-focusBorder font-mono"
						value={form.cronExpression}
						placeholder="0 9 * * *"
						onChange={(e) => update({ cronExpression: e.target.value })}
					/>
					<span className="text-xs text-vscode-descriptionForeground">
						{t("settings:scheduled.cronHint")}
					</span>
				</div>
			)}

			{form.triggerKind === "once" && (
				<div className="flex flex-col gap-1">
					<label className="text-xs text-vscode-descriptionForeground">
						{t("settings:scheduled.fields.runAt")}
					</label>
					<input
						type="datetime-local"
						className="px-2 py-1 text-sm bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded focus:outline-none focus:border-vscode-focusBorder"
						value={form.onceRunAt}
						onChange={(e) => update({ onceRunAt: e.target.value })}
					/>
				</div>
			)}

			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={form.enabled}
					onChange={(e) => update({ enabled: e.target.checked })}
				/>
				{t("settings:scheduled.fields.enabled")}
			</label>

			<div className="flex gap-2 justify-end mt-1">
				<Button variant="secondary" onClick={onCancel}>
					{t("settings:common.cancel")}
				</Button>
				<Button
					onClick={() => onSubmit(form)}
					disabled={!form.name.trim() || !form.prompt.trim() || !form.mode.trim()}>
					{submitLabel}
				</Button>
			</div>
		</div>
	)
}

// ── Task List Item ────────────────────────────────────────────────────────────

function TaskListItem({
	task,
	onToggle,
	onDelete,
	onTrigger,
	onEdit,
}: {
	task: ScheduledTask
	onToggle: () => void
	onDelete: () => void
	onTrigger: () => void
	onEdit: () => void
}) {
	const { t } = useAppTranslation()
	const [expanded, setExpanded] = useState(false)

	return (
		<div className="flex flex-col gap-1 p-2 border border-vscode-input-border rounded bg-vscode-input-background">
			<div className="flex items-center gap-2">
				<Button
					variant="ghost"
					className="p-1 h-auto"
					onClick={() => setExpanded((v) => !v)}
					aria-label="toggle details">
					{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				</Button>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 text-sm">
						<span className={task.enabled ? "" : "text-vscode-descriptionForeground line-through"}>
							{task.name}
						</span>
						<span className="text-xs text-vscode-descriptionForeground">
							{task.mode} · {formatTrigger(task.trigger)} · {task.scope}
						</span>
					</div>
					{task.description && (
						<div className="text-xs text-vscode-descriptionForeground truncate">
							{task.description}
						</div>
					)}
				</div>
				<Button
					variant="ghost"
					className="p-1 h-auto"
					onClick={onTrigger}
					title={t("settings:scheduled.actions.runNow")}>
					<Play size={14} />
				</Button>
				<Button
					variant="ghost"
					className="p-1 h-auto"
					onClick={onToggle}
					title={
						task.enabled
							? t("settings:scheduled.actions.disable")
							: t("settings:scheduled.actions.enable")
					}>
					{task.enabled ? <Power size={14} /> : <PowerOff size={14} />}
				</Button>
				<Button
					variant="ghost"
					className="p-1 h-auto"
					onClick={onEdit}
					title={t("settings:scheduled.actions.edit")}>
					<Edit2 size={14} />
				</Button>
				<Button
					variant="ghost"
					className="p-1 h-auto"
					onClick={onDelete}
					title={t("settings:scheduled.actions.delete")}>
					<Trash2 size={14} className="text-vscode-errorForeground" />
				</Button>
			</div>
			{expanded && (
				<div className="ml-6 mt-1 text-xs text-vscode-descriptionForeground flex flex-col gap-0.5">
					<div>
						<span className="font-medium">{t("settings:scheduled.fields.prompt")}: </span>
						<span className="font-mono">{task.prompt.slice(0, 200)}</span>
						{task.prompt.length > 200 && "..."}
					</div>
					<div>
						<span className="font-medium">{t("settings:scheduled.fields.nextRunAt")}: </span>
						{formatTime(task.nextRunAt)}
					</div>
					<div>
						<span className="font-medium">{t("settings:scheduled.fields.lastRun")}: </span>
						{task.lastRun
							? `${task.lastRun.status} @ ${formatTime(task.lastRun.startedAt)}`
							: "-"}
					</div>
					{task.lastRun?.error && (
						<div className="text-vscode-errorForeground">{task.lastRun.error}</div>
					)}
					<div className="opacity-70">id: {task.id}</div>
				</div>
			)}
		</div>
	)
}

// ── Main ──────────────────────────────────────────────────────────────────────

type ScheduledTasksSettingsProps = HTMLAttributes<HTMLDivElement>

export function ScheduledTasksSettings(props: ScheduledTasksSettingsProps) {
	const { t } = useAppTranslation()
	const { customModes } = useExtensionState()
	const [tasks, setTasks] = useState<ScheduledTask[]>([])
	const [showCreate, setShowCreate] = useState(false)
	const [editingId, setEditingId] = useState<string | null>(null)
	const [errorMsg, setErrorMsg] = useState<string | null>(null)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [taskToDelete, setTaskToDelete] = useState<ScheduledTask | null>(null)

	// 与 ModeSelector 保持一致：内置模式名通过 i18n 翻译，自定义模式保留原始名
	const builtinModeSlugs = useMemo(
		() =>
			new Set([
				"architect",
				"code",
				"ssh-server",
				"browser-worker",
				"image-gen",
				"ask",
				"debug",
				"orchestrator",
				"translate",
				"issue-fixer",
				"pr-fixer",
				"merge-resolver",
				"docs-extractor",
				"issue-investigator",
				"issue-writer",
			]),
		[],
	)

	const availableModes = useMemo(
		() =>
			getAllModes(customModes).map((m) => {
				let localizedName = m.name
				if (builtinModeSlugs.has(m.slug)) {
					const key = `chat:modeSelector.modes.${m.slug}.name`
					const translated = t(key)
					if (translated && translated !== key) {
						localizedName = translated
					}
				}
				return { slug: m.slug, name: m.name, localizedName }
			}),
		[customModes, t, builtinModeSlugs],
	)

	// load on mount + refresh whenever the panel regains focus (so reopening shows latest data)
	useEffect(() => {
		const refresh = () => vscode.postMessage({ type: "loadScheduledTasks" })
		refresh()
		const onVisibility = () => {
			if (document.visibilityState === "visible") refresh()
		}
		window.addEventListener("focus", refresh)
		document.addEventListener("visibilitychange", onVisibility)
		return () => {
			window.removeEventListener("focus", refresh)
			document.removeEventListener("visibilitychange", onVisibility)
		}
	}, [])

	// listen to extension messages
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const msg = event.data
			if (msg.type === "scheduledTasksLoaded" && Array.isArray(msg.payload)) {
				setTasks(msg.payload)
			} else if (msg.type === "scheduledTaskOperationError") {
				setErrorMsg(typeof msg.error === "string" ? msg.error : "Operation failed")
			} else if (
				msg.type === "scheduledTaskCreated" ||
				msg.type === "scheduledTaskUpdated" ||
				msg.type === "scheduledTaskDeleted"
			) {
				setErrorMsg(null)
				// Defensive refetch in case backend's broadcast was lost
				vscode.postMessage({ type: "loadScheduledTasks" })
			}
		}
		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	const handleCreate = useCallback((form: TaskFormState) => {
		vscode.postMessage({
			type: "createScheduledTask",
			payload: {
				name: form.name.trim(),
				description: form.description.trim() || undefined,
				mode: form.mode.trim(),
				prompt: form.prompt,
				trigger: formToTrigger(form),
				scope: form.scope,
				enabled: form.enabled,
				createdBy: "user",
			},
		} as any)
		setShowCreate(false)
	}, [])

	const handleUpdate = useCallback((id: string, form: TaskFormState) => {
		vscode.postMessage({
			type: "updateScheduledTask",
			payload: {
				id,
				patch: {
					name: form.name.trim(),
					description: form.description.trim() || undefined,
					mode: form.mode.trim(),
					prompt: form.prompt,
					trigger: formToTrigger(form),
					enabled: form.enabled,
				},
			},
		} as any)
		setEditingId(null)
	}, [])

	const handleDelete = useCallback(
		(id: string) => {
			const target = tasks.find((task) => task.id === id) ?? null
			setTaskToDelete(target)
			setDeleteDialogOpen(true)
		},
		[tasks],
	)

	const handleDeleteCancel = useCallback(() => {
		setDeleteDialogOpen(false)
		setTaskToDelete(null)
	}, [])

	const handleDeleteConfirm = useCallback(() => {
		if (taskToDelete) {
			vscode.postMessage({ type: "deleteScheduledTask", payload: { id: taskToDelete.id } } as any)
		}
		setDeleteDialogOpen(false)
		setTaskToDelete(null)
	}, [taskToDelete])

	const handleToggle = useCallback((task: ScheduledTask) => {
		vscode.postMessage({
			type: "toggleScheduledTaskEnabled",
			payload: { id: task.id, enabled: !task.enabled },
		} as any)
	}, [])

	const handleTrigger = useCallback((id: string) => {
		vscode.postMessage({ type: "triggerScheduledTask", payload: { id } } as any)
	}, [])

	return (
		<div {...props} className={(props.className ?? "") + " flex flex-col gap-3"}>
			<div className="flex items-center gap-2 text-sm font-medium">
				<Clock size={16} />
				<span>{t("settings:scheduled.title")}</span>
			</div>
			<div className="text-xs text-vscode-descriptionForeground">
				{t("settings:scheduled.description")}
			</div>

			{errorMsg && (
				<div className="text-xs text-vscode-errorForeground p-2 bg-vscode-inputValidation-errorBackground rounded">
					{errorMsg}
				</div>
			)}

			<div className="flex flex-col gap-2">
				{tasks.length === 0 && !showCreate && (
					<div className="text-xs text-vscode-descriptionForeground italic">
						{t("settings:scheduled.empty")}
					</div>
				)}
				{tasks.map((task) =>
					editingId === task.id ? (
						<TaskForm
							key={task.id}
							initial={taskToForm(task)}
							submitLabel={t("settings:common.save")}
							onSubmit={(form) => handleUpdate(task.id, form)}
							onCancel={() => setEditingId(null)}
							availableModes={availableModes}
						/>
					) : (
						<TaskListItem
							key={task.id}
							task={task}
							onToggle={() => handleToggle(task)}
							onDelete={() => handleDelete(task.id)}
							onTrigger={() => handleTrigger(task.id)}
							onEdit={() => setEditingId(task.id)}
						/>
					),
				)}
			</div>

			{showCreate ? (
				<TaskForm
					initial={makeDefaultForm()}
					submitLabel={t("settings:scheduled.actions.create")}
					onSubmit={handleCreate}
					onCancel={() => setShowCreate(false)}
					availableModes={availableModes}
				/>
			) : (
				<Button variant="secondary" className="self-start" onClick={() => setShowCreate(true)}>
					<Plus size={14} className="mr-1" />
					{t("settings:scheduled.actions.add")}
				</Button>
			)}

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("settings:scheduled.deleteDialog.title")}</AlertDialogTitle>
						<AlertDialogDescription>
							{t("settings:scheduled.deleteDialog.description", {
								name: taskToDelete?.name ?? "",
							})}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={handleDeleteCancel}>
							{t("settings:scheduled.deleteDialog.cancel")}
						</AlertDialogCancel>
						<AlertDialogAction onClick={handleDeleteConfirm}>
							{t("settings:scheduled.deleteDialog.confirm")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}

export default ScheduledTasksSettings

import { memo, useEffect, useRef, useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useCloudUpsell } from "@src/hooks/useCloudUpsell"
import { CloudUpsellDialog } from "@src/components/cloud/CloudUpsellDialog"
import DismissibleUpsell from "@src/components/common/DismissibleUpsell"
import {
	ChevronUp,
	ChevronDown,
	HardDriveDownload,
	HardDriveUpload,
	FoldVertical,
	ArrowLeft,
	AlertTriangle,
	Scissors,
} from "lucide-react"
import prettyBytes from "pretty-bytes"

import type { ClineMessage } from "@roo-code/types"

import { findLastIndex } from "@roo/array"

import { formatLargeNumber } from "@src/utils/format"
import { cn } from "@src/lib/utils"
import { StandardTooltip, Button, Table, TableBody, TableRow, TableCell, CircularProgress } from "@src/components/ui"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useSelectedModel } from "@/components/ui/hooks/useSelectedModel"
import { vscode } from "@src/utils/vscode"

import Thumbnails from "../common/Thumbnails"

import { TaskActions } from "./TaskActions"
import { ContextWindowProgress } from "./ContextWindowProgress"
import { ContextHealthPanel } from "./context-management/ContextHealthPanel"
import { Mention } from "./Mention"
import { TodoListDisplay } from "./TodoListDisplay"
import { LucideIconButton } from "./LucideIconButton"
import ParallelTasksPanel, { type ParallelChildInfo } from "./ParallelTasksPanel"
import ProgressSummaryBadge from "./ProgressSummaryBadge"

export interface TaskHeaderProps {
	task: ClineMessage
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	condenseSavedTokens?: number
	totalCost: number
	aggregatedCost?: number
	hasSubtasks?: boolean
	parentTaskId?: string
	costBreakdown?: string
	contextTokens: number
	taskCostSummary?: {
		totalCostUSD: number
		byModel: Record<
			string,
			{
				modelId: string
				inputTokens: number
				outputTokens: number
				cacheReadTokens: number
				cacheWriteTokens: number
				costUSD: number
			}
		>
	}
	buttonsDisabled: boolean
	handleCondenseContext: (taskId: string) => void
	handleForceTruncateContext?: (taskId: string) => void
	todos?: any[]
	messages?: ClineMessage[]
	parallelChildren?: ParallelChildInfo[]
	progressSummary?: string | null
}

const TaskHeader = ({
	task,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	condenseSavedTokens,
	totalCost,
	aggregatedCost,
	hasSubtasks,
	parentTaskId,
	costBreakdown,
	contextTokens,
	taskCostSummary,
	buttonsDisabled,
	handleCondenseContext,
	handleForceTruncateContext,
	todos,
	messages: taskMessages,
	parallelChildren,
	progressSummary,
}: TaskHeaderProps) => {
	const { t } = useTranslation()
	const {
		apiConfiguration,
		currentTaskItem,
		clineMessages,
		autoCondenseContextPercent,
		profileThresholds,
		currentApiConfigName,
		listApiConfigMeta,
	} = useExtensionState()
	const { info: model } = useSelectedModel(apiConfiguration)
	const [isTaskExpanded, setIsTaskExpanded] = useState(false)
	// 长时间运行提示已禁用
	const showLongRunningTaskMessage = false
	const { isOpen, openUpsell, closeUpsell, handleConnect } = useCloudUpsell({
		autoOpenOnAuth: false,
	})

	// Check if the task is complete by looking at the last relevant message (skipping resume messages)
	const isTaskComplete =
		clineMessages && clineMessages.length > 0
			? (() => {
					const lastRelevantIndex = findLastIndex(
						clineMessages,
						(m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
					)
					return lastRelevantIndex !== -1
						? clineMessages[lastRelevantIndex]?.ask === "completion_result"
						: false
				})()
			: false

	// 长时间运行提示的定时器已禁用
	// useEffect(() => {
	// 	const timer = setTimeout(() => {
	// 		if (currentTaskItem && !isTaskComplete) {
	// 			setShowLongRunningTaskMessage(true)
	// 		}
	// 	}, 120_000)
	// 	return () => clearTimeout(timer)
	// }, [currentTaskItem, isTaskComplete])

	const textContainerRef = useRef<HTMLDivElement>(null)
	const textRef = useRef<HTMLDivElement>(null)
	const contextWindow = model?.contextWindow || 1

	// Context progress uses the configured condense threshold as the safety reserve display.
	// API max output tokens still come from model/provider metadata and are not changed here.
	const currentProfileId =
		listApiConfigMeta?.find((profile) => profile.name === currentApiConfigName)?.id ?? "default"
	const profileThreshold = profileThresholds?.[currentProfileId]
	const effectiveCondenseThreshold =
		profileThreshold !== undefined && profileThreshold !== -1 ? profileThreshold : autoCondenseContextPercent
	const reservedForOutput = Math.ceil((contextWindow * Math.max(0, 100 - effectiveCondenseThreshold)) / 100)

	// 上下文使用率：contextTokens / contextWindow
	const contextUsageRatio = contextWindow > 0 ? (contextTokens || 0) / contextWindow : 0
	// 是否处于高风险状态（上下文 > 100%）
	const isContextOverflow = contextUsageRatio > 1.0

	const condenseButton = (
		<LucideIconButton
			title={t("chat:task.condenseContext")}
			icon={FoldVertical}
			disabled={buttonsDisabled}
			onClick={() => currentTaskItem && handleCondenseContext(currentTaskItem.id)}
		/>
	)

	// 手动强制截断按钮：只在上下文溢出时显示
	const forceTruncateButton = isContextOverflow && handleForceTruncateContext && (
		<StandardTooltip
			content={t("chat:task.forceTruncateTooltip", {
				defaultValue: "强制截断：丢弃较早的对话历史以恢复任务执行。建议优先开新任务。",
			})}
			side="bottom"
			sideOffset={4}>
			<span>
				<LucideIconButton
					title={t("chat:task.forceTruncate", { defaultValue: "强制截断上下文" })}
					icon={Scissors}
					disabled={buttonsDisabled}
					className="text-vscode-editorWarning-foreground"
					onClick={() => {
						if (
							currentTaskItem &&
							confirm(
								t("chat:task.forceTruncateConfirm", {
									defaultValue:
										"确定要强制截断上下文吗？\n\n这会隐藏较早的对话历史以恢复任务执行，可能丢失部分上下文。\n建议优先开启新任务继续。",
								}),
							)
						) {
							handleForceTruncateContext(currentTaskItem.id)
						}
					}}
				/>
			</span>
		</StandardTooltip>
	)

	const hasTodos = todos && Array.isArray(todos) && todos.length > 0

	// Determine if this is a subtask (has a parent)
	const isSubtask = !!parentTaskId

	const handleBackToParent = () => {
		if (parentTaskId) {
			vscode.postMessage({ type: "showTaskWithId", text: parentTaskId })
		}
	}

	return (
		<div className="group pt-2 pb-0 px-3">
			{isSubtask && (
				<div className="mb-2" onClick={(e) => e.stopPropagation()}>
					<Button
						variant="ghost"
						size="sm"
						onClick={handleBackToParent}
						className="flex items-center gap-1.5 text-xs text-vscode-descriptionForeground hover:text-vscode-foreground">
						<ArrowLeft className="size-3" />
						{t("chat:task.backToParentTask")}
					</Button>
				</div>
			)}
			{showLongRunningTaskMessage && !isTaskComplete && (
				<DismissibleUpsell
					upsellId="longRunningTask"
					onClick={() => openUpsell()}
					dismissOnClick={false}
					variant="banner">
					{t("cloud:upsell.longRunningTask")}
				</DismissibleUpsell>
			)}
			<div
				className={cn(
					"px-3 pt-2.5 pb-2 flex flex-col gap-1.5 relative z-1 cursor-pointer",
					"bg-vscode-input-background hover:bg-vscode-input-background/90",
					"text-vscode-foreground/80 hover:text-vscode-foreground",
					"shadow-lg shadow-vscode-sideBar-background/50 rounded-xl",
					hasTodos && "border-b-0",
				)}
				onClick={(e) => {
					// Don't expand if clicking on todos section
					if (e.target instanceof Element && e.target.closest("[data-todo-list]")) {
						return
					}

					// Don't expand if clicking on buttons or interactive elements
					if (
						e.target instanceof Element &&
						(e.target.closest("button") ||
							e.target.closest('[role="button"]') ||
							e.target.closest(".share-button") ||
							e.target.closest("[data-radix-popper-content-wrapper]") ||
							e.target.closest("img") ||
							e.target.tagName === "IMG")
					) {
						return
					}

					// Don't expand/collapse if user is selecting text
					const selection = window.getSelection()
					if (selection && selection.toString().length > 0) {
						return
					}

					setIsTaskExpanded(!isTaskExpanded)
				}}>
				<div className="flex justify-between items-center gap-0">
					<div className="flex items-center select-none grow min-w-0">
						<div className="grow min-w-0">
							{isTaskExpanded && <span className="font-bold">{t("chat:task.title")}</span>}
							{!isTaskExpanded && (
								<div className="flex items-center gap-2 whitespace-nowrap overflow-hidden text-ellipsis">
									<Mention text={task.text} />
								</div>
							)}
						</div>
						<div className="flex items-center shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
							<StandardTooltip content={isTaskExpanded ? t("chat:task.collapse") : t("chat:task.expand")}>
								<button
									onClick={() => setIsTaskExpanded(!isTaskExpanded)}
									className="shrink-0 min-h-[20px] min-w-[20px] p-[2px] cursor-pointer opacity-85 hover:opacity-100 bg-transparent border-none rounded-md">
									{isTaskExpanded ? (
										<ChevronUp size={16} />
									) : (
										<ChevronDown size={16} className="opacity-0 group-hover:opacity-100" />
									)}
								</button>
							</StandardTooltip>
						</div>
					</div>
				</div>
				{!isTaskExpanded && contextWindow > 0 && (
					<div
						className="flex items-center justify-between text-sm text-muted-foreground/70"
						onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center gap-2">
							<StandardTooltip
								content={(() => {
									const availableSpace = contextWindow - (contextTokens || 0) - reservedForOutput

									return (
										<Table className="text-base ml-1.5">
											<TableBody>
												<TableRow>
													<TableCell className="font-medium whitespace-nowrap">
														{t("chat:tokenProgress.tokensUsedLabel")}
													</TableCell>
													<TableCell className="text-right text-[0.9em] font-mono">
														{formatLargeNumber(contextTokens || 0)} /{" "}
														{formatLargeNumber(contextWindow)}
													</TableCell>
												</TableRow>
												{reservedForOutput > 0 && (
													<TableRow>
														<TableCell className="font-medium whitespace-nowrap">
															{t("chat:tokenProgress.reservedForResponseLabel")}
														</TableCell>
														<TableCell className="text-right text-[0.9em] font-mono">
															{formatLargeNumber(reservedForOutput)}
														</TableCell>
													</TableRow>
												)}
												{availableSpace > 0 && (
													<TableRow>
														<TableCell className="font-medium whitespace-nowrap">
															{t("chat:tokenProgress.availableSpaceLabel")}
														</TableCell>
														<TableCell className="text-right text-[0.9em] font-mono">
															{formatLargeNumber(availableSpace)}
														</TableCell>
													</TableRow>
												)}
											</TableBody>
										</Table>
									)
								})()}
								side="top"
								sideOffset={8}>
								<span className="flex items-center gap-1.5">
									{(() => {
										// Calculate percentage of available input space used
										// Available input space = context window - configured safety reserve
										const availableInputSpace = contextWindow - reservedForOutput
										const percentage =
											availableInputSpace > 0
												? Math.round(((contextTokens || 0) / availableInputSpace) * 100)
												: 0
										const contextUsagePercent =
											contextWindow > 0 ? ((contextTokens || 0) / contextWindow) * 100 : 0
										return (
											<>
												<CircularProgress percentage={percentage} />
												<span>{percentage}%</span>
												{contextUsagePercent > 60 && (
													<StandardTooltip
														content={t("chat:contextHealth.suggestCondense", {
															percent: Math.round(contextUsagePercent),
														})}
														side="top"
														sideOffset={8}>
														<AlertTriangle
															className="size-3 text-vscode-editorWarning-foreground"
															data-testid="context-health-warning-icon"
														/>
													</StandardTooltip>
												)}
											</>
										)
									})()}
								</span>
							</StandardTooltip>
							{!!totalCost && (
								<>
									<span>·</span>
									<StandardTooltip
										content={
											hasSubtasks ? (
												<div>
													<div>
														{t("chat:costs.totalWithSubtasks", {
															cost: (aggregatedCost ?? totalCost).toFixed(2),
														})}
													</div>
													{costBreakdown && (
														<div className="text-xs mt-1">{costBreakdown}</div>
													)}
												</div>
											) : (
												<div>{t("chat:costs.total", { cost: totalCost.toFixed(2) })}</div>
											)
										}
										side="top"
										sideOffset={8}>
										<>
											<span>
												${(aggregatedCost ?? totalCost).toFixed(2)}
												{hasSubtasks && (
													<span
														className="text-xs ml-1"
														title={t("chat:costs.includesSubtasks")}>
														*
													</span>
												)}
											</span>
										</>
									</StandardTooltip>
								</>
							)}
						</div>
					</div>
				)}
				{/* Expanded state: Show task text and images */}
				{isTaskExpanded && (
					<>
						<div
							ref={textContainerRef}
							className="text-vscode-font-size overflow-y-auto break-words break-anywhere relative">
							<div
								ref={textRef}
								className="overflow-auto max-h-80 whitespace-pre-wrap break-words break-anywhere cursor-text py-0.5"
								style={{
									display: "-webkit-box",
									WebkitLineClamp: "unset",
									WebkitBoxOrient: "vertical",
								}}>
								<Mention text={task.text} />
							</div>
						</div>
						{task.images && task.images.length > 0 && <Thumbnails images={task.images} />}

						<div onClick={(e) => e.stopPropagation()}>
							<TaskActions item={currentTaskItem} buttonsDisabled={buttonsDisabled} />
						</div>

						<div className="pt-3 mt-2 -mx-2.5 px-2.5 border-t border-vscode-sideBar-background">
							<table className="w-full text-sm">
								<tbody>
									{contextWindow > 0 && (
										<tr>
											<th
												className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]"
												data-testid="context-window-label">
												{t("chat:task.contextWindow")}
											</th>
											<td className="font-light align-top">
												<div className={`max-w-md -mt-1.5 flex flex-nowrap gap-1`}>
													<ContextWindowProgress
														contextWindow={contextWindow}
														contextTokens={contextTokens || 0}
														reservedTokens={reservedForOutput}
													/>
													{condenseButton}
													{forceTruncateButton}
												</div>
											</td>
										</tr>
									)}

									<tr>
										<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
											{t("chat:task.tokens")}
										</th>
										<td className="font-light align-top">
											<div className="flex items-center gap-1 flex-wrap">
												{typeof tokensIn === "number" && tokensIn > 0 && (
													<span>↑ {formatLargeNumber(tokensIn)}</span>
												)}
												{typeof tokensOut === "number" && tokensOut > 0 && (
													<span>↓ {formatLargeNumber(tokensOut)}</span>
												)}
											</div>
										</td>
									</tr>

									{((typeof cacheReads === "number" && cacheReads > 0) ||
										(typeof cacheWrites === "number" && cacheWrites > 0) ||
										(typeof condenseSavedTokens === "number" && condenseSavedTokens > 0)) &&
										(() => {
											// tokensIn 已经包含 cacheReads（Anthropic: input + cacheWrite + cacheRead）
											// 命中率 = cacheReads / tokensIn（不要重复加 cacheReads）
											const hitRate =
												(tokensIn || 0) > 0
													? Math.round(((cacheReads || 0) / (tokensIn || 1)) * 100)
													: 0
											const totalSaved = (cacheReads || 0) + (condenseSavedTokens || 0)
											return (
												<tr>
													<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
														{t("chat:task.cache")}
													</th>
													<td className="font-light align-top">
														<div className="flex items-center gap-1.5 flex-wrap text-xs">
															{typeof cacheWrites === "number" && cacheWrites > 0 && (
																<span className="opacity-70">
																	{t("chat:task.cacheWrite")}{" "}
																	{formatLargeNumber(cacheWrites)}
																</span>
															)}
															{typeof cacheReads === "number" && cacheReads > 0 && (
																<span className="text-vscode-charts-green">
																	{t("chat:task.cacheHit")}{" "}
																	{formatLargeNumber(cacheReads)}
																</span>
															)}
															{hitRate > 0 && (
																<span className="text-vscode-charts-green">
																	{t("chat:task.cacheHitRate")} {hitRate}%
																</span>
															)}
															{totalSaved > 0 && (
																<span className="opacity-70">
																	{t("chat:task.cacheSaved")}{" "}
																	{formatLargeNumber(totalSaved)} tokens
																</span>
															)}
														</div>
													</td>
												</tr>
											)
										})()}

									{!!totalCost && (
										<tr>
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
												{t("chat:task.apiCost")}
											</th>
											<td className="font-light align-top">
												<StandardTooltip
													content={
														hasSubtasks ? (
															<div>
																<div>
																	{t("chat:costs.totalWithSubtasks", {
																		cost: (aggregatedCost ?? totalCost).toFixed(2),
																	})}
																</div>
																{costBreakdown && (
																	<div className="text-xs mt-1">{costBreakdown}</div>
																)}
															</div>
														) : (
															<div>
																{t("chat:costs.total", { cost: totalCost.toFixed(2) })}
															</div>
														)
													}
													side="top"
													sideOffset={8}>
													<span>
														${(aggregatedCost ?? totalCost).toFixed(2)}
														{hasSubtasks && (
															<span
																className="text-xs ml-1"
																title={t("chat:costs.includesSubtasks")}>
																*
															</span>
														)}
													</span>
												</StandardTooltip>
											</td>
										</tr>
									)}

									{/* 按模型分类的成本明细 */}
									{taskCostSummary && Object.keys(taskCostSummary.byModel).length > 0 && (
										<tr>
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
												{t("chat:costs.modelBreakdown")}
											</th>
											<td className="font-light align-top">
												<div className="flex flex-col gap-0.5 text-xs">
													{Object.values(taskCostSummary.byModel).map((model) => (
														<StandardTooltip
															key={model.modelId}
															content={
																<div className="text-xs">
																	<div>
																		{t("chat:costs.inputTokens")}:{" "}
																		{formatLargeNumber(model.inputTokens)}
																	</div>
																	<div>
																		{t("chat:costs.outputTokens")}:{" "}
																		{formatLargeNumber(model.outputTokens)}
																	</div>
																	{model.cacheReadTokens > 0 && (
																		<div>
																			{t("chat:costs.cacheRead")}:{" "}
																			{formatLargeNumber(model.cacheReadTokens)}
																		</div>
																	)}
																	{model.cacheWriteTokens > 0 && (
																		<div>
																			{t("chat:costs.cacheWrite")}:{" "}
																			{formatLargeNumber(model.cacheWriteTokens)}
																		</div>
																	)}
																</div>
															}
															side="top"
															sideOffset={4}>
															<span className="text-vscode-descriptionForeground cursor-default">
																{model.modelId}: ${model.costUSD.toFixed(4)}
															</span>
														</StandardTooltip>
													))}
												</div>
											</td>
										</tr>
									)}

									{/* Size display — > 50MB 时显示警告色和建议开新任务 */}
									{!!currentTaskItem?.size && currentTaskItem.size > 0 && (
										<tr>
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-2 h-[20px]">
												{t("chat:task.size")}
											</th>
											<td className="font-light align-top">
												<span
													className={
														currentTaskItem.size > 50 * 1024 * 1024
															? "text-vscode-editorWarning-foreground font-medium"
															: ""
													}>
													{prettyBytes(currentTaskItem.size)}
												</span>
												{currentTaskItem.size > 50 * 1024 * 1024 && (
													<span className="ml-1.5 text-[0.85em] text-vscode-editorWarning-foreground">
														⚠{" "}
														{t("chat:task.taskTooLarge", {
															defaultValue: "建议开新任务",
														})}
													</span>
												)}
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>

						{/* 上下文健康度面板 — 使用率 > 60% 时显示 */}
						{taskMessages && taskMessages.length > 0 && (
							<div className="-mx-2.5 px-2.5" onClick={(e) => e.stopPropagation()}>
								<ContextHealthPanel
									messages={taskMessages}
									contextTokens={contextTokens || 0}
									contextWindow={contextWindow}
									onCondense={() => currentTaskItem && handleCondenseContext(currentTaskItem.id)}
									buttonsDisabled={buttonsDisabled}
								/>
							</div>
						)}

						{/* 并行子任务状态面板 */}
						{parallelChildren && parallelChildren.length > 0 && (
							<div onClick={(e) => e.stopPropagation()}>
								<ParallelTasksPanel children={parallelChildren} />
							</div>
						)}
					</>
				)}
				{/* Todo list - always shown at bottom when todos exist */}
				{hasTodos && <TodoListDisplay todos={todos ?? (task as any)?.tool?.todos ?? []} />}
			</div>
			{/* 实时进度摘要徽章 — 任务运行时显示在 header 下方 (Requirements: 3.1, 3.3) */}
			{!isTaskComplete && <ProgressSummaryBadge summary={progressSummary ?? null} />}
			<CloudUpsellDialog open={isOpen} onOpenChange={closeUpsell} onConnect={handleConnect} />
		</div>
	)
}

export default memo(TaskHeader)

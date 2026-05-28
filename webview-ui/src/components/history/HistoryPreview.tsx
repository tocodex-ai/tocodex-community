import { memo } from "react"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"

import { useTaskSearch } from "./useTaskSearch"
import { useGroupedTasks } from "./useGroupedTasks"
import TaskGroupItem from "./TaskGroupItem"

const HistoryPreview = () => {
	const { tasks, searchQuery } = useTaskSearch()
	const { groups, toggleExpand } = useGroupedTasks(tasks, searchQuery)
	const { t } = useAppTranslation()

	const handleViewAllHistory = () => {
		vscode.postMessage({ type: "switchTab", tab: "history" })
	}

	// 首页最多显示 5 个 group，避免内容过多把 logo 和"查看全部"按钮顶出视口
	const displayGroups = groups.slice(0, 5)

	return (
		<div className="flex flex-col gap-1">
			<div className="flex flex-wrap items-center justify-between mt-2 mb-1">
				<h2 className="font-semibold text-lg grow m-0">{t("history:recentTasks")}</h2>
				<button
					onClick={handleViewAllHistory}
					className="text-base text-vscode-descriptionForeground hover:text-vscode-textLink-foreground transition-colors cursor-pointer"
					aria-label={t("history:viewAllHistory")}>
					{t("history:viewAllHistory")}
				</button>
			</div>
			{displayGroups.length !== 0 && (
				<>
					{displayGroups.map((group) => (
						<TaskGroupItem
							key={group.parent.id}
							group={group}
							variant="compact"
							onToggleExpand={() => toggleExpand(group.parent.id)}
							onToggleSubtaskExpand={toggleExpand}
						/>
					))}
				</>
			)}
		</div>
	)
}

export default memo(HistoryPreview)

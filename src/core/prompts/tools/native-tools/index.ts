import type OpenAI from "openai"
import accessMcpResource from "./access_mcp_resource"
import { apply_diff } from "./apply_diff"
import applyPatch from "./apply_patch"
import askFollowupQuestion from "./ask_followup_question"
import attemptCompletion from "./attempt_completion"
import codebaseSearch from "./codebase_search"
import editTool from "./edit"
import executeCommand from "./execute_command"
import generateImage from "./generate_image"
import listFiles from "./list_files"
import newTask from "./new_task"
import readCommandOutput from "./read_command_output"
import { createReadFileTool, type ReadFileToolOptions } from "./read_file"
import runSlashCommand from "./run_slash_command"
import skill from "./skill"
import searchReplace from "./search_replace"
import edit_file from "./edit_file"
import searchFiles from "./search_files"
import switchMode from "./switch_mode"
import updateTodoList from "./update_todo_list"
import writeToFile from "./write_to_file"
import lspCodeIntelligence from "./lsp_code_intelligence"
import webFetch from "./web_fetch"
import enterPlanMode from "./enter_plan_mode"
import exitPlanMode from "./exit_plan_mode"
import spawnParallelTask from "./spawn_parallel_task"
import toolSearch from "./tool_search"
import notebookEdit from "./notebook_edit"
import scheduleTask from "./schedule_task"
import listScheduledTasks from "./list_scheduled_tasks"
import updateScheduledTask from "./update_scheduled_task"
import cancelScheduledTask from "./cancel_scheduled_task"
import runScheduledTaskNow from "./run_scheduled_task_now"
import getScheduledTaskRuns from "./get_scheduled_task_runs"

export { getMcpServerTools } from "./mcp_server"
export { convertOpenAIToolToAnthropic, convertOpenAIToolsToAnthropic } from "./converters"
export type { ReadFileToolOptions } from "./read_file"

/**
 * Options for customizing the native tools array.
 */
export interface NativeToolsOptions {
	/** Whether the model supports image processing (default: false) */
	supportsImages?: boolean
}

/**
 * Get native tools array, optionally customizing based on settings.
 *
 * @param options - Configuration options for the tools
 * @returns Array of native tool definitions
 */
export function getNativeTools(options: NativeToolsOptions = {}): OpenAI.Chat.ChatCompletionTool[] {
	const { supportsImages = false } = options

	const readFileOptions: ReadFileToolOptions = {
		supportsImages,
	}

	return [
		accessMcpResource,
		apply_diff,
		applyPatch,
		askFollowupQuestion,
		attemptCompletion,
		codebaseSearch,
		executeCommand,
		generateImage,
		listFiles,
		newTask,
		readCommandOutput,
		createReadFileTool(readFileOptions),
		runSlashCommand,
		skill,
		searchReplace,
		edit_file,
		editTool,
		searchFiles,
		switchMode,
		updateTodoList,
		writeToFile,
		lspCodeIntelligence,
		webFetch,
		enterPlanMode,
		exitPlanMode,
		spawnParallelTask,
		toolSearch,
		notebookEdit,
		scheduleTask,
		listScheduledTasks,
		updateScheduledTask,
		cancelScheduledTask,
		runScheduledTaskNow,
		getScheduledTaskRuns,
	] satisfies OpenAI.Chat.ChatCompletionTool[]
}

// Backward compatibility: export default tools with line ranges enabled
export const nativeTools = getNativeTools()

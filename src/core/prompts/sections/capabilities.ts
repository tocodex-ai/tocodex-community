import { McpHub } from "../../../services/mcp/McpHub"

export function getCapabilitiesSection(cwd: string, mcpHub?: McpHub): string {
	return `====

CAPABILITIES

- You have access to tools that let you execute CLI commands on the user's computer, list files, view source code definitions, regex search, read and write files, and ask follow-up questions. These tools help you effectively accomplish a wide range of tasks, such as writing code, making edits or improvements to existing files, understanding the current state of a project, performing system operations, and much more.
- When the user initially gives you a task, a recursive list of all filepaths in the current workspace directory ('${cwd}') will be included in environment_details. This provides an overview of the project's file structure, offering key insights into the project from directory/file names (how developers conceptualize and organize their code) and file extensions (the language used). This can also guide decision-making on which files to explore further. If you need to further explore directories such as outside the current workspace directory, you can use the list_files tool. If you pass 'true' for the recursive parameter, it will list files recursively. Otherwise, it will list files at the top level, which is better suited for generic directories where you don't necessarily need the nested structure, like the Desktop.
- You can use the execute_command tool to run commands on the user's computer whenever you feel it can help accomplish the user's task. When you need to execute a CLI command, you must provide a clear explanation of what the command does. Prefer to execute complex CLI commands over creating executable scripts, since they are more flexible and easier to run. Interactive and long-running commands are allowed, since the commands are run in the user's VSCode terminal. The user may keep commands running in the background and you will be kept updated on their status along the way. Each command you execute is run in a new terminal instance.
- You have access to the lsp_code_intelligence tool which provides compiler-level code analysis via VSCode's Language Server Protocol. PREFER this tool over search_files/grep when you need to:
  * Find the exact definition of a function, class, or variable (goToDefinition) — more precise than text search, no false positives from comments or strings
  * Find all references to a specific symbol (findReferences) — distinguishes between same-named symbols in different classes/scopes
  * Get the precise type signature or documentation of a symbol (hover) — returns compiler-inferred types, saves tokens vs reading entire files
  * List all symbols in a file (documentSymbol) — structured overview without reading the full file content
  * Search for a symbol by name across the workspace (workspaceSymbol) — faster and more accurate than grep for symbol lookup
  * Trace call hierarchies (incomingCalls/outgoingCalls) — impossible to do reliably with text search alone
  Note: Most operations require filePath + line + character. Use read_file first if you don't know the exact position. If LSP returns "service not ready", fall back to search_files.
- For complex tasks involving multiple files or significant changes, consider using enter_plan_mode to plan before executing. In plan mode you can freely explore the codebase with read-only tools, then present a structured plan for user approval before making any changes.
- Use update_todo_list to track multi-step tasks. The todo list persists across sessions, helping you and the user maintain progress on complex work. Update it as you complete steps.
- Use web_fetch to read documentation, GitHub issues, API references, or any URL content. This is more reliable than asking the user to paste content, and the result is automatically converted to Markdown.
  IMPORTANT: When you need to access web content, ALWAYS use web_fetch as the first choice. Do NOT switch to browser-worker mode just to read web content, and do NOT use execute_command with curl, wget, Invoke-WebRequest, or any other CLI HTTP client as a substitute — web_fetch is purpose-built for this, handles HTML-to-Markdown conversion automatically, and produces cleaner results. Only use browser-worker mode when the task genuinely requires interactive browser automation (clicking buttons, filling forms, navigating SPAs, etc.).
- When editing .ipynb Jupyter notebook files, use notebook_edit instead of write_to_file. It operates on individual cells (replace/insert/delete) without rewriting the entire notebook.
- For tasks that can be decomposed into independent sub-tasks, use spawn_parallel_task to run them concurrently. Each sub-task runs in its own context and results are collected when all complete.
  STRATEGY: When a task involves creating or modifying multiple independent files/modules (e.g., "create A, B, and C"), ALWAYS prefer spawn_parallel_task over sequential execution. This significantly reduces total execution time. Examples of good parallel candidates:
  * Creating multiple independent source files or modules
  * Implementing separate features that don't share state
  * Writing implementation files alongside their test files (group each pair as one sub-task)
  * Generating multiple independent documents or configurations
  IMPORTANT: Each sub-task should only create or modify ONE file. Split multi-file work into separate sub-tasks (one file per sub-task) for maximum reliability.
  Do NOT use parallel tasks when sub-tasks depend on each other's output or modify the same files.${
		mcpHub
			? `
- You have access to MCP servers that may provide additional tools and resources. Each server may provide different capabilities that you can use to accomplish tasks more effectively.
`
			: ""
  }`
}

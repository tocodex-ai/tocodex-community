import * as path from "path"
import * as os from "os"
import fs from "fs/promises"

/**
 * Gets the global .tocodex directory path based on the current platform
 *
 * @returns The absolute path to the global .tocodex directory
 *
 * @example Platform-specific paths:
 * ```
 * // macOS/Linux: ~/.tocodex/
 * // Example: /Users/john/.tocodex
 *
 * // Windows: %USERPROFILE%\.tocodex\
 * // Example: C:\Users\john\.tocodex
 * ```
 *
 * @example Usage:
 * ```typescript
 * const globalDir = getGlobalRooDirectory()
 * // Returns: "/Users/john/.tocodex" (on macOS/Linux)
 * // Returns: "C:\\Users\\john\\.tocodex" (on Windows)
 * ```
 */
export function getGlobalRooDirectory(): string {
	const homeDir = os.homedir()
	return path.join(homeDir, ".tocodex")
}

/**
 * Gets the global .agents directory path based on the current platform.
 * This is a shared directory for agent skills across different AI coding tools.
 *
 * @returns The absolute path to the global .agents directory
 *
 * @example Platform-specific paths:
 * ```
 * // macOS/Linux: ~/.agents/
 * // Example: /Users/john/.agents
 *
 * // Windows: %USERPROFILE%\.agents\
 * // Example: C:\Users\john\.agents
 * ```
 *
 * @example Usage:
 * ```typescript
 * const globalAgentsDir = getGlobalAgentsDirectory()
 * // Returns: "/Users/john/.agents" (on macOS/Linux)
 * // Returns: "C:\\Users\\john\\.agents" (on Windows)
 * ```
 */
export function getGlobalAgentsDirectory(): string {
	const homeDir = os.homedir()
	return path.join(homeDir, ".agents")
}

/**
 * Gets the project-local .agents directory path for a given cwd.
 * This is a shared directory for agent skills across different AI coding tools.
 *
 * @param cwd - Current working directory (project path)
 * @returns The absolute path to the project-local .agents directory
 *
 * @example
 * ```typescript
 * const projectAgentsDir = getProjectAgentsDirectoryForCwd('/Users/john/my-project')
 * // Returns: "/Users/john/my-project/.agents"
 * ```
 */
export function getProjectAgentsDirectoryForCwd(cwd: string): string {
	return path.join(cwd, ".agents")
}

/**
 * Gets the project-local .tocodex directory path for a given cwd
 *
 * @param cwd - Current working directory (project path)
 * @returns The absolute path to the project-local .tocodex directory
 *
 * @example
 * ```typescript
 * const projectDir = getProjectRooDirectoryForCwd('/Users/john/my-project')
 * // Returns: "/Users/john/my-project/.tocodex"
 *
 * const windowsProjectDir = getProjectRooDirectoryForCwd('C:\\Users\\john\\my-project')
 * // Returns: "C:\\Users\\john\\my-project\\.tocodex"
 * ```
 *
 * @example Directory structure:
 * ```
 * /Users/john/my-project/
 * ├── .tocodex/                    # Project-local configuration directory
 * │   ├── rules/
 * │   │   └── rules.md
 * │   ├── custom-instructions.md
 * │   └── config/
 * │       └── settings.json
 * ├── src/
 * │   └── index.ts
 * └── package.json
 * ```
 */
export function getProjectRooDirectoryForCwd(cwd: string): string {
	return path.join(cwd, ".tocodex")
}

/**
 * Checks if a directory exists
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(dirPath)
		return stat.isDirectory()
	} catch (error: any) {
		// Only catch expected "not found" errors
		if (error.code === "ENOENT" || error.code === "ENOTDIR") {
			return false
		}
		// Re-throw unexpected errors (permission, I/O, etc.)
		throw error
	}
}

/**
 * Checks if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(filePath)
		return stat.isFile()
	} catch (error: any) {
		// Only catch expected "not found" errors
		if (error.code === "ENOENT" || error.code === "ENOTDIR") {
			return false
		}
		// Re-throw unexpected errors (permission, I/O, etc.)
		throw error
	}
}

/**
 * Reads a file safely, returning null if it doesn't exist
 */
export async function readFileIfExists(filePath: string): Promise<string | null> {
	try {
		return await fs.readFile(filePath, "utf-8")
	} catch (error: any) {
		// Only catch expected "not found" errors
		if (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "EISDIR") {
			return null
		}
		// Re-throw unexpected errors (permission, I/O, etc.)
		throw error
	}
}

/**
 * Discovers all .tocodex directories in subdirectories of the workspace
 *
 * @param cwd - Current working directory (workspace root)
 * @returns Array of absolute paths to .tocodex directories found in subdirectories,
 *          sorted alphabetically. Does not include the root .tocodex directory.
 *
 * @example
 * ```typescript
 * const subfolderRoos = await discoverSubfolderRooDirectories('/Users/john/monorepo')
 * // Returns:
 * // [
 * //   '/Users/john/monorepo/package-a/.tocodex',
 * //   '/Users/john/monorepo/package-b/.tocodex',
 * //   '/Users/john/monorepo/packages/shared/.tocodex'
 * // ]
 * ```
 *
 * @example Directory structure:
 * ```
 * /Users/john/monorepo/
 * ├── .tocodex/                    # Root .tocodex (NOT included - use getProjectRooDirectoryForCwd)
 * ├── package-a/
 * │   └── .tocodex/                # Included
 * │       └── rules/
 * ├── package-b/
 * │   └── .tocodex/                # Included
 * │       └── rules-code/
 * └── packages/
 *     └── shared/
 *         └── .tocodex/            # Included (nested)
 *             └── rules/
 * ```
 */
export async function discoverSubfolderRooDirectories(cwd: string): Promise<string[]> {
	try {
		// Dynamic import to avoid vscode dependency at module load time
		// This is necessary because file-search.ts imports vscode, which is not
		// available in the webview context
		const { executeRipgrep } = await import("../search/file-search")

		// Use ripgrep to find any file inside any .tocodex directory
		// This efficiently discovers all .tocodex folders regardless of their content
		const args = [
			"--files",
			"--hidden",
			"--follow",
			"-g",
			"**/.tocodex/**",
			"-g",
			"!node_modules/**",
			"-g",
			"!.git/**",
			cwd,
		]

		const results = await executeRipgrep({ args, workspacePath: cwd })

		// Extract unique .tocodex directory paths
		const rooDirs = new Set<string>()
		const rootRooDir = path.join(cwd, ".tocodex")

		for (const result of results) {
			// Match paths like "subfolder/.tocodex/anything" or "subfolder/nested/.tocodex/anything"
			// Handle both forward slashes (Unix) and backslashes (Windows)
			const match = result.path.match(/^(.+?)[/\\]\.tocodex[/\\]/)
			if (match) {
				const rooDir = path.join(cwd, match[1], ".tocodex")
				// Exclude the root .tocodex directory (already handled by getProjectRooDirectoryForCwd)
				if (rooDir !== rootRooDir) {
					rooDirs.add(rooDir)
				}
			}
		}

		// Return sorted alphabetically
		return Array.from(rooDirs).sort()
	} catch (error) {
		// If discovery fails (e.g., ripgrep not available), return empty array
		return []
	}
}

/**
 * Gets the ordered list of .tocodex directories to check (global first, then project-local)
 *
 * @param cwd - Current working directory (project path)
 * @returns Array of directory paths to check in order [global, project-local]
 *
 * @example
 * ```typescript
 * // For a project at /Users/john/my-project
 * const directories = getRooDirectoriesForCwd('/Users/john/my-project')
 * // Returns:
 * // [
 * //   '/Users/john/.tocodex',           // Global directory
 * //   '/Users/john/my-project/.tocodex' // Project-local directory
 * // ]
 * ```
 *
 * @example Directory structure:
 * ```
 * /Users/john/
 * ├── .tocodex/                    # Global configuration
 * │   ├── rules/
 * │   │   └── rules.md
 * │   └── custom-instructions.md
 * └── my-project/
 *     ├── .tocodex/                # Project-specific configuration
 *     │   ├── rules/
 *     │   │   └── rules.md     # Overrides global rules
 *     │   └── project-notes.md
 *     └── src/
 *         └── index.ts
 * ```
 */
export function getRooDirectoriesForCwd(cwd: string): string[] {
	const directories: string[] = []

	// Add global directory first
	directories.push(getGlobalRooDirectory())

	// Add project-local directory second
	directories.push(getProjectRooDirectoryForCwd(cwd))

	return directories
}

/**
 * Gets the ordered list of all .tocodex directories including subdirectories
 *
 * @param cwd - Current working directory (project path)
 * @returns Array of directory paths in order: [global, project-local, ...subfolders (alphabetically)]
 *
 * @example
 * ```typescript
 * // For a monorepo at /Users/john/monorepo with .tocodex in subfolders
 * const directories = await getAllRooDirectoriesForCwd('/Users/john/monorepo')
 * // Returns:
 * // [
 * //   '/Users/john/.tocodex',                    // Global directory
 * //   '/Users/john/monorepo/.tocodex',           // Project-local directory
 * //   '/Users/john/monorepo/package-a/.tocodex', // Subfolder (alphabetical)
 * //   '/Users/john/monorepo/package-b/.tocodex'  // Subfolder (alphabetical)
 * // ]
 * ```
 */
export async function getAllRooDirectoriesForCwd(cwd: string): Promise<string[]> {
	const directories: string[] = []

	// Add global directory first
	directories.push(getGlobalRooDirectory())

	// Add project-local directory second
	directories.push(getProjectRooDirectoryForCwd(cwd))

	// Discover and add subfolder .tocodex directories
	const subfolderDirs = await discoverSubfolderRooDirectories(cwd)
	directories.push(...subfolderDirs)

	return directories
}

/**
 * Gets parent directories containing .tocodex folders, in order from root to subfolders
 *
 * @param cwd - Current working directory (project path)
 * @returns Array of parent directory paths (not .tocodex paths) containing AGENTS.md or .tocodex
 *
 * @example
 * ```typescript
 * const dirs = await getAgentsDirectoriesForCwd('/Users/john/monorepo')
 * // Returns: ['/Users/john/monorepo', '/Users/john/monorepo/package-a', ...]
 * ```
 */
export async function getAgentsDirectoriesForCwd(cwd: string): Promise<string[]> {
	const directories: string[] = []

	// Always include the root directory
	directories.push(cwd)

	// Get all subfolder .tocodex directories
	const subfolderRooDirs = await discoverSubfolderRooDirectories(cwd)

	// Extract parent directories (remove .tocodex from path)
	for (const rooDir of subfolderRooDirs) {
		const parentDir = path.dirname(rooDir)
		directories.push(parentDir)
	}

	return directories
}

/**
 * Loads configuration from multiple .tocodex directories with project overriding global
 *
 * @param relativePath - The relative path within each .tocodex directory (e.g., 'rules/rules.md')
 * @param cwd - Current working directory (project path)
 * @returns Object with global and project content, plus merged content
 *
 * @example
 * ```typescript
 * // Load rules configuration for a project
 * const config = await loadConfiguration('rules/rules.md', '/Users/john/my-project')
 *
 * // Returns:
 * // {
 * //   global: "Global rules content...",     // From ~/.tocodex/rules/rules.md
 * //   project: "Project rules content...",   // From /Users/john/my-project/.tocodex/rules/rules.md
 * //   merged: "Global rules content...\n\n# Project-specific rules (override global):\n\nProject rules content..."
 * // }
 * ```
 *
 * @example File paths resolved:
 * ```
 * relativePath: 'rules/rules.md'
 * cwd: '/Users/john/my-project'
 *
 * Reads from:
 * - Global: /Users/john/.tocodex/rules/rules.md
 * - Project: /Users/john/my-project/.tocodex/rules/rules.md
 *
 * Other common relativePath examples:
 * - 'custom-instructions.md'
 * - 'config/settings.json'
 * - 'templates/component.tsx'
 * ```
 *
 * @example Merging behavior:
 * ```
 * // If only global exists:
 * { global: "content", project: null, merged: "content" }
 *
 * // If only project exists:
 * { global: null, project: "content", merged: "content" }
 *
 * // If both exist:
 * {
 *   global: "global content",
 *   project: "project content",
 *   merged: "global content\n\n# Project-specific rules (override global):\n\nproject content"
 * }
 * ```
 */
export async function loadConfiguration(
	relativePath: string,
	cwd: string,
): Promise<{
	global: string | null
	project: string | null
	merged: string
}> {
	const globalDir = getGlobalRooDirectory()
	const projectDir = getProjectRooDirectoryForCwd(cwd)

	const globalFilePath = path.join(globalDir, relativePath)
	const projectFilePath = path.join(projectDir, relativePath)

	// Read global configuration
	const globalContent = await readFileIfExists(globalFilePath)

	// Read project-local configuration
	const projectContent = await readFileIfExists(projectFilePath)

	// Merge configurations - project overrides global
	let merged = ""

	if (globalContent) {
		merged += globalContent
	}

	if (projectContent) {
		if (merged) {
			merged += "\n\n# Project-specific rules (override global):\n\n"
		}
		merged += projectContent
	}

	return {
		global: globalContent,
		project: projectContent,
		merged: merged || "",
	}
}

// Export with backward compatibility alias
export const loadRooConfiguration: typeof loadConfiguration = loadConfiguration

import * as path from "path"
import * as os from "os"
import * as vscode from "vscode"
import { getWorkspacePath } from "../../utils/path"
import { t } from "../../i18n"

export async function openImage(dataUriOrPath: string, options?: { values?: { action?: string } }) {
	// Check if it's a file path (absolute or relative)
	const isFilePath =
		!dataUriOrPath.startsWith("data:") &&
		!dataUriOrPath.startsWith("http:") &&
		!dataUriOrPath.startsWith("https:") &&
		!dataUriOrPath.startsWith("vscode-resource:") &&
		!dataUriOrPath.startsWith("file+.vscode-resource")

	if (isFilePath) {
		// Handle file path - open directly in VSCode
		try {
			// Resolve the path relative to workspace if needed
			let filePath = dataUriOrPath
			if (!path.isAbsolute(filePath)) {
				const workspacePath = getWorkspacePath()
				if (workspacePath) {
					filePath = path.join(workspacePath, filePath)
				}
			}

			const fileUri = vscode.Uri.file(filePath)

			// Check if this is a copy action
			if (options?.values?.action === "copy") {
				await vscode.env.clipboard.writeText(filePath)
				vscode.window.showInformationMessage(t("common:info.path_copied_to_clipboard"))
				return
			}

			// Open the image file directly. Try VSCode's built-in command first, fall back to OS default app
			// for non-VSCode hosts (e.g. Cursor, code-server) where "vscode.open" may not be registered.
			try {
				await vscode.commands.executeCommand("vscode.open", fileUri)
			} catch {
				await vscode.env.openExternal(fileUri)
			}
		} catch (error) {
			vscode.window.showErrorMessage(t("common:errors.error_opening_image", { error }))
		}
		return
	}

	// Handle data URI (existing logic)
	const matches = dataUriOrPath.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/)
	if (!matches) {
		vscode.window.showErrorMessage(t("common:errors.invalid_data_uri"))
		return
	}
	const [, format, base64Data] = matches
	const imageBuffer = Buffer.from(base64Data, "base64")

	// Default behavior: open the image
	const tempFilePath = path.join(os.tmpdir(), `temp_image_${Date.now()}.${format}`)
	try {
		await vscode.workspace.fs.writeFile(vscode.Uri.file(tempFilePath), imageBuffer)
		// Check if this is a copy action
		if (options?.values?.action === "copy") {
			try {
				// Read the image file
				const imageData = await vscode.workspace.fs.readFile(vscode.Uri.file(tempFilePath))

				// Convert to base64 for clipboard
				const base64Image = Buffer.from(imageData).toString("base64")
				const dataUri = `data:image/${format};base64,${base64Image}`

				// Use vscode.env.clipboard to copy the data URI
				// Note: VSCode doesn't support copying binary image data directly to clipboard
				// So we copy the data URI which can be pasted in many applications
				await vscode.env.clipboard.writeText(dataUri)

				vscode.window.showInformationMessage(t("common:info.image_copied_to_clipboard"))
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				vscode.window.showErrorMessage(t("common:errors.error_copying_image", { errorMessage }))
			} finally {
				// Clean up temp file
				try {
					await vscode.workspace.fs.delete(vscode.Uri.file(tempFilePath))
				} catch {
					// Ignore cleanup errors
				}
			}
			return
		}
		try {
			await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(tempFilePath))
		} catch {
			// Fallback for non-VSCode hosts where "vscode.open" command is unavailable
			await vscode.env.openExternal(vscode.Uri.file(tempFilePath))
		}
	} catch (error) {
		vscode.window.showErrorMessage(t("common:errors.error_opening_image", { error }))
	}
}

/**
 * Save an image to a user-chosen location.
 * Supports both data URIs (base64) and file paths (direct copy).
 */
export async function saveImage(
	dataUriOrPath: string,
	defaultUri: vscode.Uri,
	sourcePath?: string,
): Promise<vscode.Uri | undefined> {
	// If a source file path is provided, copy the file directly
	if (sourcePath) {
		return saveImageFromPath(sourcePath, defaultUri)
	}

	// Try data URI format
	const matches = dataUriOrPath.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/)
	if (!matches) {
		// Also try to detect if it's a file path (not a webview URI or data URI)
		const isFilePath =
			!dataUriOrPath.startsWith("data:") &&
			!dataUriOrPath.startsWith("http:") &&
			!dataUriOrPath.startsWith("https:") &&
			!dataUriOrPath.startsWith("vscode-resource:") &&
			!dataUriOrPath.startsWith("file+.vscode-resource")
		if (isFilePath) {
			return saveImageFromPath(dataUriOrPath, defaultUri)
		}
		vscode.window.showErrorMessage(t("common:errors.invalid_data_uri"))
		return undefined
	}
	const [, format, base64Data] = matches
	const imageBuffer = Buffer.from(base64Data, "base64")

	// Show save dialog
	const saveUri = await vscode.window.showSaveDialog({
		filters: {
			Images: [format],
			"All Files": ["*"],
		},
		defaultUri: defaultUri,
	})

	if (!saveUri) {
		// User cancelled the save dialog
		return undefined
	}

	try {
		// Write the image to the selected location
		await vscode.workspace.fs.writeFile(saveUri, imageBuffer)
		vscode.window.showInformationMessage(t("common:info.image_saved", { path: saveUri.fsPath }))
		return saveUri
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		vscode.window.showErrorMessage(t("common:errors.error_saving_image", { errorMessage }))
		return undefined
	}
}

/**
 * Save an image from a file path by copying it to a user-chosen location.
 */
async function saveImageFromPath(filePath: string, defaultUri: vscode.Uri): Promise<vscode.Uri | undefined> {
	try {
		// Resolve the path
		let resolvedPath = filePath
		if (!path.isAbsolute(resolvedPath)) {
			const workspacePath = getWorkspacePath()
			if (workspacePath) {
				resolvedPath = path.join(workspacePath, resolvedPath)
			}
		}

		const sourceUri = vscode.Uri.file(resolvedPath)
		const ext = path.extname(resolvedPath).toLowerCase().replace(".", "") || "png"

		// Use the source filename as default
		const sourceFilename = path.basename(resolvedPath)
		const effectiveDefaultUri = vscode.Uri.file(
			path.join(path.dirname(defaultUri.fsPath || resolvedPath), sourceFilename),
		)

		// Show save dialog
		const saveUri = await vscode.window.showSaveDialog({
			filters: {
				Images: [ext],
				"All Files": ["*"],
			},
			defaultUri: effectiveDefaultUri,
		})

		if (!saveUri) {
			return undefined
		}

		// Copy the file
		await vscode.workspace.fs.copy(sourceUri, saveUri, { overwrite: true })
		vscode.window.showInformationMessage(t("common:info.image_saved", { path: saveUri.fsPath }))
		return saveUri
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		vscode.window.showErrorMessage(t("common:errors.error_saving_image", { errorMessage }))
		return undefined
	}
}

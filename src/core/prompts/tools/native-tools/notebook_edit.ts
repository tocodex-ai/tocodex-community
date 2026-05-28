import type OpenAI from "openai"

const NOTEBOOK_EDIT_DESCRIPTION = `Edit a Jupyter notebook (.ipynb) cell. Use this tool instead of write_to_file when editing .ipynb files.

Parameters:
- path: (required) The path to the Jupyter notebook file (.ipynb)
- operation: (required) The edit operation: "replace", "insert", or "delete"
- cellIndex: (required) The 0-based index of the cell to edit. For insert, the new cell is inserted at this position.
- cellType: (optional) The cell type: "code" or "markdown". Required for insert operations.
- content: (optional) The new cell content. Required for replace and insert operations.

Notes:
- When replacing a code cell, the execution_count is reset but existing outputs are preserved
- When inserting a new code cell, it starts with empty outputs
- The cellIndex is 0-based (first cell is 0)
- For insert, cellIndex can equal the total number of cells to append at the end
- File must have .ipynb extension

Example: Replace cell 2 with new code
{ "path": "notebook.ipynb", "operation": "replace", "cellIndex": 2, "cellType": null, "content": "import pandas as pd\\ndf = pd.read_csv('data.csv')" }

Example: Insert a new markdown cell at position 0
{ "path": "notebook.ipynb", "operation": "insert", "cellIndex": 0, "cellType": "markdown", "content": "# Data Analysis" }

Example: Delete cell 3
{ "path": "notebook.ipynb", "operation": "delete", "cellIndex": 3, "cellType": null, "content": null }`

export default {
	type: "function",
	function: {
		name: "notebook_edit",
		description: NOTEBOOK_EDIT_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "The path to the Jupyter notebook file (.ipynb)",
				},
				operation: {
					type: "string",
					enum: ["replace", "insert", "delete"],
					description: "The edit operation to perform",
				},
				cellIndex: {
					type: "number",
					description: "The 0-based index of the cell to edit",
				},
				cellType: {
					type: ["string", "null"],
					description: "The cell type (code or markdown). Required for insert.",
				},
				content: {
					type: ["string", "null"],
					description: "The new cell content. Required for replace and insert.",
				},
			},
			required: ["path", "operation", "cellIndex", "cellType", "content"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

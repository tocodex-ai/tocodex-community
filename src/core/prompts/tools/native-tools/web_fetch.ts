import type OpenAI from "openai"

const WEB_FETCH_DESCRIPTION = `Request to fetch the content of a URL and convert it to Markdown. Use this tool when you need to read documentation, GitHub issues, API references, or other web content.

Parameters:
- url: (required) The URL to fetch content from
- prompt: (optional) A prompt to extract specific information from the fetched content. If provided, only the relevant parts will be returned.
- maxLength: (optional) Maximum character length for the returned content. Defaults to 100000.

Notes:
- Content is automatically converted from HTML to Markdown for readability
- URLs pointing to images or PDFs will return an appropriate notice instead of binary content
- Trusted domains (github.com, npmjs.com, nodejs.org, developer.mozilla.org, stackoverflow.com) are auto-approved
- Fetch timeout is 10 seconds
- Content exceeding maxLength will be truncated with head + tail preservation

Example: Fetching a GitHub issue
{ "url": "https://github.com/owner/repo/issues/123", "prompt": null, "maxLength": null }

Example: Fetching API docs with extraction
{ "url": "https://nodejs.org/api/fs.html", "prompt": "Extract the readFile API signature and parameters", "maxLength": null }`

export default {
	type: "function",
	function: {
		name: "web_fetch",
		description: WEB_FETCH_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				url: {
					type: "string",
					description: "The URL to fetch content from",
				},
				prompt: {
					type: ["string", "null"],
					description: "Optional prompt to extract specific information from the fetched content",
				},
				maxLength: {
					type: ["number", "null"],
					description: "Maximum character length for returned content. Defaults to 100000",
				},
			},
			required: ["url", "prompt", "maxLength"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

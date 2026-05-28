# ToCodex Community

ToCodex Community is a maintained open-source AI coding agent for VS Code, evolved from Roo Code and kept independent for community use. It focuses on practical engineering workflows: planning, editing, debugging, terminal work, MCP tools, multi-model providers, and repeatable project automation inside the editor.

Website: https://tocodex.com
Source: https://github.com/tocodex-ai/tocodex-community

ToCodex Community is based on Roo Code and preserves Apache-2.0 upstream attribution. ToCodex is not affiliated with Roo Code, Inc. Roo Code is a trademark of its respective owner.

## Highlights

- Maintained VS Code extension for AI-assisted software development.
- BYOK, local models, OpenAI-compatible providers, and configurable model routing.
- MCP integration for external tools, services, and project-specific workflows.
- Custom modes, slash commands, skills, hooks, and scheduled tasks.
- Context-aware file search, code editing, terminal interaction, worktree support, and task history.
- Community-oriented source distribution with telemetry disabled and cloud implementation stubbed.
- Optional ToCodex Desktop, Cloud, and Enterprise offerings remain separate commercial products.

## Global AI Coding Tool Comparison

The AI coding market is moving quickly, and each product makes different trade-offs between model freedom, in-editor editing, agent loops, terminal capability, extensibility, and enterprise controls. The comparison below is a high-level product-positioning view based on public product information and observed capabilities; details may change as each vendor updates its product.

### Key Capability Radar

| Tool | Model Freedom | In-Editor Editing | Agent Loop | Terminal Capability | Extensibility | Enterprise Readiness |
| --- | --- | --- | --- | --- | --- | --- |
| ToCodex Community | High: BYOK, local models, OpenAI-compatible providers, configurable routing | Strong: VS Code webview plus editor actions | Strong: task loop, tools, plan mode, subtasks | Strong: terminal tools and command workflows | Strong: MCP, custom modes, slash commands, skills, hooks | Community source plus separate commercial offerings |
| Claude Code | Medium: Claude-focused | Medium: terminal-first workflow | Strong: terminal agent | Strong: shell-native usage | Medium: MCP support | Enterprise-oriented Claude plans |
| OpenAI Codex / Codex CLI | Medium: OpenAI model family | Medium: CLI and cloud task flow | Strong: coding agent and task queue | Strong: CLI/cloud workflow | Medium: CLI extensibility and repo context | ChatGPT Enterprise/API ecosystem |
| Cursor | Medium: curated model choices plus user keys | Strong: editor-native autocomplete and chat | Medium: agent mode | Medium: terminal/editor integration | Medium: editor extensions and MCP-style integrations | Enterprise plan available |
| Kiro | Medium: spec-driven workflow | Medium: IDE-integrated edits | Medium: agent/spec mode | Medium: IDE task flow | Medium: hooks/spec/project workflow | Enterprise integrations through AWS ecosystem |
| Trae | Medium: provider-integrated | Strong: IDE-native builder/editor flow | Medium: builder agent | Medium: integrated terminal workflow | Medium: tool ecosystem | Team/Pro-oriented capability set |

### Feature Matrix

| Capability | ToCodex Community | Claude Code | OpenAI Codex / Codex CLI | Cursor | Kiro | Trae |
| --- | --- | --- | --- | --- | --- | --- |
| Agent mode | Agent loop inside VS Code | Terminal agent | Cloud/CLI coding agent | Editor agent mode | Spec/agent workflow | Builder agent |
| Model support | BYOK, local models, OpenAI-compatible providers | Claude-focused | OpenAI model family | Curated providers and user keys | Limited public provider surface | Multi-provider oriented |
| Local models | Ollama / LM Studio / compatible endpoints | Not primary | Not primary | Ollama support | Not primary | Limited/varies by edition |
| Code completion | Task and edit oriented; completion can be provider-driven | Not primary | Not primary | Tab completion first | Inline/spec-assisted edits | Inline/editor completion |
| Parallel tasks | Subtasks and `new_task` workflows | Process-level parallelism | Cloud/queue based tasks | Not primary | Not primary | Not primary |
| Planning mode | Plan Mode and custom modes | `/plan` style planning | Task planning | Think/agent planning | Spec-first planning | Planning workflow |
| Checkpoints | Git checkpoint support | External Git workflow | PR/diff review flow | Built-in restore/checkpoint behavior | Built-in restore/checkpoint behavior | Built-in restore/checkpoint behavior |
| MCP protocol | stdio / SSE / HTTP | Supported | CLI extensibility | Supported | Powers/tools integrations | Supported |
| Custom modes | Multi-mode system | Not primary | Prompt/command driven | Not primary | Not primary | Not primary |
| Skills | Skills framework | Not primary | Custom command style | Not primary | Not primary | Not primary |
| Web access | `web_fetch` tool support | WebFetch-style tool support | Web-connected features | Not primary | Not primary | Not primary |
| LSP integration | Semantic code intelligence and diagnostics | LSP-aware workflows | Repository context | Code intelligence | Varies | Varies |
| Context and memory | Project context, task history, memory-oriented architecture | Conversation and repo context | Repo/task context | Editor/repo context | Spec/project context | Project context |
| Internationalization | Broad locale coverage | English-first | English-first | Varies | Varies | Chinese/English oriented |
| Pricing posture | Open-source community build; bring your own keys | Paid Claude plans | ChatGPT/API plans | Paid plans | Preview/paid plans vary | Free/Pro plans vary |

In short, ToCodex Community is positioned as an open, extensible VS Code agent runtime for developers who want model choice, local-provider support, MCP tooling, custom modes, and transparent source code. Commercial ToCodex offerings can add hosted routing, account services, team controls, and enterprise support without making the community edition depend on closed-source services.

## Architecture

### Extension Code Architecture

![ToCodex plugin code architecture](docs/images/tocodex-plugin-code-architecture.png)

The VS Code extension host coordinates task lifecycle, provider configuration, command registration, webview state, MCP access, and filesystem operations. The webview provides the interactive product surface while the extension host keeps privileged IDE operations on the VS Code side.

### Context Engineering

![Context engineering architecture](docs/images/context-engineering-architecture.png)

The context layer prepares relevant project state for model calls: workspace files, terminal output, tool results, conversation history, mode instructions, memory, and user-provided context. This keeps model requests grounded in the active task without requiring the full repository to be sent every time.

### Function And Model Collaboration Flow

![Function model module collaboration flow](docs/images/function-model-module-collaboration-flow.png)

ToCodex Community separates model providers, task orchestration, native tools, webview messages, and persistence. This lets model output drive tool calls while the extension validates, executes, reports, and stores each step.

### Memory System

![Memory system architecture](docs/images/memory-system-architecture.png)

The memory system is designed to preserve useful long-running project knowledge while keeping short-term conversation context manageable. It supports project-level and global memory operations that can be used by modes and tasks.

## Repository Layout

```text
src/                VS Code extension host, providers, task runtime, tools
webview-ui/         React webview UI shown inside VS Code
packages/           Shared packages for types, build, core, telemetry stub, cloud stub
locales/            Localized public documentation
icons/              Product icons and visual assets
docs/images/        Public architecture diagrams
scripts/            Build and packaging helper scripts
.github/            Public CI, issue templates, PR template, security notes
```

## Development

Prerequisites:

- Node.js `20.19.2`
- pnpm `10.8.1`

Install and build:

```sh
pnpm install
pnpm build
```

Package the VSIX:

```sh
pnpm vsix
```

The generated VSIX is written to `bin/`, which is intentionally ignored by Git.

## Community Build Notes

This community build is intended to work independently with BYOK, local providers, and OpenAI-compatible providers. The open-source `packages/cloud` package is a compatibility stub, and telemetry is disabled in the community distribution.

For hosts that report VS Code `1.1.1`, use the helper script after standard packaging:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/patch-vsix-engine.ps1 -InputVsix bin/tocodex-community-3.2.0.vsix -OutputVsix bin/tocodex-community-3.2.0-vscode-1.1.1.vsix -VsCodeEngine ^^1.1.1
```

## License

ToCodex Community is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for the full license text, upstream attribution, and trademark notes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, issue-first workflow, and pull request guidelines.

## Security

Please report security issues according to [SECURITY.md](SECURITY.md). Do not include secrets, private keys, API keys, or infrastructure credentials in public issues or pull requests.

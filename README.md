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

## What ToCodex Adds Beyond Roo Code

ToCodex Community is maintained as an independent continuation based on Roo Code, with upstream attribution preserved. The upgrade summary below is consolidated from the ToCodex source planning docs, implementation task lists, architecture report, and release memos in the main ToCodex codebase.

### Platform Migration From Roo Code

The first ToCodex platform work converted the Roo Code extension into an independent ToCodex build while keeping the proven VS Code extension architecture intact.

| Area | ToCodex Change |
| --- | --- |
| Brand and packaging | Renamed public extension metadata, icons, package output, user-facing strings, settings text, and documentation links for ToCodex distribution. |
| Router and authentication | Replaced Roo Code Cloud / Clerk-oriented flows with a ToCodex Router path and a NewAPI-style API key bridge, including environment overrides for API and auth endpoints. |
| Community boundary | Kept local BYOK, OpenAI-compatible, MCP, modes, task runtime, and webview workflows usable while stubbing closed cloud behavior in the community edition. |
| UI simplification | Reworked account, about, welcome, provider, and model-selection surfaces so ToCodex can operate independently without Roo Code Cloud-specific product flows. |

### v2 Major Upgrade: Agent Runtime Expansion

The v2 upgrade plan added 19 capability groups on top of the existing Roo Code-derived base. Its implementation task list marks the core, experience, and advanced phases complete except for final voice-input UI integration.

| Phase | Major Additions |
| --- | --- |
| Core reliability and code intelligence | Added `lsp_code_intelligence`, smarter semantic tool repetition detection, retry/fallback strategy, file read caching, `web_fetch`, and automatic tool-result summarization for large outputs. |
| Experience and control | Added real-time task progress summaries, precise cost tracking, persisted todo progress, explicit Plan Mode, context health analysis, token budget parsing, and auxiliary/light model routing. |
| Advanced automation | Added project memory, `spawn_parallel_task`, `notebook_edit`, Agent Hooks, deferred `tool_search`, and stronger task orchestration for larger multi-file work. |
| Verification posture | Added property-based checks around LSP behavior, memory idempotency, retry limits, cache invalidation, token budget parsing, result summarization, Plan Mode isolation, parallel-task limits, and hook ordering. |

### 3.1.x Product And Stability Upgrades

After the v2 platform upgrade, ToCodex continued shipping practical improvements around model control, context handling, image generation, browser automation, and scheduled work.

| Area | Upgrade Summary |
| --- | --- |
| Image generation | Added a dedicated Image Gen mode, enabled image generation by default for new users, aligned ToCodex image models with server routes, and supported text-to-image, image-to-image, and image-editing paths. |
| Context resilience | Changed automatic condense to a 90% default threshold, removed misleading max-output-token reservation from the trigger calculation, and added token-based hard truncation when very large context condense fails. |
| Reasoning and provider UX | Made reasoning-effort controls visible for ToCodex dynamic models when users explicitly enable them, kept unsupported models quiet by default, and pinned ToCodex plus OpenAI Compatible near the top of provider selection. |
| Browser workflow | Added browser-oriented mode planning around Playwright MCP, Node/npm availability, local Chrome/Edge reuse, persistent browser profiles, CDP takeover, proxy/mirror fallback, and remote-development degradation paths. |
| Scheduled tasks | Fixed scheduled tasks as background tasks so timed runs do not cancel or get cancelled by the user's active foreground conversation. |
| Remote and automation modes | Packaged SSH Server mode and embedded MCP support so ToCodex can cover server diagnostics, Docker/log inspection, database queries, and external tool workflows from the same agent surface. |

### Current Functional Mode Expansion

ToCodex organizes work into purpose-built modes so the agent can follow different rules, tools, and review expectations for different tasks.

| Mode Area | Updates And Purpose |
| --- | --- |
| Core engineering modes | Architect, Code, Ask, Debug, and Orchestrator cover planning, implementation, explanation, troubleshooting, and multi-step coordination. |
| Browser Task mode | Adds browser-oriented task execution for workflows that need page interaction, inspection, login-state handling, or web UI operation. |
| Scheduled Task mode | Adds timed and repeatable background automation so planned work can run without interrupting the active chat task. |
| Repository collaboration modes | Issue Fixer, PR Fixer, Merge Resolver, Issue Investigator, and Issue Writer focus on GitHub issue/PR workflows, failed checks, merge conflicts, root-cause analysis, and structured issue creation. |
| Documentation and localization modes | Docs Extractor and Translate modes help extract feature details, maintain documentation, and handle i18n work with task-specific behavior. |
| User-defined workflows | Custom modes let teams define their own roles, tool access, prompts, and operating boundaries for project-specific practices. |

### Deduplicated Capability Themes

| Theme | Capability Added Or Strengthened |
| --- | --- |
| Model freedom | BYOK, local models, Ollama, LM Studio, OpenAI-compatible providers, auxiliary/light models, dynamic model routing, and configurable reasoning controls reduce dependence on a single model vendor. |
| Extensible tools | MCP over stdio/SSE/HTTP, embedded MCP packaging, Skills, slash commands, hooks, custom tools, SSH Server mode, browser workflows, and marketplace-style loading extend ToCodex for real projects. |
| Agent orchestration | Plan Mode, todo persistence, `new_task` delegation, parallel subtasks, mode switching, task history, checkpoints, scheduled tasks, and Git worktree support help break large work into controlled steps. |
| Context and memory | Codebase indexing, semantic search, LSP code intelligence, diagnostics, project memory, context compression, token-based truncation, cache visibility, and web fetch improve grounding across larger repositories. |
| Safer automation | Fine-grained auto-approval, run-all-commands control, command allow/deny lists, protected files, RooIgnore-style exclusions, checkpoints, hook gates, and rollback-oriented Git workflows make automation more controllable. |
| Developer surfaces | VS Code webview UX, editor actions, terminal workflows, notebook editing, multimodal image input, image generation/editing, import/export settings, profiles, browser profiles, and project memos broaden day-to-day usage. |
| Community distribution | The community build keeps source available, disables telemetry, stubs closed cloud dependencies, updates branding/package metadata, and maintains independent documentation and release notes. |

## Global AI Coding Tool Comparison

The AI coding market is moving quickly, and each product makes different trade-offs between model freedom, in-editor editing, agent loops, terminal capability, extensibility, and enterprise controls. The comparison below uses the visual comparison assets prepared for ToCodex Community; details may change as each vendor updates its product.

### Functional Modes

![ToCodex Community functional modes](docs/images/tocodex-functional-modes.png)

### Key Capability Radar

![Market mainstream AI Coding key capability comparison](docs/images/ai-coding-capability-radar.png)

### Feature Matrix

![Detailed AI coding tools feature matrix](docs/images/ai-coding-feature-matrix.png)

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

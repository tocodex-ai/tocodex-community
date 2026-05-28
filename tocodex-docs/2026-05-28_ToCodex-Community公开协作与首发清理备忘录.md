# ToCodex Community 公开协作与首发清理备忘录

## 摘要

本次清理修复了公开仓库首发前发现的协作入口、旧社区链接、测试脚本和 Webview 构建产物策略问题。公开文档和 Webview 入口已统一指向 `tocodex-ai/tocodex-community`，根目录补齐最小 `.github/` 协作配置，测试脚本改为明确说明当前未随源码发布公共 Vitest 测试，`src/webview-ui/build/` 改为由构建生成并通过 `.gitignore` 排除。

## 主要变更

- 重写 `CONTRIBUTING.md`：
  - 标题改为 `Contributing to ToCodex Community`。
  - 协作入口统一为 `https://github.com/tocodex-ai/tocodex-community`。
  - 明确公共验证命令为 `pnpm check-types` 和 `pnpm build`。
  - 说明 `pnpm test` 当前是公共测试占位 no-op。
- 清理旧链接：
  - 替换公开文档、本地化文档、Webview 组件和 i18n 文案中的旧 `RooCodeInc`、`discord.gg/roocode`、旧 Reddit/Roo Code Docs 链接。
  - `webview-ui/src/components/ErrorBoundary.tsx` 和 `webview-ui/src/components/marketplace/IssueFooter.tsx` 已指向 `tocodex-ai/tocodex-community` issue 入口。
- 新增 `.github/` 公开协作配置：
  - `.github/workflows/ci.yml`
  - `.github/ISSUE_TEMPLATE/bug_report.yml`
  - `.github/ISSUE_TEMPLATE/enhancement.yml`
  - `.github/pull_request_template.md`
  - `.github/SECURITY.md`
- 调整测试脚本：
  - 根 `package.json` 以及 `webview-ui/package.json`、`src/package.json`、`packages/cloud/package.json`、`packages/telemetry/package.json`、`packages/types/package.json`、`packages/core/package.json`、`packages/build/package.json` 的 `test` 脚本改为明确 no-op 提示。
  - 移除 `webview-ui/package.json` 和 `src/package.json` 中不再适用的 `pretest`。
- 调整构建产物策略：
  - `.gitignore` 新增 `src/webview-ui/build/`。
  - 删除当前工作区中的 `src/webview-ui/build/` 生成产物，避免提交 sourcemap 和打包 JS。
- 修复验证中发现的 `src/core/task/Task.ts` 既有乱码注释断行问题，恢复 `nativeToolParser` 字段声明和相关语法，使类型检查重新通过。

## 变更文件

- `.gitignore`
- `.github/workflows/ci.yml`
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/enhancement.yml`
- `.github/pull_request_template.md`
- `.github/SECURITY.md`
- `CONTRIBUTING.md`
- `README.md`
- `package.json`
- `webview-ui/package.json`
- `src/package.json`
- `packages/cloud/package.json`
- `packages/telemetry/package.json`
- `packages/types/package.json`
- `packages/core/package.json`
- `packages/build/package.json`
- `webview-ui/src/components/ErrorBoundary.tsx`
- `webview-ui/src/components/marketplace/IssueFooter.tsx`
- `webview-ui/src/i18n/locales/*/settings.json`
- `locales/**/README.md`
- `locales/**/CONTRIBUTING.md`
- `src/core/task/Task.ts`
- `tocodex-docs/2026-05-25_ToCodex开源计划与RooCode用户承接文案备忘录.md`
- `tocodex-docs/2026-05-27_ToCodex-Community开源版分离方案.md`

## 验证结果

- 旧链接扫描：通过，未再发现 `RooCodeInc`、`discord.gg/roocode`、`reddit.com/r/RooCode`、`Roo-Code-Docs`、`github.com/RooCodeInc/Roo-Code` 残留。
- 测试脚本扫描：通过，未再发现 `vitest run` 或 `turbo test` 作为 `package.json` 的 `test` 脚本。
- JSON 解析：通过。
- `pnpm test`：通过，输出当前没有随源码发布公共测试、应运行 `pnpm check-types && pnpm build` 的提示。
- `pnpm check-types`：通过。
- `pnpm build`：通过。
- `src/webview-ui/build/`：验证后已删除，并由 `.gitignore` 排除。

## 注意事项

- 当前运行环境 Node 为 `v22.22.0`，项目声明期望 Node `20.19.2`，验证命令会打印 engine warning，但本次 `check-types`、`build` 和 `test` 均已完成。
- 当前工作区不是 Git 仓库，无法通过 `git status` 判断哪些文件已跟踪；如果后续在真正 Git 仓库中应用这些改动，需要确认 `src/webview-ui/build/` 产物已从索引移除。

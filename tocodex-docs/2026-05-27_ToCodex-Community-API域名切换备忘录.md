# ToCodex Community API 域名切换备忘录

日期：2026-05-27

## 摘要

按社区开源版要求，将 ToCodex API 默认域名从 `https://api.tocodex.com` 切换为 `https://api.ruteapi.com`。社区版源码统一通过默认常量读取 API 地址，仍保留 `TOCODEX_API_URL` 环境变量覆盖能力，便于本地调试或自定义部署。

## 主要变更

- `src/api/providers/constants.ts`
  - 新增 `DEFAULT_TOCODEX_API_URL = process.env.TOCODEX_API_URL ?? "https://api.ruteapi.com"`。
- `src/api/providers/roo.ts`
  - Roo/ToCodex provider 默认 `baseURL` 改为 `DEFAULT_TOCODEX_API_URL`。
- `src/api/providers/fetchers/modelCache.ts`
  - Roo 模型列表拉取默认 `baseUrl` 改为 `DEFAULT_TOCODEX_API_URL`。
  - 后台模型缓存预热默认 `baseUrl` 改为 `DEFAULT_TOCODEX_API_URL`。
- `src/extension.ts`
  - 登录态模型刷新与激活后模型预热统一使用 `DEFAULT_TOCODEX_API_URL`。
- `src/extension/api.ts`
  - 外部 API 的 `GetModels` 命令统一使用 `DEFAULT_TOCODEX_API_URL`。
- `src/core/webview/webviewMessageHandler.ts`
  - Router 模型刷新、Roo 模型刷新、手动 API Key 绑定后的模型刷新统一使用 `DEFAULT_TOCODEX_API_URL`。
- `packages/cloud/src/index.ts`
  - 社区版兼容 stub 的 `getRooCodeApiUrl()` / `getToCodexApiUrl()` 返回 `https://api.ruteapi.com`。

## 验证结果

- `pnpm check-types`：通过。
- `pnpm build`：通过。
- 公开源码域名扫描：通过，结果为 `NO_API_TOCODEX_MATCHES_IN_PUBLIC_SOURCE`。

## 注意事项

- 验证期间仍有 Node engine 警告：项目期望 `node 20.19.2`，当前环境为 `v22.22.0`；未阻断类型检查和构建。
- `.tocodex/` 和 `tocodex-docs/` 属内部工作区/备忘录内容，公开发布前仍应排除。

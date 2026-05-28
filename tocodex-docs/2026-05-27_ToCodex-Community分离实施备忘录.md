# ToCodex Community 分离实施备忘录

## 摘要

已按白名单方式在本地独立目录 `G:\src\AI_IDE\for_vs_code\ToCodex-Community` 完成 ToCodex Community 开源版分离、闭源/内部能力清理、社区版替换实现、敏感信息扫描与构建验证。

## 主要变更

- `G:\src\AI_IDE\for_vs_code\ToCodex-Community\packages\telemetry\src\index.ts`
  - 替换为社区版 no-op 遥测实现，保留现有调用方需要的公开方法，移除私有 PostHog 行为。
- `G:\src\AI_IDE\for_vs_code\ToCodex-Community\packages\cloud\src\index.ts`
  - 替换为社区版 Cloud/Auth/Share/Settings no-op 实现，保留类型兼容方法，禁用账号、组织、云分享等闭源能力。
- `G:\src\AI_IDE\for_vs_code\ToCodex-Community\src\core\webview\ClineProvider.ts`
  - 恢复 UTF-8 无 BOM 内容，并将内部 `ssh-server.cjs` 引用替换为 `community-placeholder.cjs`。
- `G:\src\AI_IDE\for_vs_code\ToCodex-Community\src\api\providers\fetchers\modelCache.ts`
  - 清理私有 API 默认地址引用。
- `G:\src\AI_IDE\for_vs_code\ToCodex-Community\src\api\providers\roo.ts`
  - 清理私有 API 默认地址引用。
- `G:\src\AI_IDE\for_vs_code\ToCodex-Community\src\core\webview\webviewMessageHandler.ts`
  - 清理私有 API 默认地址引用，并保持云分享禁用后的调用兼容。
- `G:\src\AI_IDE\for_vs_code\ToCodex-Community\src\extension\api.ts`
  - 清理私有 API 默认地址引用。
- `G:\src\AI_IDE\for_vs_code\ToCodex-Community\src\extension.ts`
  - 清理私有 API 默认地址引用，并将 PostHog 遥测客户端替换为 no-op telemetry client。
- `G:\src\AI_IDE\for_vs_code\ToCodex-Community`
  - 删除 `__tests__`、`*.spec.ts(x)`、`*.test.ts(x)` 等测试文件，避免私有 API 依赖进入社区导出。
- `.tocodex/plans/tocodex-community-separation-plan.md`
  - 保存社区版分离计划。
- `tocodex-docs/2026-05-27_ToCodex-Community开源版分离方案.md`
  - 复制保存公开版分离方案文档。

## 验证结果

在 `G:\src\AI_IDE\for_vs_code\ToCodex-Community` 中完成验证：

- `pnpm check-types`：通过。
- `pnpm build`：通过。
- 敏感信息扫描：通过，结果为 `NO_SENSITIVE_MATCHES`。
- 测试文件残留扫描：通过，结果为 `NO_TEST_FILES`。

## 注意事项

- 验证期间出现 Node engine 警告：项目期望 `node 20.19.2`，当前环境为 `v22.22.0`；该项仅为警告，未阻断类型检查和构建。
- 社区版中的 Cloud、账号、组织、云分享、Telemetry 均已按 no-op/禁用方式保留接口兼容，不包含私有后端默认地址或私有遥测上报行为。

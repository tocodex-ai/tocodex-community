# ToCodex Community 分离测试报告

生成时间：2026-05-27 23:00:46 +08:00

## 测试结论

- `pnpm check-types`：通过
- `pnpm build`：通过
- 敏感信息扫描：通过，未发现敏感匹配
- 测试文件残留扫描：通过，未发现测试文件残留

## 测试范围

本次分离后的验证覆盖以下项目：

- TypeScript 类型检查：确认社区版替换后的 Cloud/Auth/Share/Telemetry no-op 接口仍与主代码调用方兼容。
- 构建验证：确认社区版工作区可完成构建任务。
- 敏感信息扫描：检查私有 API 地址、私有图片 API 地址、私有密钥名、内部认证密钥名、内部 SSH MCP 服务引用等是否残留。
- 测试文件残留扫描：确认导出时移除的 `__tests__`、`*.spec.ts(x)`、`*.test.ts(x)` 没有残留在社区版仓库。

## 说明

社区版导出过程中已按分离方案移除原有单元测试文件，因此本次没有运行 Vitest 单元测试。当前测试重点是开源分离后的可编译性、可构建性和敏感信息清理状态。

## 命令输出摘要

### pnpm check-types

```text
鈥塛ARN鈥?Unsupported engine: wanted: {"node":"20.19.2"} (current: {"node":"v22.22.0","pnpm":"10.8.1"})

> tocodex-community@ check-types G:\src\AI_IDE\for_vs_code\ToCodex-Community
> turbo check-types --log-order grouped --output-logs new-only

turbo 2.5.6

鈥?Packages in scope: @roo-code/build, @roo-code/cloud, @roo-code/config-eslint, @roo-code/config-typescript, @roo-code/core, @roo-code/ipc, @roo-code/telemetry, @roo-code/types, @roo-code/vscode-webview, tocodex
鈥?Running check-types in 10 packages
鈥?Remote caching disabled
@roo-code/cloud:check-types: cache hit, suppressing logs 0972fd8a53b52726
@roo-code/build:check-types: cache hit, suppressing logs bbfd0361796fc5f5
@roo-code/telemetry:check-types: cache hit, suppressing logs cd9cb4bb0bd75edc
@roo-code/types:check-types: cache hit, suppressing logs dfe1086ea71a9a0b
@roo-code/vscode-webview:check-types: cache hit, suppressing logs ebd7bc45d2a02810
@roo-code/ipc:check-types: cache hit, suppressing logs aaf707d3cfefedf6
@roo-code/core:check-types: cache hit, suppressing logs 37d2eda22d2e9005
tocodex:check-types: cache miss, executing 80fa6ef89e66b96c
tocodex:check-types: 鈥塛ARN鈥?Unsupported engine: wanted: {"node":"20.19.2"} (current: {"node":"v22.22.0","pnpm":"10.8.1"})
tocodex:check-types: 
tocodex:check-types: > tocodex@3.2.0 check-types G:\src\AI_IDE\for_vs_code\ToCodex-Community\src
tocodex:check-types: > tsc --noEmit
tocodex:check-types: 

 Tasks:    8 successful, 8 total
Cached:    7 cached, 8 total
  Time:    8.581s
```

### pnpm build

```text
鈥塛ARN鈥?Unsupported engine: wanted: {"node":"20.19.2"} (current: {"node":"v22.22.0","pnpm":"10.8.1"})

> tocodex-community@ build G:\src\AI_IDE\for_vs_code\ToCodex-Community
> turbo build --log-order grouped --output-logs new-only

turbo 2.5.6

鈥?Packages in scope: @roo-code/build, @roo-code/cloud, @roo-code/config-eslint, @roo-code/config-typescript, @roo-code/core, @roo-code/ipc, @roo-code/telemetry, @roo-code/types, @roo-code/vscode-webview, tocodex
鈥?Running build in 10 packages
鈥?Remote caching disabled
@roo-code/build:build: cache hit, suppressing logs 97e195c3fd07d6bb
@roo-code/types:build: cache hit, suppressing logs 18eab8d46f55a247
@roo-code/vscode-webview:build: cache hit, suppressing logs f1b0fccf719ba62f

 Tasks:    3 successful, 3 total
Cached:    3 cached, 3 total
  Time:    375ms >>> FULL TURBO
```

### 敏感信息扫描结果

```text
NO_SENSITIVE_MATCHES
```

### 测试文件残留扫描结果

```text
NO_TEST_FILES
```
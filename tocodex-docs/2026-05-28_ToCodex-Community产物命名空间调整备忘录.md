# ToCodex Community 产物命名空间调整备忘录

## 摘要

本次根据“社区版产物命名空间要加 Community，不要与 ToCodex 现有产物冲突”的要求，将 VS Code 扩展产物身份和贡献点命名空间从 `tocodex` 切换为 `tocodex-community`。品牌官网、文档、用户中心等域名保持 `tocodex.com` / `doc.tocodex.com` / `user.tocodex.com`，避免把“产物命名空间”误扩展到线上品牌域名。

## 主要变更

- `src/package.json`
  - 扩展包名从 `tocodex` 改为 `tocodex-community`。
  - Activity Bar 容器 ID 改为 `tocodex-community-ActivityBar`。
  - Sidebar view ID 改为 `tocodex-community.SidebarProvider`。
  - 命令贡献点统一改为 `tocodex-community.*`。
  - submenu ID 统一改为 `tocodex-community.contextMenu` / `tocodex-community.terminalMenu`。
  - 配置项 key 统一改为 `tocodex-community.*`，包括 `allowedCommands`、`deniedCommands`、`commandExecutionTimeout`、`commandTimeoutAllowlist`、`customStoragePath`、`debugProxy.*` 等。
- `src/extension.ts`
  - 工作树自动打开逻辑不再硬编码 `roo-cline.plusButtonClicked`，改为 `${Package.name}.plusButtonClicked`，随社区版包名自动使用 `tocodex-community.plusButtonClicked`。
- 源码引用
  - `src/utils/commands.ts` 已通过 `Package.name` 生成命令 ID，因此社区版扩展包名变更后，注册命令、Code Action 命令和 Terminal 命令会同步进入 `tocodex-community.*` 命名空间。
  - 读取 VS Code 设置的代码均通过 `vscode.workspace.getConfiguration(Package.name)` 访问，因此配置 key 会随 `Package.name` 隔离到 `tocodex-community`。

## 回滚和边界修正

批量替换初次执行时曾把部分品牌域名误改为 `tocodex-community.com` / `doc.tocodex-community.com` / `user.tocodex-community.com`。已回滚为：

- `https://tocodex.com`
- `https://doc.tocodex.com`
- `https://user.tocodex.com`
- `support@tocodex.com`

最终保留的 `tocodex-community` 仅用于扩展产物 ID、命令 ID、视图 ID、设置 key 等 VS Code 命名空间。

## 验证结果

- JSON 解析：通过。
- 旧扩展命名空间扫描：通过，未发现 `tocodex.*` 命令/配置 key 或 `roo-cline.plusButtonClicked` 残留。
- 域名误改扫描：通过，未发现 `tocodex-community.com`、`doc.tocodex-community.com`、`user.tocodex-community.com`、`api.tocodex-community.com`、`support@tocodex-community.com`。
- `pnpm test`：通过，输出公共测试占位提示。
- `pnpm check-types`：通过。
- `pnpm build`：通过。
- `src/webview-ui/build/`：验证后已按源码策略删除，并由 `.gitignore` 排除。

## 注意事项

- 当前运行环境 Node 为 `v22.22.0`，项目声明期望 Node `20.19.2`，命令会打印 engine warning，但本次验证均已通过。
- 当前目录不是 Git 仓库，后续在真实 Git 仓库应用时，需要确认 `src/webview-ui/build/` 没有进入 Git 索引。

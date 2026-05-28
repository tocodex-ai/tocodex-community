# ToCodex Community 品牌文案与 ruteapi 域名切换备忘

## 摘要

根据安装后界面反馈，将扩展可见标题、欢迎页提示、账号页和关于页中的主要品牌展示调整为 `tocodex-Community`，并将登录、注册、获取 API Key、官网、隐私、模型/API 默认入口切换到 `https://ruteapi.com`。

## 主要变更

- `src/package.json`：展示名改为 `tocodex-Community`，homepage 改为 `https://ruteapi.com`。
- `src/package.nls*.json`：扩展展示名、活动栏标题、视图标题、配置标题改为 `tocodex-Community`。
- `webview-ui/src/components/welcome/*` 与欢迎页 i18n：欢迎标题、创建账户、绑定 API Key 等主提示改为 `tocodex-Community`，获取 Key 链接改为 `https://ruteapi.com/console/token`。
- `webview-ui/src/components/cloud/CloudView.tsx` 与 cloud i18n：账号页文案改为 `tocodex-Community`，访问官网/注册入口改为 `https://ruteapi.com`。
- `webview-ui/src/components/settings/About.tsx`：关于页官网与隐私链接改为 `https://ruteapi.com`。
- `packages/cloud/src/index.ts`：Community 登录入口改为打开 `https://ruteapi.com`，相关 cloud helper API/Website URL 改为 `https://ruteapi.com`。
- `src/api/providers/constants.ts`：默认 ToCodex API URL 改为 `https://ruteapi.com`。
- `src/services/marketplace/RemoteConfigLoader.ts`、图片生成请求头、Provider 设置页相关链接同步改为 ruteapi 域名或 `tocodex-Community` 标题。

## 验证

- 残留扫描确认 `user.tocodex.com`、`api.ruteapi.com`、关键旧标题入口不再出现在 `src` 与 `webview-ui/src` 的相关代码中。
- `pnpm build` 成功。
- `pnpm vsix` 成功生成标准 VSIX。
- 已重新生成 `bin/tocodex-community-3.2.0-vscode-1.1.1.vsix`。
- 兼容包内验证：`displayName=tocodex-Community`，`homepage=https://ruteapi.com`，`engines.vscode=^1.1.1`。

## 注意事项

- `pnpm exec prettier` 在部分既有编码损坏的 `src/package.nls.*.json` 上仍会报 JSON 解析错误；本次构建和打包均通过，未阻塞 VSIX 产物。

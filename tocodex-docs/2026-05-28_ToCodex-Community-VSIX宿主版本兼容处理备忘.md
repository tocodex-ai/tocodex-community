# ToCodex Community VSIX 宿主版本兼容处理备忘

## 摘要

为解决安装时报错“无法安装扩展 tocodex.tocodex-community，因为它与 VS Code 1.1.1 不兼容”，新增 VSIX engine 元数据补丁脚本，并生成兼容宿主版本 1.1.1 的安装包。

## 变更文件

- `scripts/patch-vsix-engine.ps1`：新增脚本，复制 VSIX 后直接更新包内 `extension/package.json` 与 `extension.vsixmanifest` 的 VS Code engine 元数据，并使用无 BOM UTF-8 写回 JSON，避免安装器误判 `package.json` 非法。
- `bin/tocodex-community-3.2.0-vscode-1.1.1.vsix`：新增兼容安装包，包内 engine 已设为 `^1.1.1`。
- `bin/tocodex-community-3.2.0.vsix`：重新生成标准 VSIX，仍保留源码清单的 `engines.vscode: ^1.84.0`。

## 验证

- `pnpm vsix` 成功生成标准 VSIX。
- 兼容包内 `extension/package.json` 验证为 `{"vscode":"^1.1.1","node":"20.19.2"}`。
- 兼容包内 `extension/package.json` 文件头验证为 `7B 0D 0A 20`，确认直接以 `{` 开始且不含 UTF-8 BOM。
- 兼容包内 `extension.vsixmanifest` 验证为 `Microsoft.VisualStudio.Code.Engine` 值 `^1.1.1`。
- 源码 `src/package.json` 保持 `engines.vscode: ^1.84.0`，避免影响常规构建、类型和市场发布校验。

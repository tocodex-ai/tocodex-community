# ToCodex Community 公开仓库资料完善备忘

## 摘要

根据公开仓库发布需要，更新许可证、官网地址、README 详细介绍，并添加公开架构图资源。官网统一为 `https://tocodex.com`，`https://ruteapi.com` 仅作为 API 聚合/账号相关入口保留在代码中。

## 变更文件

- `LICENSE`：从复合/商业许可证整理为标准 Apache License 2.0。
- `NOTICE`：补充 Roo Code 上游署名、ToCodex 修改署名和商标说明。
- `README.md`：更新官网地址、项目介绍、功能亮点、仓库结构、开发/打包说明、许可证说明，并加入架构图章节。
- `src/package.json`：扩展 homepage 从 `https://ruteapi.com` 改回 `https://tocodex.com`。
- `docs/images/context-engineering-architecture.png`：新增上下文工程架构图。
- `docs/images/function-model-module-collaboration-flow.png`：新增函数/模型/模块协作流程图。
- `docs/images/memory-system-architecture.png`：新增记忆系统架构图。
- `docs/images/tocodex-plugin-code-architecture.png`：新增插件代码架构图。

## 验证

- GitHub 仓库 homepage 已更新为 `https://tocodex.com`。
- GitHub 仓库 description 与 topics 已更新。
- README 中 4 张实际架构图文件均存在。
- 根 `package.json` 与 `src/package.json` license 均为 `Apache-2.0`。
- `src/package.json` homepage 为 `https://tocodex.com`。

# ToCodex 开源计划与 RooCode 用户承接文案备忘录

日期：2026-05-25

## 一、背景判断

RooCode 原 GitHub 仓库 upstream Roo Code 当前已处于 archived 状态。公开数据表明，RooCode 曾拥有较大用户和开发者基础，仓库约 2.4 万 stars、3000+ forks，License 为 Apache-2.0，最近公开 Release 停留在 2026-05-15 的 `v3.54.0`。

这意味着 RooCode 原项目影响力仍在，但官方维护已经停止或至少进入只读状态。原用户会面临后续更新、安全修复、模型 Provider 适配、VS Code 兼容、CLI 维护、MCP 生态更新等问题。

ToCodex 基于 RooCode 二次开发，此时具备承接后续维护与用户迁移的窗口期。最优策略不是完全闭源，也不是完全开源，而是采用 Open Core：开源 VS Code 插件版和 CLI 版，闭源 IDE、桌面版、云服务、后台和企业能力。

## 二、开源目标

ToCodex 开源计划的核心目标是：

1. 承接 RooCode 归档后的原用户和开发者心智。
2. 建立 ToCodex 作为持续维护分支的可信度。
3. 通过开源客户端降低安全和隐私疑虑。
4. 吸收社区对 Provider、MCP、CLI、翻译、Bug 修复的贡献。
5. 将商业价值沉淀在 Desktop、IDE、Cloud、Admin、Enterprise 等闭源产品中。
6. 通过官网、Marketplace、GitHub 和社区内容形成可搜索、可验证、可迁移的公开路径。

## 三、推荐开源边界

| 模块                   | 策略         | 说明                                          |
| ---------------------- | ------------ | --------------------------------------------- |
| VS Code 插件核心       | 开源         | 面向原 RooCode 用户、开发者审计和插件生态传播 |
| Webview UI             | 建议开源     | 插件可构建性和用户信任的重要组成部分          |
| CLI                    | 开源         | 自动化、CI、终端用户和生态集成入口            |
| 基础 Provider          | 开源         | 便于社区持续维护模型 API 变化                 |
| MCP 与自定义模式       | 开源         | 有利于生态扩展和社区贡献                      |
| 基础本地配置和 BYOK    | 开源         | 保留 RooCode 用户习惯，降低迁移阻力           |
| Desktop 桌面版         | 闭源         | 商业产品形态，承载差异化体验                  |
| ToCodex IDE / Portable | 闭源         | 独立品牌入口和商业分发能力                    |
| Cloud 服务端           | 闭源         | 账号、模型额度、路由、成本优化和反滥用策略    |
| Admin 后台             | 闭源         | 涉及计费、审计、运营数据和权限管理            |
| 企业版控制台           | 闭源商业授权 | 面向私有部署和企业交付                        |

关键原则：开源的 VS Code 插件和 CLI 必须能够独立构建、独立运行，不能依赖闭源桌面版或云端商业组件才能使用，否则容易被认为是伪开源。

## 四、许可证与合规原则

RooCode 上游为 Apache-2.0。ToCodex 可以进行修改、商业使用、再分发和闭源组合发行，但必须满足以下要求：

1. 保留上游版权声明。
2. 保留 Apache-2.0 License。
3. 保留或补充 NOTICE / attribution。
4. 明确说明 ToCodex 基于 RooCode 二次开发。
5. 不得暗示获得 Roo Code, Inc. 官方授权。
6. 不得使用可能造成商标混淆的表达。
7. ToCodex 自有修改、桌面版、云服务、后台和商业发行可使用独立商业许可证。

推荐公开表达：

> ToCodex Community is an open-source continuation and evolution based on Roo Code, with Apache-2.0 upstream attribution preserved. ToCodex is not affiliated with Roo Code, Inc.

中文表达：

> ToCodex Community 是基于 Roo Code 的开源延续和增强版本，并保留 Apache-2.0 上游署名。ToCodex 与 Roo Code, Inc. 无从属或官方关联。

## 五、核心定位文案

### 英文主文案

ToCodex Community is a maintained open-source continuation and evolution based on Roo Code, after the original upstream Roo Code repository was archived.

We continue maintaining the VS Code extension and CLI experience, with support for BYOK, local models, OpenAI-compatible providers, MCP, custom modes, and ongoing compatibility updates.

ToCodex also provides optional commercial offerings, including Desktop, Cloud and Enterprise editions.

ToCodex is not affiliated with Roo Code, Inc. Roo Code is a trademark of its respective owner.

### 中文主文案

ToCodex Community 是基于 Roo Code 的持续维护开源延续版本。原 upstream Roo Code 仓库归档后，ToCodex 将继续维护 VS Code 插件版与 CLI 版。

ToCodex Community 支持 BYOK、本地模型、OpenAI-compatible Provider、MCP、自定义模式，并持续提供兼容性更新与 Bug 修复。

同时，ToCodex 提供 Desktop、Cloud、Enterprise 等商业增强版本。

ToCodex 与 Roo Code, Inc. 无从属或官方关联。Roo Code 商标归其权利人所有。

## 六、官网迁移页规划

建议新增以下页面：

- `https://tocodex.com/roocode`
- `https://tocodex.com/migrate-from-roocode`

两个路径可以指向同一页面，便于 SEO 和传播。

页面标题建议：

- 英文：`ToCodex: maintained Roo Code alternative for VS Code and CLI`
- 中文：`ToCodex：Roo Code 归档后的持续维护替代方案`

页面结构建议：

1. RooCode 当前 archived 状态说明。
2. ToCodex 与 RooCode 的关系。
3. ToCodex Community 继续维护的范围。
4. VS Code 插件安装方式。
5. CLI 安装方式。
6. RooCode 配置迁移指南。
7. API Key / Provider 迁移说明。
8. MCP / 自定义模式迁移说明。
9. 常见问题。
10. License、NOTICE 和商标声明。
11. Desktop / Cloud / Enterprise 商业增强入口。

## 七、GitHub 仓库发布计划

推荐 GitHub 组织与仓库命名：

- 组织：`tocodex-ai`（官网仍统一使用 `https://tocodex.com`）
- 首选公开仓库：`tocodex-ai/tocodex-community`
- 后续可扩展仓库：`tocodex-ai/tocodex-vscode`、`tocodex-ai/tocodex-cli`、`tocodex-ai/tocodex-docs`

如果以承接 RooCode 用户为首要目标，仓库描述必须包含 RooCode 关键词，但不能冒充官方。

推荐 GitHub Description：

> ToCodex Community — a maintained open-source continuation and evolution based on Roo Code, with VS Code extension and CLI support.

README 首屏建议包含：

```md
# ToCodex Community

ToCodex Community is a maintained open-source continuation and evolution based on Roo Code, after the original upstream Roo Code repository was archived.

- Maintained VS Code extension
- Maintained CLI
- Apache-2.0 upstream attribution preserved
- BYOK and local models supported
- OpenAI-compatible providers, MCP and custom modes
- Optional ToCodex Desktop / Cloud / Enterprise offerings

ToCodex is not affiliated with Roo Code, Inc. Roo Code is a trademark of its respective owner.
```

推荐 GitHub Topics：

- `roocode`
- `roo-code`
- `cline`
- `vscode-extension`
- `ai-coding-agent`
- `coding-agent`
- `mcp`
- `openai`
- `anthropic`
- `claude`
- `byok`
- `cli`

## 八、Marketplace 与 Open VSX 发布计划

插件名称建议：

> ToCodex - AI Coding Agent

短描述建议：

> A maintained AI coding agent for VS Code, evolved from Roo Code, with multi-model, MCP, BYOK and CLI support.

中文描述：

> 基于 Roo Code 生态演进的持续维护 AI 编码助手，支持多模型、MCP、BYOK 和 CLI。

Marketplace 页面应增加迁移区块：

```md
## Migrating from Roo Code

The original upstream Roo Code repository has been archived. ToCodex Community continues maintaining the VS Code extension and CLI experience with preserved Apache-2.0 attribution.

Migration guide: https://tocodex.com/migrate-from-roocode
```

中文：

```md
## 从 Roo Code 迁移

原 upstream Roo Code 仓库已归档。ToCodex Community 将继续维护 VS Code 插件和 CLI 体验，并保留 Apache-2.0 上游署名。

迁移指南：https://tocodex.com/migrate-from-roocode
```

建议同步发布到：

1. Visual Studio Marketplace。
2. Open VSX Registry。

Open VSX 可覆盖 VSCodium、Cursor、Code Server、Theia、Gitpod 等用户。

## 九、社区发布渠道

### 英文渠道

优先级：

1. GitHub README / Release / Discussion。
2. Visual Studio Marketplace。
3. Open VSX。
4. Reddit：`r/LocalLLaMA`、`r/vscode`、`r/ChatGPTCoding`、`r/ClaudeAI`、`r/opensource`。
5. Hacker News：Show HN。
6. Product Hunt。
7. X / Twitter。
8. LinkedIn。
9. Dev.to。
10. Medium。

英文标题建议：

> ToCodex Community: maintained open-source continuation of Roo Code for VS Code and CLI

或：

> Roo Code was archived. We are maintaining ToCodex Community as an open-source continuation.

### 中文渠道

优先级：

1. V2EX。
2. 掘金。
3. 知乎。
4. B 站。
5. 开源中国。
6. CSDN。
7. 微信公众号。
8. QQ 群 / 微信群。
9. 即刻。
10. 小红书技术圈。

中文标题建议：

> Roo Code 已归档，ToCodex Community 将继续维护 VS Code 插件和 CLI

或：

> ToCodex：Roo Code 停止维护后的开源延续版本

## 十、公告模板

### 英文短公告

```md
# ToCodex Community: maintained continuation after Roo Code archive

The original upstream Roo Code repository has been archived. ToCodex Community is an open-source continuation and evolution based on Roo Code, with preserved Apache-2.0 attribution.

We will continue maintaining:

- VS Code extension
- CLI
- BYOK and local model support
- OpenAI-compatible providers
- MCP and custom modes
- Bug fixes and compatibility updates

ToCodex also provides optional commercial offerings including Desktop, Cloud and Enterprise editions.

Migration guide: https://tocodex.com/migrate-from-roocode
GitHub: https://github.com/tocodex-ai/tocodex-community
Website: https://tocodex.com

ToCodex is not affiliated with Roo Code, Inc. Roo Code is a trademark of its respective owner.
```

### 中文短公告

```md
# ToCodex Community：Roo Code 归档后的持续维护分支

原 upstream Roo Code 仓库已归档。ToCodex Community 是基于 Roo Code 的开源延续和增强版本，并保留 Apache-2.0 上游署名。

ToCodex 将继续维护：

- VS Code 插件版
- CLI 版
- BYOK 和本地模型
- OpenAI-compatible Provider
- MCP 与自定义模式
- Bug 修复和兼容性更新

同时，ToCodex 也会提供 Desktop、Cloud、Enterprise 等商业增强版本。

迁移指南：https://tocodex.com/migrate-from-roocode
GitHub：https://github.com/tocodex-ai/tocodex-community
官网：https://tocodex.com

ToCodex 与 Roo Code, Inc. 无从属或官方关联。Roo Code 商标归其权利人所有。
```

## 十一、插件内迁移提示

ToCodex 插件首次启动或 Welcome 页可增加迁移入口：

英文：

> Coming from Roo Code?
> Import your settings, providers, modes and MCP servers into ToCodex.

中文：

> 从 Roo Code 迁移？
> 一键导入配置、模型 Provider、自定义模式和 MCP 服务。

建议后续实现或文档化：

1. RooCode 配置路径检测。
2. Provider 配置导入。
3. API Key 安全迁移提示。
4. 自定义模式导入。
5. MCP Server 配置导入。
6. 历史任务兼容说明。
7. 与 RooCode 原插件共存说明。

## 十二、优先修复和宣传的社区痛点

根据 RooCode 当前公开 Issue / PR 话题，ToCodex 可以优先强调以下维护方向：

1. 灰屏 / 空白屏稳定性问题。
2. 任务无法停止、终端进程控制问题。
3. OpenAI-compatible embedding 和代码索引问题。
4. Claude Code / OpenAI Codex 工具协议兼容。
5. Windows 10 / Windows 11 图标和 UI 兼容问题。
6. 新 Provider 接入，例如 Perplexity、国内模型、私有模型网关。
7. MCP 与自定义模式稳定性。
8. 中文文档、中文模型配置和国内网络体验。

## 十三、发布节奏建议

### 阶段 1：开源前准备

1. 清理品牌残留。
2. 完善 LICENSE / NOTICE。
3. 重写 Privacy Policy。
4. 确认 VS Code 插件可独立构建。
5. 确认 CLI 可独立安装和运行。
6. 删除或隔离商业密钥、内部接口、后台逻辑。
7. 编写迁移指南。
8. 准备官网迁移页。

### 阶段 2：开源发布

1. 发布 ToCodex Community GitHub 仓库。
2. 发布首个 GitHub Release。
3. 发布 VS Code Marketplace 插件。
4. 发布 Open VSX 插件。
5. 上线官网迁移页。
6. 发布 GitHub Discussion 公告。

### 阶段 3：社区传播

1. 中文社区首发：V2EX、知乎、掘金、B 站。
2. 英文社区发布：Reddit、HN、Product Hunt、Dev.to。
3. 联系活跃 fork 维护者，邀请合作而不是竞争。
4. 建立 Roadmap 和贡献指南。
5. 持续用 Release Note 证明维护活跃。

## 十四、禁止和谨慎表达

禁止或不建议使用：

- `official Roo Code successor`
- `RooCode is now ToCodex`
- `we took over RooCode`
- `RooCode 官方继任者`
- `RooCode 已改名 ToCodex`
- `完全自研`，如果未明确区分上游代码和 ToCodex 修改

推荐使用：

- `based on Roo Code`
- `open-source continuation`
- `maintained fork/evolution`
- `community-maintained continuation`
- `with Apache-2.0 upstream attribution preserved`
- `not affiliated with Roo Code, Inc.`
- `基于 Roo Code 的开源延续版本`
- `持续维护分支`
- `保留上游 Apache-2.0 署名`
- `与 Roo Code, Inc. 无从属或官方关联`

## 十五、最终推荐路线

ToCodex 应采用如下路线：

1. 开源 VS Code 插件版和 CLI 版，形成 ToCodex Community。
2. 保留 BYOK、本地模型、基础 Provider、MCP、自定义模式和基础 Agent 能力。
3. 闭源 Desktop、IDE、Cloud、Admin、Enterprise 和商业后台。
4. 官网建立 RooCode 迁移页，抢占搜索流量。
5. Marketplace 和 Open VSX 页面明确迁移路径。
6. GitHub README、Release、Discussion 持续强化维护状态。
7. 中文社区优先发声，英文社区随后扩展。
8. 以稳定性、Provider 持续更新、中文生态、Windows 体验和企业私有化作为 ToCodex 差异化。

一句话总结：

> ToCodex 不应把自己包装成 RooCode 官方继任者，而应明确定位为“基于 RooCode 的持续维护开源延续版本”，通过开源插件和 CLI 承接社区信任，通过 Desktop、IDE、Cloud 和 Enterprise 建立商业闭环。

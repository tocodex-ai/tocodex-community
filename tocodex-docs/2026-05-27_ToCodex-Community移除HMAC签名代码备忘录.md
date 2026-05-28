# ToCodex Community 移除 HMAC 签名代码备忘录

日期：2026-05-27

## 摘要

根据闭源主仓库中的 `docs/API客户端访问限制-HMAC签名方案B.md`，社区版不应公开 HMAC-SHA256 客户端签名算法、固定请求头、nonce/timestamp payload 规则或内嵌密钥。已从 ToCodex Community 源码中移除相关实现，避免开源仓库暴露商业服务访问限制算法细节。

## 变更文件

- `src/api/providers/constants.ts`
  - 删除 `TOCODEX_HMAC_SECRET` 常量和内嵌默认密钥。
- `src/api/providers/roo.ts`
  - 删除 `crypto` 导入。
  - 删除 `TOCODEX_HMAC_SECRET` 导入。
  - 删除 chat completions 请求中的 `X-ToCodex-Timestamp`、`X-ToCodex-Nonce`、`X-ToCodex-Sig` 生成与注入逻辑。
  - 删除 `completePrompt` 请求中的 HMAC 签名 header 注入逻辑。
  - 删除图片生成请求中的 HMAC 签名 header 注入逻辑。
  - 删除因 HMAC nonce 防重放而禁用 OpenAI SDK 自动重试的逻辑。

## 验证结果

- `pnpm check-types`：通过。
- `pnpm build`：通过。
- HMAC 残留扫描：通过，结果为 `NO_HMAC_MATCHES_IN_SOURCE`。

## 注意事项

- 验证时仍存在 Node engine 警告：项目期望 `node 20.19.2`，当前环境为 `v22.22.0`；该警告未阻断类型检查和构建。
- HMAC 方案文档仍位于闭源主仓库路径，不应复制到社区版公开仓库。

# send_internal_message 工具接入计划

## 背景

- 当前 Agent 在对话里可表达“已发送内部消息”，但缺少可执行的内置工具闭环，容易出现仅文本回复、未真实落库/分发的问题。
- 现有内部消息能力已在 legacy backend 提供（`/inner-messages/direct`），需在 agents tools 层补齐调用入口，并纳入 built-in seed。

## 实施步骤

1. 在 tools 内置目录新增 `send_internal_message` 定义，写入 `builtin-tool-catalog.ts`，确保 `seedBuiltinTools` 可落表。
2. 在 `ToolService` 增加该工具的执行分支与参数校验，统一使用执行中的 `agentId` 作为 `senderAgentId`，禁止参数伪造发送者。
3. 在 `InternalApiClient` 增加 inner-message API 调用方法，复用内部签名与超时/错误处理。
4. 工具执行返回结构补充 `messageId/status/sentAt`，让上层可基于真实回执判断“是否已发送”。
5. 更新功能/API文档与当日日志，记录新工具 ID、参数契约与影响范围。

## 关键影响点

- 后端（agents）：`backend/apps/agents/src/modules/tools/*`
- 后端（legacy 接口调用）：`/inner-messages/direct`
- 文档：`docs/feature/AGENT_TOOL.md`、`docs/api/agents-api.md`、`docs/dailylog/day/2026-03-17.md`

## 风险与依赖

- 权限依赖：新增工具权限标识需与角色/MCP Profile 配置一致，否则会被工具鉴权拦截。
- 运行依赖：`INTERNAL_CONTEXT_SECRET` 与 `LEGACY_SERVICE_URL` 必须正确配置，否则内部签名调用失败。

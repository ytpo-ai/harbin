# AGENT_RUNTIME_MESSAGE_PERSISTENCE

## 目标

- 将 Runtime 会话层从 `session.messages` 内嵌内容切换为 `session.messageIds` 引用式存储，避免会话文档持续膨胀。
- 将 assistant 推理轨迹按 step 持久化为 `agent_messages + agent_parts`，每步具备 `parentMessageId`、`stepIndex`、`finish`、`tokens`、`cost`。

## 数据模型要点

- `agent_messages`
  - 新增：`parentMessageId`、`modelID`、`providerID`、`finish`、`tokens`、`cost`、`stepIndex`
  - 索引：`(runId, stepIndex)`、`(parentMessageId)`
- `agent_parts`
  - `type` 扩展：`step_start`、`step_finish`
- `agent_sessions`
  - `messages[]` 改为 `messageIds: string[]`

## 持久化链路

- Runtime 层新增 `bulkCreateMessageWithParts(message, parts[])`，一次写入 step message 与其 parts。
- Runtime 层新增 `appendMessageIdToSession(sessionId, messageId)`，只维护会话消息引用。
- Native 执行主循环在每个 round 结束后写入一条 assistant message（含 step parts 和 finish/tokens/cost）。
- OpenCode 执行桥接在事件读取后按 step 聚合写入 assistant message，事件映射到 `text/reasoning/tool_call/tool_result/system_event` parts。
- `completeRun` 不再作为主路径写 assistant message，仅在无 assistant message 的旧路径下做 fallback。

## usage 归一化

- `ModelService.chat()` 已升级为结构化返回：`response + usage + finishReason + cost`。
- provider 层通过 `chatWithMeta()` 输出统一 usage 字段：`input/output/reasoning/cacheRead/cacheWrite/total`。
- 会话层对 cached token 进行 provider 感知口径修正（当前对 OpenAI/OpenRouter 按“input 含 cache”语义做净 input 折算）。

## 查询链路

- 新增接口：
  - `GET /agents/runtime/sessions/:sessionId/messages`
  - `GET /agents/runtime/messages/:messageId/parts`
  - `GET /agents/runtime/runs/:runId/messages`
- Session 详情由 `messageIds` 反查 message，再联查 part，前端可按 `parentMessageId` 分组渲染 step 轨迹。
- Session 详情查询已增加兜底补全：当 `messageIds` 未覆盖 run 级 `user/system` 消息时，会按 `runId` 回查补齐；同时将 `run.metadata.initialSystemMessages` 以虚拟 system message 形式注入返回，避免前端仅看到 assistant 轨迹。

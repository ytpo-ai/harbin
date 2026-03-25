# Agent Prompt Slug 与系统消息标签改造计划

## 需求理解

- 用户希望将 `AGENT_PROMPTS` 中当前的 `context` 字段改为 `slug`。
- 用户希望前端在展示 Session 系统消息时，优先使用该 `slug` 作为消息标签。
- 该改造需要覆盖后端 prompt 组装、runtime 持久化回放与前端展示链路。

## 执行步骤

1. 将 `AgentPromptTemplate` 与 `AGENT_PROMPTS` 定义中的 `context` 全量替换为 `slug`，并统一为 kebab-case。
2. 在系统 prompt 注入阶段（identity/toolset/task）将 `slug` 写入 `ChatMessage.metadata.promptSlug`。
3. 将 `startRuntimeExecution` 中 `metadata.initialSystemMessages` 从纯字符串数组升级为结构化对象数组（`content` + `metadata`），并保留兼容能力。
4. 调整 runtime 回放逻辑，兼容读取旧格式（string）与新格式（object），并将 `promptSlug` 带回 `SessionMessageView.metadata`。
5. 前端 `AgentDetail` 系统消息标签逻辑改为优先显示 `message.metadata.promptSlug`，无 slug 时继续走现有内容规则兜底。
6. 更新相关文档（guide/feature）中关于 prompt catalog 字段的描述，避免继续使用 `context`。
7. 进行类型检查与关键路径验证，确保历史数据可读、新数据可展示。

## 关键影响点

- 后端：`prompt-registry`、`modules/agents/context/*`、`agent-executor-runtime.service.ts`、`runtime-persistence.service.ts`、`runtime-orchestrator.service.ts`。
- 前端：`frontend/src/pages/AgentDetail.tsx`。
- 数据兼容：历史 `run.metadata.initialSystemMessages` 字符串格式与新对象格式并存。

## 风险与约束

- 历史 run 无 `promptSlug`，前端只能显示兜底标签（预期行为）。
- 同内容系统消息去重仍按 content 进行，若不同 slug 内容完全一致会被视为同一条。
- 本次不改 Prompt Registry 数据模型（仍按 `scene/role` 解析），仅改 catalog 元字段与展示链路。

## 确认

- 用户已于当前会话明确同意该计划并授权执行。

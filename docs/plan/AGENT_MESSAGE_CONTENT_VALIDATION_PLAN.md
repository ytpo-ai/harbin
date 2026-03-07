# AgentMessage Content Validation Plan

## 背景

- 运行时出现错误：`AgentMessage validation failed: content: Path content is required`。
- 目标是确保 runtime 写入 `agent_messages` 时，`content` 在所有入口都被安全归一化，避免因 `undefined/null` 导致校验失败。

## 执行步骤

1. 梳理 `AgentMessage` 的写入入口，确认 runtime 持久化链路的实际入参路径。
2. 在 schema 层增加 `content` 归一化兜底（`null/undefined -> ''`），确保模型级防护。
3. 在 runtime 持久化与 session 追加路径保持 `content` 归一化一致，防止上下游行为不一致。
4. 扫描相关调用点，确认不存在绕过归一化直接写入 `AgentMessage` 的路径。
5. 运行最小化验证（类型检查/关键链路构建或测试）确认修复有效且无回归。

## 关键影响点

- 后端：`apps/agents` runtime 持久化、`AgentMessage` schema。
- API：runtime session message 追加接口的入参容错。
- 测试与验证：至少完成一次静态检查或可执行验证，确认不再触发同类校验错误。

## 风险与依赖

- 风险：将空内容归一化为空字符串后，业务上“空消息”可能被允许；需遵循现有 runtime 行为（当前已允许默认空字符串）。
- 依赖：Mongoose schema setter/default 行为与当前版本兼容。

## 开发沉淀

- 开发总结：`docs/development/AGENT_MESSAGE_CONTENT_VALIDATION_PLAN.md`

# AgentMessage Content Validation 开发总结

## 背景

- 运行时报错：`AgentMessage validation failed: content: Path content is required`。
- 该错误会导致 run 持久化失败，影响会话链路稳定性。

## 实施内容

1. 统一 runtime 持久化层 content 归一化。
   - 在 `runtime-persistence.service.ts#createMessage` 中新增 `messageContent = input.content ?? ''`。
   - `message.save` 与 `appendMessageToSession` 均使用同一归一化变量，避免上下游不一致。

2. 保持 schema 与持久化行为一致。
   - 运行时写入入口对 `undefined/null` 做兜底，保证进入 Mongoose 的 `content` 始终为字符串。

## 影响文件

- `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`
- `backend/apps/agents/src/modules/runtime/runtime.controller.ts`
- `backend/apps/agents/src/schemas/agent-message.schema.ts`

## 验证

- 执行 `backend/` 下 `npm run build`，构建通过。

## 结论

- `content` 必填校验失败问题已修复。
- runtime message 与 session message 写入链路行为已对齐，降低同类错误复发概率。

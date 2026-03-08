# AgentMessage Content Validation 开发总结

## 背景

- 运行时报错：`AgentMessage validation failed: content: Path content is required`。
- 该错误会导致 run 持久化失败，影响会话链路稳定性。

## 实施内容

1. 统一 runtime 持久化层 `content` 归一化。
   - 在 `runtime-persistence.service.ts` 增加 `normalizeMessageContent(content: unknown): string`。
   - `createMessage` 与 `appendMessageToSession` 均改为走同一归一化方法。
   - 控制器 `runtime.controller.ts` 的 session append 接口入参改为 `content?: unknown` 并在调用层做空值兜底。

2. 强化 schema 级防护，避免漏网输入触发校验报错。
   - `agent-message.schema.ts` 的 `content` 字段增加 setter：`null/undefined -> ''`，非字符串统一转字符串。
   - 增加 `pre('validate')` 钩子，在校验前二次兜底 `content`。
   - 调整 `content` 字段为非 `required`（保留 `default: ''`），消除历史数据或异常请求导致的 `required` 失败。

3. 二次排障结果。
   - 初次仅在调用层兜底后，线上仍出现同类报错。
   - 追加 schema 级双重兜底后，风险点收敛到模型层，确保所有写入路径一致。

## 影响文件

- `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`
- `backend/apps/agents/src/modules/runtime/runtime.controller.ts`
- `backend/apps/agents/src/schemas/agent-message.schema.ts`

## 验证

- 执行 `backend/` 下 `npm run build:agents`，构建通过。

## 结论

- `AgentMessage content required` 问题已在调用层 + schema 层双重修复。
- runtime message 与 session message 写入链路行为已对齐，降低同类错误复发概率。
- 后续新增写入入口时无需重复实现空值保护，模型层已具备通用兜底能力。

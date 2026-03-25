# Agent Runtime 消息持久化对齐 OpenCode 模型

## 背景

当前 agent 推理循环（`executeWithToolCalling`）在内存中完成多轮"模型→工具→再推理"，仅在最后 `completeRun` 时写入一条 assistant message。导致：

- 中间推理过程（每步调了什么工具、花了多少 token、为什么停下来）在数据库和 UI 中不可见
- assistant message 没有 `parentMessageId` 指向它回应的 user message，消息链断裂
- 不记录 cost / tokens / finish reason，缺乏度量和审计能力

OpenCode 的做法是"每个 ReAct step 一条独立 assistant message + 多个 parts"，消息间通过 `parentID` 建立因果链。本方案将我们的持久化模型对齐到该水平。

## 决策记录

- 老数据全部删除，不做兼容迁移
- `session.messages[]` 改为只存 message ID（引用式），不嵌入 content，防止文档膨胀
- 每轮执行完后批量写库（message + parts 一次性落盘），不逐事件写入

---

## Phase 1: Schema 扩展

**优先级**：高 | **风险**：低（纯新增字段）

### P1: AgentMessage schema 补字段

文件：`backend/apps/agents/src/schemas/agent-message.schema.ts`

新增字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `parentMessageId` | `string?` | assistant message 指向它回应的 user message ID |
| `modelID` | `string?` | 本条 message 使用的模型 ID（如 `gpt-4o`） |
| `providerID` | `string?` | 模型提供商（如 `openai`） |
| `finish` | `enum('stop','tool-calls','error','cancelled','paused','max-rounds')` | 本条 assistant message 的结束原因 |
| `tokens` | `object?` | `{ input, output, reasoning, cacheRead, cacheWrite, total }` |
| `cost` | `number?` | 本步推理开销 |
| `stepIndex` | `number?` | 当前 message 在本次 run 中的 step 序号（0-based） |

新增索引：`(runId, stepIndex)`、`(parentMessageId)`

### P2: AgentPart type 枚举扩展

文件：`backend/apps/agents/src/schemas/agent-part.schema.ts`

当前枚举：`text | reasoning | tool_call | tool_result | system_event`

新增：

| 新类型 | 说明 |
|---|---|
| `step_start` | 标记一步推理开始，payload 携带上下文快照 |
| `step_finish` | 标记一步推理结束，payload 携带 finish reason、tokens、cost |

### P3: AgentSession.messages[] 改为引用式

文件：`backend/apps/agents/src/schemas/agent-session.schema.ts`

将 `messages[]` 从嵌入完整内容改为只存引用 ID：

```ts
// Before
messages: [{ id, runId, taskId, role, content, status, metadata, timestamp }]

// After
messageIds: string[]   // 只存 message ID 列表
```

同步修改：
- `runtime-persistence.service.ts` 中 `appendMessageToSession` 改为 `appendMessageIdToSession`
- 前端查询时通过 message ID 批量拉取完整内容

---

## Phase 2: Model Service 返回 Usage

**优先级**：中 | **风险**：中（需逐 provider 适配）

### P4: model service 扩展返回值

文件：`backend/apps/agents/src/modules/models/model.service.ts`

当前 `chat()` 返回 `string`，改为返回：

```ts
interface ModelChatResult {
  response: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens: number;
  };
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  cost?: number;
}
```

`streamingChat()` 同理，在流结束后返回 usage 汇总。

三层适配策略（对齐 OpenCode）：

**第一层：请求参数层 — 确保 provider 返回 usage**

部分 provider 流式接口默认不返回 usage，需在请求时显式开启：
- OpenAI / OpenAI-compatible: `stream_options: { include_usage: true }`
- OpenRouter: `usage: { include: true }`
- Anthropic: 默认返回，无需额外参数

**第二层：Provider SDK 层 — 映射为统一 usage 结构**

各 provider 返回格式不同，统一映射为：

```ts
interface NormalizedUsage {
  inputTokens: number;      // 原始 input tokens（含义因 provider 而异）
  outputTokens: number;
  reasoningTokens?: number; // OpenAI completion_tokens_details.reasoning_tokens
  cachedInputTokens?: number; // OpenAI cached_tokens / Anthropic cache_read_input_tokens
  cacheWriteTokens?: number;  // Anthropic cacheCreationInputTokens / Bedrock cacheWriteInputTokens
  totalTokens: number;
}
```

映射来源：
- OpenAI: `usage.prompt_tokens` → `inputTokens`, `prompt_tokens_details.cached_tokens` → `cachedInputTokens`
- Anthropic: `usage.input_tokens` → `inputTokens`, metadata `cacheCreationInputTokens` → `cacheWriteTokens`
- Bedrock: `usage.cacheWriteInputTokens` → `cacheWriteTokens`

**第三层：会话层归一化 — cached token 口径修正**

不同 provider 对 `inputTokens` 是否包含 cache 的口径不同：
- OpenAI/OpenRouter: `inputTokens` **已包含** cache read/write，需减去 → `adjustedInputTokens = inputTokens - cachedInputTokens - cacheWriteTokens`
- Anthropic/Bedrock: `inputTokens` **不包含** cache，无需修正 → `adjustedInputTokens = inputTokens`

最终落盘到 message.tokens 的字段：

```ts
tokens: {
  input: adjustedInputTokens,  // 归一化后的净 input tokens
  output: outputTokens,
  reasoning: reasoningTokens,
  cacheRead: cachedInputTokens,
  cacheWrite: cacheWriteTokens,
  total: adjustedInputTokens + outputTokens + (reasoningTokens ?? 0),
}
```

---

## Phase 3: 核心持久化重构（Native 通道）

**优先级**：高 | **风险**：高（改动推理主循环）

### P5: `executeWithToolCalling` 每轮落 message + parts

文件：`backend/apps/agents/src/modules/agents/agent-executor.service.ts`

改造 `executeWithToolCalling` 方法（当前 L912-L1261）：

```
当前行为：
  for (round = 0..maxToolRounds)
    调模型 → 内存推进 → 调工具 → 内存推进
  completeRun 写 1 条 assistant message

改为：
  for (round = 0..maxToolRounds)
    1. 调模型，拿到 response + usage
    2. 收集本轮所有 parts（step_start, reasoning, tool_call, tool_result, text, step_finish）
    3. 一次性批量写库：
       - createMessage(role='assistant', stepIndex=round, parentMessageId=userMsgId, finish, tokens, cost, modelID, providerID)
       - createParts([step_start, reasoning?, tool_call?, tool_result?, text?, step_finish])
       - appendMessageIdToSession(sessionId, messageId)
    4. 判断是否继续循环
```

批量写库策略：
- 每轮结束后一次性调用 `bulkCreateMessageWithParts(message, parts[])`
- 不在循环中间逐个写入，减少 DB 交互

### P6: RuntimeOrchestrator 调整

文件：`backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts`

- `completeRun` 不再负责创建 assistant message（已在每轮创建），只更新 run status
- `startRun` 中创建的 user message 需返回 `userMessageId`，供后续 assistant message 设置 `parentMessageId`（当前已有此行为）

### P7: RuntimePersistence 新增批量写入方法

文件：`backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`

新增方法：

```ts
async bulkCreateMessageWithParts(
  message: CreateMessageInput,
  parts: CreatePartInput[],
): Promise<{ message: AgentMessage; parts: AgentPart[] }>

async appendMessageIdToSession(sessionId: string, messageId: string): Promise<void>
```

---

## Phase 4: OpenCode 桥接通道对齐

**优先级**：中 | **风险**：中（依赖 opencode 事件格式）

### P8: opencode 事件流解析增强

文件：
- `backend/apps/agents/src/modules/opencode/opencode-execution.service.ts`
- `backend/apps/agents/src/modules/agents/executor-engines/opencode-agent-executor.engine.ts`
- `backend/apps/agents/src/modules/agents/executor-engines/opencode-streaming-agent-executor.engine.ts`

改造内容：
- 从 OpenCode 事件流中提取 step/tool/reasoning 事件（不只是 `llm.delta`）
- 将事件映射为 message + parts，复用 Phase 3 的 `bulkCreateMessageWithParts` 写入
- OpenCode 每个 step 结束产生一条 assistant message，与 native 通道对齐

---

## Phase 5: 前端展示适配

**优先级**：低 | **风险**：低（纯 UI 层）

### P9: AgentDetail Session Tab 改造

文件：
- `frontend/src/pages/AgentDetail.tsx`
- `frontend/src/services/agentService.ts`

改造内容：
- 类型定义扩展：`AgentRuntimeSessionMessage` 增加 `parentMessageId`, `stepIndex`, `finish`, `tokens`, `cost`, `modelID`, `providerID`
- `AgentRuntimeSessionPart` 的 `type` 枚举增加 `step_start`, `step_finish`
- Session 消息列表改为通过 `messageIds` 批量查询 message 详情
- 展示方式：
  - 按 `parentMessageId` 将"同一次用户提问下的所有 step"折叠为一组
  - 每条 assistant message 显示：step 序号、finish reason 标签、token 用量、cost、耗时
  - tool parts 显示工具名、输入参数、输出结果、执行耗时
  - step_start / step_finish 作为分界线渲染

### P10: 新增 API 端点

文件：`backend/apps/agents/src/modules/runtime/runtime.controller.ts`

新增或调整端点：
- `GET /runtime/sessions/:sessionId/messages` — 分页查询 session 下的 messages（基于 messageIds 引用）
- `GET /runtime/messages/:messageId/parts` — 查询单条 message 的 parts
- `GET /runtime/runs/:runId/messages` — 查询 run 下所有 messages（含 parts）

---

## 影响范围汇总

### 后端文件

| 文件 | 改动类型 |
|---|---|
| `schemas/agent-message.schema.ts` | 新增字段 + 索引 |
| `schemas/agent-part.schema.ts` | 枚举扩展 |
| `schemas/agent-session.schema.ts` | messages[] 改为 messageIds[] |
| `modules/models/model.service.ts` | 返回值扩展 |
| `modules/agents/agent-executor.service.ts` | 核心循环重构 |
| `modules/agents/agent-execution.service.ts` | 配合调整 |
| `modules/runtime/runtime-orchestrator.service.ts` | completeRun 瘦身 |
| `modules/runtime/runtime-persistence.service.ts` | 新增批量写入 + session 引用式 |
| `modules/runtime/runtime.controller.ts` | 新增消息查询端点 |
| `modules/opencode/opencode-execution.service.ts` | 事件解析增强 |
| `modules/agents/executor-engines/opencode-*.engine.ts` | 对齐持久化路径 |

### 前端文件

| 文件 | 改动类型 |
|---|---|
| `services/agentService.ts` | 类型定义扩展 + 新 API |
| `pages/AgentDetail.tsx` | Session tab 消息展示重构 |

---

## 执行顺序

| 阶段 | 内容 | 风险 | 依赖 |
|---|---|---|---|
| Phase 1 | P1 + P2 + P3: Schema 扩展 | 低 | 无 |
| Phase 2 | P4: Model Service 返回 usage | 中 | 无 |
| Phase 3 | P5 + P6 + P7: 核心持久化重构 | **高** | Phase 1 + Phase 2 |
| Phase 4 | P8: OpenCode 桥接对齐 | 中 | Phase 3 |
| Phase 5 | P9 + P10: 前端展示适配 | 低 | Phase 3 |

---

## 设计约束（对齐 OpenCode 2.7 / 2.8）

### 消息粒度约束

- **每轮 loop 一条 assistant message**，该轮内的多次工具调用记为多个 tool part（不是每个工具调用一条 message）
- assistant message 是"轮次容器"，parts 是容器内的细粒度记录
- `parentMessageId` 只指向触发本次推理的 user message，不在 assistant 之间建链

### usage 归一化约束

- 必须在请求参数层确保 provider 返回 usage（不能依赖"默认返回"）
- cached token 口径必须做 provider 感知修正（Anthropic vs OpenAI 语义不同）
- cost 计算收口在统一方法中，不在各 provider 分散计算

---

## 验证要点

- [ ] 单条 user message 触发推理后，DB 中出现 N 条 assistant messages（每步一条），每条含 parentMessageId 指回 user message
- [ ] 每条 assistant message 的 parts 包含 step_start → reasoning(可选) → tool_call/tool_result(可选) → text(可选) → step_finish
- [ ] step_finish part 包含 finish reason、tokens、cost
- [ ] session.messageIds 只存 ID，通过 API 可批量查询完整消息
- [ ] 前端 Session tab 可按用户提问分组展示所有 step，可折叠/展开
- [ ] native 通道和 opencode 通道产出的 message 结构一致
- [ ] 推理延迟无明显退化（批量写库 vs 逐步写库对比）

# Session System Message Persistence — 技术设计文档

> 状态：待确认
> 创建时间：2026-03-30
> 关联 Plan：`docs/plan/SESSION_SYSTEM_MESSAGE_PERSISTENCE_PLAN.md`
> 关联问题：`docs/issue/PLAN_OPTIMAZE.md`

---

## 1. 当前架构（改造前）

### 1.1 消息生命周期

```
buildMessages()                         LLM Provider
    │                                        ▲
    ├─ contextAssembler.assemble()           │
    │   ├─ identityBuilder    → [system]     │
    │   ├─ toolsetBuilder     → [system]     │
    │   ├─ domainBuilder      → [system]     │    发送完整 messages[]
    │   ├─ collaborationBuilder → [system]   │    ─────────────────►
    │   ├─ taskBuilder        → [system]     │
    │   └─ memoryBuilder      → [system]     │
    │                                        │
    ├─ previousNonSystemMessages → [user/assistant]
    │                                        │
    └─ messages[] (内存)  ──────────────────┘
           │
           │  tool-calling loop 中追加：
           ├─ [assistant] LLM 输出       → persist 到 agent_messages ✓
           ├─ [system] 工具结果回灌       → 仅内存，不 persist ✗
           ├─ [system] 系统纠正指令       → 仅内存，不 persist ✗
           └─ [system] 工具拒绝/修复指令  → 仅内存，不 persist ✗
```

### 1.2 当前存储位置

| 消息类型 | 存储位置 | 前端可见 |
|---------|---------|---------|
| 初始 system messages | `run.metadata.initialSystemMessages`（每次 run 重复写入） | 通过 `virtual-system-*` 虚拟消息展示，仅最新 run |
| user prompt | `agent_messages`（role=user, sequence=1） | 是 |
| assistant 输出 | `agent_messages`（role=assistant, sequence=round+2） | 是 |
| tool result 回灌 | 仅内存 messages[] | 否 |
| 系统纠正指令 | 仅内存 messages[] | 否 |
| 工具拒绝/修复 | 仅内存 messages[] | 否 |

### 1.3 问题

1. 初始 system messages 每次 run 都重新构建（6 个 builder 各自查 DB），浪费 IO
2. 初始 system messages 存入 run.metadata，`getSessionDetailById` 只取最新 run 的，历史 run 的 system context 丢失
3. tool result 等中间 system 消息不落库，前端无法还原 LLM 看到的完整 context
4. 虚拟消息（`virtual-system-*`）没有真实 DB 记录，无法被查询/引用

---

## 2. 目标架构（改造后）

```
session 首次创建时：
    buildMessages()
        ├─ contextAssembler.assemble() → system messages
        ├─ 写入 session.initialSystemMessages（一次性）
        └─ 每条 system message 同时写入 agent_messages（role=system）

session 后续 run：
    buildMessages()
        ├─ 从 session.initialSystemMessages 读取 → 跳过 6 个 builder
        └─ 拼接 previousNonSystemMessages

tool-calling loop：
    每个注入点：
        ├─ push 到内存 messages[]（不变）
        └─ 同步写入 agent_messages（role=system）（新增）
```

---

## 3. 数据模型变更

### 3.1 agent_sessions — 新增 initialSystemMessages 字段

```typescript
// agent-session.schema.ts
@Prop({
  type: [{
    id: { type: String, required: true },
    content: { type: String, required: true },
    metadata: { type: Object },
  }],
  default: undefined,   // undefined = 尚未初始化，[] = 初始化完成但无 system 消息
})
initialSystemMessages?: Array<{
  id: string;           // msg-{uuid}，与 agent_messages 中的记录一一对应
  content: string;
  metadata?: Record<string, unknown>;
}>;
```

**设计决策**：
- `undefined` vs `[]` 区分"尚未初始化"和"已初始化但无消息"，用于 buildMessages 的缓存判断
- 每条消息的 `id` 与 `agent_messages` 表中的记录 ID 一致，保证可追溯
- `metadata` 保留 builder 层的标记信息（如 `{ layer: 'identity', scope: 'agent' }`）

### 3.2 agent_messages — 无 schema 变更

已有 `role: 'system'` 枚举值，无需改动。新增的 system 消息使用现有 schema 即可。

### 3.3 agent_runs — metadata 变更

移除 `initialSystemMessages` 字段的写入（代码层不再 push 该字段到 metadata）。历史数据保留，不做清理。

---

## 4. 核心实现细节

### 4.1 buildMessages 缓存分支

**文件**：`agent-executor.service.ts`
**方法**：`buildMessages`（L1772-1862）

```typescript
async buildMessages(agent, task, context, enabledSkills): Promise<ChatMessage[]> {
  const sessionId = context.sessionContext?.sessionId;

  // 尝试从 session 读取已固化的 system messages
  if (sessionId) {
    const cached = await this.runtimePersistence.getSessionInitialSystemMessages(sessionId);
    if (cached !== undefined) {
      // 命中缓存：直接用 cached system messages + previousNonSystemMessages
      const messages: ChatMessage[] = cached.map(msg => ({
        role: 'system' as const,
        content: msg.content,
        metadata: msg.metadata,
        timestamp: new Date(),
      }));
      const previousNonSystem = (context.previousMessages || [])
        .filter(msg => msg?.role !== 'system');
      messages.push(...previousNonSystem);
      return messages;
    }
  }

  // 未命中缓存：正常构建（现有逻辑不变）
  const assembledContext = await this.contextAssembler.assemble({ ... });
  const messages = assembledContext.messages;

  // 首次构建完成后，固化到 session
  if (sessionId) {
    const systemMessages = messages
      .filter(msg => msg.role === 'system')
      .map(msg => ({
        id: `msg-${uuidv4()}`,
        content: String(msg.content || '').trim(),
        metadata: msg.metadata as Record<string, unknown> | undefined,
      }))
      .filter(msg => msg.content.length > 0);

    await this.runtimePersistence.setSessionInitialSystemMessages(sessionId, systemMessages);

    // 同时写入 agent_messages 表（使前端可直接查询）
    const runId = context.sessionContext?.runId || `system-init-${sessionId}`;
    for (let i = 0; i < systemMessages.length; i++) {
      await this.runtimePersistence.createMessage({
        id: systemMessages[i].id,   // 复用同一 ID
        runId,
        agentId: agent.id || '',
        sessionId,
        role: 'system',
        sequence: i + 1,             // system messages 占 sequence 1..N
        content: systemMessages[i].content,
        status: 'completed',
        metadata: {
          ...systemMessages[i].metadata,
          source: 'session.initialSystemMessages',
        },
      });
    }
  }

  return messages;
}
```

**Sequence 编号规则变更**：

| 消息类型 | 旧 sequence | 新 sequence |
|---------|------------|-------------|
| 初始 system messages | 无（虚拟消息，不在 DB） | `1..N`（N = system 消息条数） |
| user prompt | `1` | `N + 1` |
| assistant 输出 | `round + 2` | `N + round + 2` |
| 中间 system 消息 | 无 | `N + (round + 2) * 100 + offset`（见 4.2） |

**注意**：user message 的 sequence 需从 `1` 改为 `N + 1`。影响点：`runtime-orchestrator.service.ts` L270。

### 4.2 中间 System Messages 持久化

**文件**：`agent-executor.service.ts`
**位置**：tool-calling loop 内 6 个注入点

在每个 `messages.push({ role: 'system', ... })` 之后，追加 persist 调用：

```typescript
// 工具成功结果（L1674-1678 之后追加）
const toolResultContent = `工具 ${normalizedToolCallId} 调用结果: ${JSON.stringify(toolResultPayload || {})}`;
messages.push({ role: 'system', content: toolResultContent, timestamp: new Date() });

if (runtimeContext?.sessionId) {
  await this.runtimePersistence.createMessage({
    runId: runtimeContext.runId,
    agentId: agentRuntimeId,
    sessionId: runtimeContext.sessionId,
    taskId: task.id,
    role: 'system',
    sequence: this.computeIntermediateSystemSequence(systemMessageBaseSeq, round, intermediateOffset++),
    content: toolResultContent,
    status: 'completed',
    metadata: { source: 'tool-calling-loop.tool-result', toolId: normalizedToolCallId },
  });
}
```

**Sequence 计算公式**：

```typescript
private computeIntermediateSystemSequence(base: number, round: number, offset: number): number {
  // base = 初始 system messages 条数
  // 每个 round 预留 100 个 sequence 位
  // assistant 消息占 round*100 + 0，中间 system 消息占 round*100 + 1..99
  return base + (round + 1) * 100 + offset;
}
```

这样保证排序时：`initial system (1..N) → user (N+1) → [round 0: assistant → system → system → ...] → [round 1: assistant → system → ...] → ...`

### 4.3 runtime-persistence.service.ts 新增方法

```typescript
/**
 * 读取 session 已固化的 initialSystemMessages。
 * 返回 undefined 表示尚未初始化，[] 表示已初始化但无消息。
 */
async getSessionInitialSystemMessages(
  sessionId: string,
): Promise<Array<{ id: string; content: string; metadata?: Record<string, unknown> }> | undefined> {
  const session = await this.sessionModel
    .findOne({ id: sessionId }, { initialSystemMessages: 1 })
    .lean()
    .exec();
  return session?.initialSystemMessages;
}

/**
 * 首次固化 initialSystemMessages 到 session。
 * 仅在 initialSystemMessages 为 undefined 时写入（幂等保护）。
 */
async setSessionInitialSystemMessages(
  sessionId: string,
  messages: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>,
): Promise<void> {
  await this.sessionModel.updateOne(
    { id: sessionId, initialSystemMessages: { $exists: false } },  // 幂等：仅首次写入
    { $set: { initialSystemMessages: messages } },
  ).exec();
}
```

### 4.4 getSessionDetailById 简化

**文件**：`runtime-persistence.service.ts`（L655-829）

改造后：
1. 移除 `runInitialSystemMessagesMap` 的构建逻辑（L661, L674-676）
2. 移除虚拟消息注入逻辑（L762-786）
3. 初始 system messages 现在是真实 `agent_messages` 记录，已通过 `session.messageIds` 自动包含在查询结果中

```typescript
// 移除以下代码块（L760-786）：
// const latestRunId = runIds.length > 0 ? runIds[runIds.length - 1] : undefined;
// if (latestRunId) {
//   const initialSystemMessages = ...
//   initialSystemMessages.forEach((message, index) => {
//     projectedMessages.push({ id: `virtual-system-${latestRunId}-${index + 1}`, ... });
//   });
// }
```

### 4.5 startRuntimeExecution 移除 initialSystemMessages 写入

**文件**：`agent-executor-runtime.service.ts`（L98-124）

```typescript
// 移除以下字段：
const metadata: Record<string, unknown> = {
  taskType: task.type,
  taskPriority: task.priority,
  roleCode,
  executionChannel,
  executionData,
  // ↓ 删除这整块 ↓
  // initialSystemMessages: messages.filter(msg => msg.role === 'system').map(...),
  sync: { state: 'pending', retryCount: 0 },
};
```

---

## 5. createMessage 接口扩展

当前 `createMessage` 方法（`runtime-persistence.service.ts` L449-486）的 ID 是内部生成的 `msg-${uuidv4()}`。需要支持调用方传入 `id`，使 session.initialSystemMessages 中的 ID 与 agent_messages 中的 ID 一致：

```typescript
async createMessage(input: {
  id?: string;                    // 新增：可选外部指定 ID
  runId: string;
  agentId: string;
  // ... 其余不变
}): Promise<AgentMessage> {
  const messageContent = this.normalizeMessageContent(input.content);
  const message = new this.messageModel({
    id: input.id || `msg-${uuidv4()}`,   // 优先使用外部 ID
    ...input,
    content: messageContent,
    status: input.status || 'completed',
  });
  // ... 其余不变
}
```

---

## 6. 前端适配

### 6.1 SessionDrawer 消息渲染

**当前**：`getSessionDetailById` 返回的 messages 中，system 消息的 id 格式为 `virtual-system-{runId}-{index}`，前端可能有针对此格式的特殊处理。

**改造后**：system 消息的 id 格式统一为 `msg-{uuid}`，与 user/assistant 一致。前端无需特殊处理。

### 6.2 消息排序

**当前**：按 `timestamp → sequence` 排序。
**改造后**：排序逻辑不变，但 sequence 编号空间扩大。新的排序保证：

```
[system seq=1] identity baseline
[system seq=2] agent identity
[system seq=3] skill: rd-workflow
...
[system seq=N] task context
[user   seq=N+1] phaseInitialize prompt
[assistant seq=N+102] LLM 第 1 轮输出（tool_call）
[system seq=N+103] 工具 requirement.list 调用结果
[assistant seq=N+202] LLM 第 2 轮输出（tool_call）
[system seq=N+203] 工具 requirement.get 调用结果
...
```

---

## 7. 边界情况

### 7.1 Agent 配置变更后 session system messages 过期

**场景**：agent 的 skill 被更新/解绑，但已有 session 的 initialSystemMessages 仍是旧版本。

**处理策略**：
- 当前 phase 隔离模式下，planner session 的生命周期 = 一个 plan 的编排周期，通常几分钟到几小时，配置变更概率极低
- Meeting session 生命周期稍长，但 meeting 结束后 session 归档
- 如需强制刷新：提供 `resetSessionSystemContext(sessionId)` 方法，将 `initialSystemMessages` 重置为 `undefined`，下次 run 重新构建

### 7.2 并发写入 initialSystemMessages

**场景**：同一 session 的两个 run 几乎同时启动，都检测到 `initialSystemMessages === undefined`。

**处理策略**：`setSessionInitialSystemMessages` 使用 `{ initialSystemMessages: { $exists: false } }` 作为 update filter，MongoDB 原子操作保证只有一个写入成功。第二个写入不生效（幂等），但也不报错——它会走 buildMessages 的正常路径，只是构建的 system messages 不会再写入 session（因为 `$exists: false` 不匹配了）。

### 7.3 中间 system 消息的 persist 失败

**处理策略**：中间 system 消息的 persist 是"尽力而为"——如果写入失败，仅记录 warn 日志，不影响 tool-calling loop 继续执行。内存中的 messages[] 不受影响，LLM 仍能正常工作。

---

## 8. 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `backend/apps/agents/src/schemas/agent-session.schema.ts` | 字段新增 | 新增 `initialSystemMessages` |
| `backend/apps/agents/src/modules/agents/agent-executor.service.ts` | 核心改造 | buildMessages 缓存分支 + 6 个注入点 persist |
| `backend/apps/agents/src/modules/agents/agent-executor-runtime.service.ts` | 精简 | 移除 initialSystemMessages 写入 run.metadata |
| `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts` | 新增方法 + 简化 | get/set initialSystemMessages + getSessionDetailById 移除虚拟消息 |
| `backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts` | 精简 | 移除 extractInitialSystemMessages |
| `frontend/src/components/agent-detail/SessionDrawer.tsx` | 适配 | 移除 virtual-system-* 特殊处理（如有） |
| `frontend/src/components/agent-detail/hooks/useSessionState.ts` | 适配 | 消息排序逻辑验证 |

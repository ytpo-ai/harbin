# 系统上下文分层架构 -- 根治多轮对话 System Prompt 重复注入

## 背景

在多轮会话（尤其是会议场景）中，system prompt 被反复注入上下文，导致：

1. **Token 膨胀**：一个 37 分钟、12 轮交互的会议产生 145 条消息，其中 system 消息占 ~96 条（每轮 ~8 条完整重复），system 内容占发送给 LLM 的 token 比例超过 70%。
2. **数据库膨胀**：`session.messages` 和 `agent_messages` 集合中 system 文档随轮次线性增长。
3. **行为漂移风险**：过长上下文中多份冲突的 system 指令可能导致模型执行偏差。

### 根因分析

问题由三层叠加造成：

**层 1 -- 双源注入**：Meeting service 在 `task.messages` 里塞了 system prompt（`meeting.service.ts:1943`），同时 `ContextAssemblerService` 的 6 个 builder 又各自生成 system blocks。两边内容功能重叠但文本不同，去重不命中，全部保留。

**层 2 -- Builder 缺乏抑制**：6 个 builder 中只有 2 个（Identity memo、Task）使用了 fingerprint 服务做变更检测。其余 4 个（Toolset、Domain、Collaboration、Memory）每轮输出完整内容，不管是否有变化。

**层 3 -- 持久化无分层**：
- `appendSystemMessagesToSession`（`agent-executor.service.ts:768`）每轮把所有 system messages 推入 `session.messages`。
- `startRun`（`runtime-orchestrator.service.ts:192`）每轮为每条 system 创建独立 `AgentMessage` 文档。
- 数据库持续膨胀，且 `buildSystemContextKey`（`context-fingerprint.util.ts`）只识别 2 种模式，大量 system 消息无法被结构化去重。

### 涉及的核心文件

| 文件 | 职责 |
|------|------|
| `backend/apps/agents/src/modules/agents/context/context-assembler.service.ts` | 中央组装器：运行 builders、去重、合并历史 |
| `backend/apps/agents/src/modules/agents/context/context-block-builder.interface.ts` | Builder 接口 + ContextBuildInput 定义 |
| `backend/apps/agents/src/modules/agents/context/identity-context.builder.ts` | 注入 guideline + systemPrompt + identity memos |
| `backend/apps/agents/src/modules/agents/context/toolset-context.builder.ts` | 注入 skills + tools + tool strategies |
| `backend/apps/agents/src/modules/agents/context/domain-context.builder.ts` | 注入 domain context |
| `backend/apps/agents/src/modules/agents/context/collaboration-context.builder.ts` | 注入 meeting/orchestration/chat 协作上下文 |
| `backend/apps/agents/src/modules/agents/context/task-context.builder.ts` | 注入 task info / meeting execution policy |
| `backend/apps/agents/src/modules/agents/context/memory-context.builder.ts` | 注入 run summaries + memo 检索结果 |
| `backend/apps/agents/src/modules/agents/context/context-fingerprint.service.ts` | Redis 缓存指纹，抑制未变化的 block |
| `backend/apps/agents/src/modules/agents/context/context-fingerprint.util.ts` | 归一化 + 结构化 context key 构建 |
| `backend/apps/agents/src/modules/agents/agent-executor.service.ts` | prepareExecution / buildMessages 入口 |
| `backend/apps/agents/src/modules/agents/agent-executor-runtime.service.ts` | appendSystemMessagesToSession 桥接 |
| `backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts` | startRun / session 生命周期 / 消息创建 |
| `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts` | MongoDB CRUD：session、run、message |
| `backend/src/modules/meetings/meeting.service.ts` | 会议响应上下文构建（双源注入的源头之一） |

## 设计原则

1. **System context 是 runtime envelope，不是 conversation history** -- 不应持久化到 `session.messages` 或 `agent_messages`
2. **单一来源原则** -- system context 只由 `ContextAssemblerService` 统一生成，调用方（meeting/planner/worker）不再传 system 消息
3. **变更驱动注入** -- 静态 block 只在首次或变更时注入，未变化时完全抑制
4. **持久化分层** -- `session.messages` 只存 user/assistant/tool，system context 快照存到 `run.metadata` 供审计

## 当前 Builder 状态分析

| Builder | 消息数 | 使用 Fingerprint? | 稳定性分类 |
|---------|--------|-------------------|------------|
| IdentityContextBuilder (guideline + systemPrompt) | 2 | 否 | static -- 同 session 内不变 |
| IdentityContextBuilder (identity memos) | 0-1 | 是 | semi-static -- 偶尔变，已有 delta |
| ToolsetContextBuilder (skill list + content) | 0-N | 否 | dynamic -- 依赖当前 task 文本匹配 |
| ToolsetContextBuilder (tool spec + strategy) | 0-2 | 否 | static -- 同 agent 工具集在 session 内不变 |
| DomainContextBuilder | 1 | 否 | static -- 来自 session 持久化数据 |
| CollaborationContextBuilder | 0-1 | 否 | static(meeting) / semi-static(orchestration) |
| TaskContextBuilder | 0-1 | 是 | semi-static -- 已有 delta |
| MemoryContextBuilder | 0-2 | 否 | dynamic -- 每轮内容可能不同 |

## 执行步骤

### 步骤 1：ContextBlockBuilder 接口增加 scope 和 stability 元数据

**文件**：`context-block-builder.interface.ts`

- 新增类型 `MessageScope = 'run' | 'session'`，`BlockStability = 'static' | 'semi-static' | 'dynamic'`
- `ContextBlockBuilder` 接口新增 `readonly meta: { scope: MessageScope; stability: BlockStability }`
- 所有 builder 的 scope 均设为 `run`（system context 不进入 session history）
- 各 builder 按上表设置 stability

### 步骤 2：ContextAssemblerService 重构 -- 丢弃 previousMessages 中的 system

**文件**：`context-assembler.service.ts`

- `assemble()` 方法中，`previousMessages` 只保留 `role !== 'system'` 的消息
- 移除当前的 `uniquePreviousSystemMessages` 合并逻辑（line 60-75），因为 assembler 通过 builders 已经生成了完整的 system context
- 新增返回类型 `AssembledContext`，包含 `messages`、`systemBlockCount`、`blockMetas`，让调用方能区分 system blocks 和对话历史

### 步骤 3：扩展 fingerprint 覆盖到所有 static/semi-static builder

**文件**：各 builder + `context-fingerprint.service.ts`

需要新接入 fingerprint 的 builder：

| Builder | blockType | snapshot 内容 | delta 支持 |
|---------|-----------|---------------|------------|
| IdentityContextBuilder (guideline + systemPrompt) | `identity-base` | `{ guidelineHash, systemPromptHash }` | 否（full-or-nothing） |
| DomainContextBuilder | `domain` | `{ domainType, descriptionHash, constraintCount, refCount }` | 否 |
| CollaborationContextBuilder | `collaboration` | meeting: `{ meetingId, participantCount, agendaId }`; orchestration: `{ planId, collaboratorCount, upstreamOutputHash }` | 否 |
| ToolsetContextBuilder (tool spec 部分) | `toolset-spec` | `{ toolIdsSorted }` | 否 |

MemoryContextBuilder 和 ToolsetContextBuilder（skill activation 部分）保持不接入（每轮内容可能不同）。

### 步骤 4：Meeting service 移除 task.messages 中的 system prompt 注入

**文件**：`meeting.service.ts` 的 `buildMeetingResponseContext()` 方法

- 移除 `messages.push({ role: 'system', content: meetingContextPrompt })` （line 1943-1947）
- `buildMeetingResponseContext` 只返回对话历史（user/assistant）+ trigger user 消息
- meeting context、execution policy 等 system 内容全部由 builder 链统一生成
- 确认 `CollaborationContextBuilder` + `TaskContextBuilder` 已覆盖 meetingContextPrompt 中的所有信息
- 如有未覆盖内容（如会议简报、参与者职责描述），归入对应 builder

同步处理 `catchUpAgent()`（line 2015-2033）中的 system prompt 注入。

### 步骤 5：持久化分层 -- prepareExecution 不再向 session 写 system 消息

**文件**：`agent-executor.service.ts`

- 移除 `prepareExecution()` 中的 `appendSystemMessagesToSession` 调用（line 768）
- system context 快照已在 `startRun()` 时存入 `run.metadata.initialSystemMessages`，无需重复持久化
- 标记 `AgentExecutorRuntimeService.appendSystemMessagesToSession` 为 deprecated

### 步骤 6：startRun 不再为 system 消息创建 AgentMessage 文档

**文件**：`runtime-orchestrator.service.ts`

- 移除 `startRun()` 中 line 191-204 的 system message 创建循环
- `initialSystemMessages` 保留在 `run.metadata` 中（已在 line 97-100 存储），可通过 `run.metadata.initialSystemMessages` 查询审计
- 只创建 user message（保持 line 206-216 不变）

### 步骤 7：扩展 buildSystemContextKey 覆盖范围

**文件**：`context-fingerprint.util.ts`

扩展 `buildSystemContextKey()` 为所有 builder 输出定义结构化 key：

- `协作上下文(` / `团队上下文:` -> `collab:<hash>`
- `你正在参加一个会议，会议标题是"..."` -> `meeting_brief:<title>`
- `【身份与职责】` -> `identity_memo:<hash>`
- `业务领域上下文:` -> `domain:<hash>`
- `任务信息:` / `任务信息增量更新` -> `task_info:<hash>`
- `当你需要调用工具时` -> `tool_injection:<hash>`
- `工具使用策略（` -> `tool_strategy:<hash>`
- `Enabled Skills for this agent` -> `skill_index:<hash>`
- `工作记忆（历史运行摘要）` -> `run_summaries:<hash>`
- `从备忘录中按需检索到的相关记忆` -> `memo_recall:<hash>`

此改动是步骤 2 的保险层 -- 即使有遗漏的调用路径，也能正确去重。

## 改造后数据流对比

### 改前（每轮 run）

```
Meeting Service                    ContextAssemblerService
  |                                  |
  +-- system prompt (1条)            +-- 6 builders (5-12条 system)
  |                                  |
  +-- 对话历史 (N条 user/assistant)   |
  v                                  v
  task.messages ----------------> previousMessages
                                     |
                              assemble() 合并去重(很多漏网)
                                     |
                              最终 messages (system * 8-14 + user/assistant * N)
                                     |
                         +-----------+-----------+
                         |                       |
                    发给 LLM               appendSystemMessages
                                          -> session.messages (每轮追加)
                                          -> AgentMessage 文档 (每轮新建)
```

### 改后（每轮 run）

```
Meeting Service                    ContextAssemblerService
  |                                  |
  +-- 对话历史 (N条 user/assistant)  +-- 6 builders (fingerprint 抑制后: 0-3条)
  v                                  v
  task.messages --(过滤system)--> 只保留 user/assistant/tool
                                     |
                              assemble() = systemBlocks + conversationHistory
                                     |
                              最终 messages (system * 2-5 + user/assistant * N)
                                     |
                         +-----------+-----------+
                         |                       |
                    发给 LLM              run.metadata (快照审计)
                                   session.messages 不写 system
                                   不创建 system AgentMessage
```

## 预期效果

| 指标 | 改前 | 改后 |
|------|------|------|
| 每轮 system 消息数 | 8-14 条（全量重复） | 首轮 5-8 条，后续 0-3 条（仅变更部分） |
| 20 轮会议后 session.messages 中 system 条数 | ~160+ 条 | 0 条 |
| 20 轮后 agent_messages 中 system 文档数 | ~160+ 条 | 0 条 |
| 发送给 LLM 的 token 中 system 占比 | >70% | 20-30% |

## 关键影响点

- **后端 / Context 模块**：context-assembler、6 个 builder、fingerprint service/util
- **后端 / Runtime 模块**：runtime-orchestrator（startRun）、runtime-persistence（appendSystemMessagesToSession）
- **后端 / Executor 模块**：agent-executor（prepareExecution / buildMessages）、agent-executor-runtime
- **后端 / Meeting 模块**：meeting.service（buildMeetingResponseContext / catchUpAgent）
- **数据库**：session.messages 结构不变但写入策略调整；agent_messages 集合减少 system 文档

## 风险与依赖

- **风险**：Meeting service 移除 system prompt 后，CollaborationContextBuilder + TaskContextBuilder 可能未完全覆盖 meetingContextPrompt 的所有信息。
  - **缓解**：步骤 4 执行前逐字段比对 meetingContextPrompt 和 builder 输出，确认覆盖率。如有缺失，在对应 builder 中补充。
- **风险**：fingerprint 的 Redis TTL 过期后，static block 会重新注入一次完整内容。
  - **缓解**：这是预期行为（长时间未交互的 session 重新激活时需要完整上下文），且只影响首次恢复的那一轮。
- **风险**：移除 system AgentMessage 创建后，依赖 agent_messages 的审计查询可能受影响。
  - **缓解**：system 快照已存在于 `run.metadata.initialSystemMessages`，审计查询改为从 run 维度检索。需确认无前端页面直接依赖 system role 的 AgentMessage。
- **风险**：步骤 2 丢弃 previousMessages 中的 system 可能影响非 meeting 场景（如 HTTP 直接调用带 system 消息）。
  - **缓解**：当前所有非 meeting 调用方（planner、worker、inner-message）传入的 messages 要么为空、要么只有 user，不受影响。HTTP 端点 (`AgentController`) 理论上可接受外部 system 消息，但应通过 builder 链统一管理而非外部注入。

## 执行优先级

| 阶段 | 步骤 | 风险 | 优先级 |
|------|------|------|--------|
| 1 | 步骤 2（assembler 丢弃 previous system） | 低 | 最高 -- 直接阻断重复源 |
| 1 | 步骤 4（meeting service 移除 system 注入） | 中 | 高 -- 需确认 builder 覆盖 |
| 2 | 步骤 5 + 6（持久化分层） | 低 | 高 -- 写入路径简化 |
| 3 | 步骤 1 + 3（builder 接口 + fingerprint 扩展） | 中 | 中 -- 逐个 builder 改造 |
| 3 | 步骤 7（contextKey 扩展） | 低 | 中 -- 纯增量，向后兼容 |

## 回归验证

```typescript
// 1. system 消息数恒定性
it('system count stays bounded across 20 meeting rounds', async () => {
  const counts: number[] = [];
  for (let i = 0; i < 20; i++) {
    const result = await assembler.assemble(meetingInput);
    counts.push(result.systemBlockCount);
  }
  expect(counts[0]).toBeLessThanOrEqual(8);
  expect(Math.max(...counts.slice(1))).toBeLessThanOrEqual(3);
});

// 2. session.messages 中无 system 消息
it('session.messages contains no system messages after 10 runs', async () => {
  // ... 执行 10 轮 ...
  const session = await persistence.getSessionById(sessionId);
  const systemInSession = session.messages.filter(m => m.role === 'system');
  expect(systemInSession.length).toBe(0);
});

// 3. previousMessages 中的 system 被正确过滤
it('assembler discards system messages from previousMessages', async () => {
  const input = buildInput({
    previousMessages: [
      { role: 'system', content: 'injected by meeting service' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ],
  });
  const result = await assembler.assemble(input);
  const fromPrevious = result.messages.filter(
    m => m.content === 'injected by meeting service'
  );
  expect(fromPrevious.length).toBe(0);
});

// 4. run.metadata 包含 system 快照（审计可追溯）
it('run.metadata.initialSystemMessages contains system snapshot', async () => {
  const run = await persistence.findRunById(runId);
  expect(run.metadata.initialSystemMessages).toBeDefined();
  expect(run.metadata.initialSystemMessages.length).toBeGreaterThan(0);
});

// 5. fingerprint 抑制验证
it('static blocks are suppressed on second build within same scope', async () => {
  const result1 = await assembler.assemble(meetingInput);
  const result2 = await assembler.assemble(meetingInput);
  expect(result2.systemBlockCount).toBeLessThan(result1.systemBlockCount);
});
```

## 与已有计划的关系

- `MEETING_RESPONSE_CONTEXT_AND_PROMPT_DEDUP_PLAN.md` -- 该计划解决的是 session 层面的 system message 去重，属于"止血"措施。本计划是其架构级根治方案，执行后该计划中的去重逻辑可简化或移除。
- `MEETING_AGENT_SESSION_CONTEXT_SYNC_AND_DEDUP_PLAN.md` -- 该计划处理入会 catch-up 与 system 去重。本计划的步骤 4 覆盖了 catch-up 路径的 system 注入移除，两者目标一致。
- `AGENT_SESSION_CONTEXT_ARCHITECTURE_PLAN.md` -- 该计划涉及 session context 架构对齐。本计划的分层模型（run envelope vs session history）是其自然延伸。

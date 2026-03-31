# Session System Message 持久化方案

> 状态：待确认
> 创建时间：2026-03-30
> 关联问题文档：`docs/issue/PLAN_OPTIMAZE.md`

## 背景

当前 agent runtime 发送给 LLM 的完整消息序列包含三类消息：

1. **初始 system messages**：由 `ContextAssemblerService` 的 6 个 builder（identity/toolset/domain/collaboration/task/memory）在内存中拼装
2. **user prompt**：由 planner.service.ts 等业务层构建
3. **中间 system messages**：tool-calling loop 中产生的工具结果回灌、系统纠正指令、工具拒绝/参数修复指令

其中 (2) 已作为 `role: 'user'` / `role: 'assistant'` 存入 `agent_messages`。
(1) 当前存入 `run.metadata.initialSystemMessages`，前端通过虚拟消息注入展示。
(3) 完全不落库，前端无法看到。

这导致前端展示的消息序列与 LLM 实际收到的 context 不一致，无法用于问题诊断和 Prompt 优化。

## 目标

1. 前端 session detail 展示的消息序列与 LLM 实际收到的完全一致（含 system + tool result + 系统纠正）
2. 同一 session 内的初始 system messages 只构建一次、存储一次，后续 run 复用
3. 不增加 LLM 调用延迟，DB 写入对主流程无阻塞影响

## 方案概述

分两步执行：

### 步骤 1：初始 System Messages 固化到 Session

session 首次创建时，将 `contextAssembler.assemble()` 产出的 system messages 写入 session document 的 `initialSystemMessages` 字段。后续同 session 内的 run 从 DB 读取，不再重新拼装。

**适用场景分析**：

| 场景 | session 粒度 | system messages 稳定性 | 是否适用 |
|------|-------------|----------------------|---------|
| Meeting | 1 agent / 1 meeting | 稳定（同 meeting 内身份/工具/skill 不变） | 适用 |
| Plan — planner initialize | 独立 session | 稳定（单 phase 内 roleInPlan/skill 裁剪固定） | 适用 |
| Plan — planner generating | 独立 session | 稳定（同上） | 适用 |
| Plan — planner pre_execute | 独立 session | 稳定（同上） | 适用 |
| Plan — planner post_execute | 独立 session | 稳定（同上） | 适用 |
| Plan — executor | 按 planId+agentId+orchRunId 隔离 | 稳定（同 agent 同 plan） | 适用 |
| Chat | 1 agent / 1 chat | 稳定 | 适用 |

**收益**：
- 减少重复的 DB 查询（identity memos、skill content、tool specs 等每次 run 都重新加载）
- system messages 有唯一 ID，前端可直接渲染
- `run.metadata.initialSystemMessages` 可废弃，减少 run document 体积

### 步骤 2：中间 System Messages 持久化

在 tool-calling loop 的各注入点，将 tool result / 系统纠正 / 工具拒绝等 system 消息同步写入 `agent_messages`，作为 `role: 'system'` 的独立消息记录。

**注入点清单**（`agent-executor.service.ts`）：

| 注入点 | 行号 | 内容 | 触发条件 |
|--------|------|------|---------|
| 工具成功结果 | L1674-1678 | `工具 {toolId} 调用结果: {payload}` | 每次工具调用成功 |
| 工具失败结果 | L1713-1720 | `toolFailedInstruction` prompt | 工具调用抛异常 |
| 工具参数修复 | L1726-1735 | `buildToolInputRepairInstruction` | 参数预检失败 |
| 工具权限拒绝 | L1535-1541 | `toolDeniedInstruction` prompt | 调用未授权工具 |
| Planner 纯文本纠正 | L1437-1441 | `【系统纠正】` 指令 | planner 输出纯文本 |
| 空回复重试 | L1463-1467 | `emptyResponseRetryPrompt` | meeting 场景空回复 |
| 输入预检失败 | L1567-1576 | `buildToolInputRepairInstruction` | 工具参数预检失败 |

**收益**：
- 前端能看到完整的 system ↔ assistant 交替序列
- 诊断 Planner 输出不稳定问题时，可直接在前端 session 中复现 LLM 看到的完整 context

## 执行步骤

### Step 1：Schema + 存储层改造（后端）

- [ ] 1.1 `agent-session.schema.ts`：新增 `initialSystemMessages` 字段（数组，每项含 `id`/`content`/`metadata`）
- [ ] 1.2 `runtime-persistence.service.ts`：`ensureSession` / `getOrCreatePlanSession` / `getOrCreateMeetingSession` 支持写入 `initialSystemMessages`
- [ ] 1.3 `runtime-persistence.service.ts`：新增 `getSessionInitialSystemMessages(sessionId)` 读取方法
- [ ] 1.4 `runtime-persistence.service.ts`：`getSessionDetailById` 改为从 session document 读取 `initialSystemMessages`，不再从 `run.metadata` 读取虚拟消息

### Step 2：buildMessages 改造 — 首次构建写入、后续复用（后端）

- [ ] 2.1 `agent-executor.service.ts` 的 `buildMessages`：增加"session 是否已有 initialSystemMessages"判断
- [ ] 2.2 首次（session.initialSystemMessages 为空）：正常调用 `contextAssembler.assemble()`，将 system messages 写入 session
- [ ] 2.3 后续（session.initialSystemMessages 已有值）：直接从 session 读取 system messages，跳过 6 个 builder 的 DB 查询和拼装
- [ ] 2.4 拼装最终 messages = `[session.initialSystemMessages] + [previousNonSystemMessages]`

### Step 3：中间 System Messages 持久化（后端）

- [ ] 3.1 `agent-executor.service.ts`：在 6 个注入点调用 `runtimePersistence.createMessage` 写入 `role: 'system'` 消息
- [ ] 3.2 中间 system 消息的 sequence 采用 `(round + 2) * 100 + offset` 避免与 assistant 消息冲突
- [ ] 3.3 中间 system 消息的 metadata 标记 `source: 'tool-calling-loop'`，区别于初始 system 消息

### Step 4：清理 run.metadata.initialSystemMessages（后端）

- [ ] 4.1 `agent-executor-runtime.service.ts`：`startRuntimeExecution` 不再将 system messages 写入 `run.metadata.initialSystemMessages`
- [ ] 4.2 `runtime-orchestrator.service.ts`：移除 `extractInitialSystemMessages` 相关逻辑
- [ ] 4.3 `getSessionDetailById`：移除虚拟消息注入逻辑（`virtual-system-*`）

### Step 5：前端适配

- [ ] 5.1 `SessionDrawer.tsx` / `useSessionState.ts`：system 消息现在是真实 DB 记录，移除虚拟消息的特殊处理
- [ ] 5.2 验证消息排序：按 `timestamp → sequence` 排序后，system / user / assistant 交替显示正确

### Step 6：验证与回归

- [ ] 6.1 验证 plan 场景：initialize session 的 system messages 正确固化并展示
- [ ] 6.2 验证 meeting 场景：同一 meeting 多次发言复用同一套 system messages
- [ ] 6.3 验证 tool result：前端可看到工具调用结果的 system 消息
- [ ] 6.4 验证系统纠正：planner text-only retry 的纠正指令在前端可见
- [ ] 6.5 回归：现有功能（聊天、会议、编排执行）不受影响

## 影响范围

| 模块 | 影响程度 | 说明 |
|------|---------|------|
| `agent-session.schema.ts` | 低 | 新增字段 |
| `agent-executor.service.ts` | 中 | buildMessages 增加缓存分支 + 6 个注入点 persist |
| `agent-executor-runtime.service.ts` | 低 | 移除 initialSystemMessages 写入 run.metadata |
| `runtime-persistence.service.ts` | 中 | session 读写 + getSessionDetailById 简化 |
| `runtime-orchestrator.service.ts` | 低 | 移除 extractInitialSystemMessages |
| `SessionDrawer.tsx` / `useSessionState.ts` | 低 | 移除虚拟消息处理 |

## 风险

1. **session 内 system messages 过期**：如果 agent 的 skill/工具配置变更，已固化的 system messages 不会自动更新。需要提供 session 级别的"刷新 system context"能力（可后续迭代，当前 session 生命周期较短）
2. **session document 体积增长**：initialSystemMessages 可能有 5-15 条，每条 200-2000 字符。单个 session 增加约 10-30KB，在 MongoDB 文档大小限制内无压力
3. **中间 system 消息写入延迟**：tool result persist 是同步操作，但单条消息写入 <5ms，对 tool-calling loop 影响可忽略

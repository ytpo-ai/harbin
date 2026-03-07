# Agent Orchestration 架构设计

## 1. 设计目标

本设计用于统一计划编排（Orchestration）与 Agent 执行运行时（Agents Runtime）的职责边界，目标如下：

1. 编排与执行解耦：`orchestration` 负责计划与任务调度，`apps/agents` 负责执行与过程数据。
2. 会话统一：所有 agent 执行过程归口 `AgentSession`，避免多套 session 存储。
3. 可观测性增强：在 plan 维度可追踪 task 输入/输出/状态，同时保留 run 级细粒度追踪能力。
4. 数据可扩展：采用引用式结构避免单文档膨胀，支持后续 meeting/memo 场景复用。

---

## 2. 分层架构

```
┌──────────────────────────────────────────────────────┐
│                    Legacy Orchestration              │
│  - Plan 创建/查询/删除                               │
│  - Task 依赖调度（sequential/parallel/hybrid）       │
│  - 任务分配与质量校验                                 │
│  - PlanSession（task I/O 视图）                      │
└───────────────────────┬──────────────────────────────┘
                        │ 内部调用
                        ▼
┌──────────────────────────────────────────────────────┐
│                     Agents Service                   │
│  - Agent 执行接口（/agents/:id/execute）            │
│  - Runtime Orchestrator（run 生命周期）              │
│  - Runtime Persistence（run/message/part/outbox）    │
│  - AgentSession（统一上下文容器）                    │
└──────────────────────────────────────────────────────┘
```

---

## 3. 核心数据模型

### 3.1 AgentSession（apps/agents）

定位：统一上下文容器，承载 agent 过程数据索引与上下文聚合。

关键字段：

- `id`
- `organizationId`
- `ownerType / ownerId`
- `title / status / lastActiveAt`
- `runIds[]`（引用 run）
- `memoIds[]`（引用 memo）
- `messages[]`（会话主消息流：system/user/assistant/tool）
- `planContext`：`linkedPlanId/linkedTaskId/latestTaskInput/latestTaskOutput/lastRunId`
- `meetingContext`：会议上下文预留

设计原则：

- 以引用为主，不内嵌高体积执行细节；会话主消息可直接内嵌存储。
- 允许多业务上下文（plan/meeting）复用同一 session 容器。
- 通过 `AGENT_SESSION_MAX_MESSAGES` 限制 `messages[]` 容量，避免 session 文档过大。

### 3.2 PlanSession（orchestration）

定位：计划执行视图层，仅记录 task 级输入输出与状态，不记录工具调用细节。

关键字段：

- `planId / organizationId / title / status`
- `tasks[]`：
  - `taskId/order/title/status`
  - `input/output/error`
  - `executorType/executorId`
  - `agentSessionId/agentRunId`
  - `updatedAt`

设计原则：

- 面向编排查询与前端展示。
- 细粒度执行细节（tool pending/running/completed）留在 runtime 数据层。

---

## 4. 执行流程设计

### 4.1 计划创建

1. `POST /orchestration/plans/from-prompt`
2. Planner 生成 task 草案与依赖。
3. `orchestration` 创建 `OrchestrationPlan` + `OrchestrationTask[]`。
4. 同步初始化 `PlanSession`（填充 task 快照）。

### 4.2 任务执行（每个 task 一个 session）

1. 会议内可由 Agent 通过 `orchestration_*` MCP 工具触发计划创建/执行/查询。
2. `orchestration` 调度到可执行 task。
3. 调用 `agents/:id/execute`，并传入 task 级 `sessionId`（如 `orch-task-{taskId}`）。
4. `apps/agents` runtime：
   - `ensureSession`（不存在则创建）
   - 启动 run 并写入 run/message/part/outbox
   - 同步将会话消息写入 `AgentSession.messages[]`
5. 执行结束返回：`response + runId + sessionId`。
6. `orchestration` 回写：
   - `OrchestrationTask.result/status/sessionId`
   - `PlanSession.tasks[].output/status/agentSessionId/agentRunId`

### 4.3 异常与人工接管

- 分配失败、校验失败、外部动作证据不足 → `waiting_human` 或 `failed`。
- `orchestration` 统一更新 PlanSession 快照，保证 plan 视图可追踪。

---

## 5. API 契约约定

### 5.1 Agent 执行接口

- `POST /agents/:id/execute`
- 响应：

```json
{
  "response": "...",
  "runId": "run-...",
  "sessionId": "orch-task-..."
}
```

### 5.2 Orchestration 查询接口

- `GET /orchestration/plans/:id`
- 返回包含：`plan + tasks + planSession`

---

## 6. 职责边界

### orchestration 负责

- 计划生成与任务依赖拓扑
- 执行者分配
- 任务质量校验（研究/审核/外部动作规则）
- 计划状态推进与 PlanSession 维护

### apps/agents 负责

- session/run 生命周期
- llm/tool 过程数据持久化
- runtime 事件发布与控制面能力

### 明确不做

- orchestration 不再维护 `/orchestration/sessions`。
- PlanSession 不承载 tool 调用细节。

---

## 7. 可扩展性设计

1. 事件驱动回写：后续可改为 runtime hook 事件异步更新 PlanSession。
2. 跨域上下文：AgentSession 已支持 `meetingContext`，可直接接入会议流程。
3. 数据分层检索：
   - 编排视角：`plan -> planSession.tasks[]`
   - 执行视角：`sessionId/runId -> run/message/part/outbox`

---

## 8. 风险与治理

1. **一致性风险**：跨服务写入可能出现部分成功。
   - 治理：使用幂等更新（按 `taskId` 定位更新 `PlanSession.tasks.$`）。
2. **历史兼容风险**：旧数据仍在 legacy session 集合。
   - 治理：读路径兼容 + 后续迁移脚本。
3. **契约漂移风险**：execute 接口返回结构变化。
   - 治理：明确 contract 并保持向后兼容（`response` 字段不变）。

---

## 9. 观测与排障路径

推荐排障顺序：

1. 查 plan：`/orchestration/plans/:id` 观察 `planSession.tasks[].status/error`。
2. 定位 task：获取 `agentSessionId` 与 `agentRunId`。
3. 查 runtime：按 runId 查询事件与运行状态。
4. 查 outbox：若存在事件缺失，排查 dead-letter 与重投记录。

---

## 10. 后续演进建议

1. 引入共享 TypeScript contract 包，统一 `execute` 入参与返回类型。
2. 增加 PlanSession 专用查询接口（按 task 状态筛选、按时间增量拉取）。
3. 将 task 级 sessionId 从约定字符串升级为由 agents 侧统一分配并回传。
4. 增加迁移工具，逐步下线 legacy 侧历史 AgentSession 数据。

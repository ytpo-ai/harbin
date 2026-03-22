# Agent Session Run 级别隔离

## 背景

当前 agent session 的隔离边界是 `Plan × Agent`，session ID 格式为 `plan-{planId}-{agentId}`。这意味着同一个 plan 下同一个 agent，无论执行多少次 orchestration run（周期调度/调试），都复用同一个 session。

### 问题现象

1. 周期性计划（schedule）每次触发都复用旧 session，消息和 runSummaries 无限堆积
2. 调试（debug-task）时旧 session 的脏状态污染新执行，agent 上下文碎片化
3. Agent 无法区分"上次 run 成功了还是失败了"，因为历史摘要混在一起

### 根因

- `getOrCreatePlanSession` 查询条件只有 `{planId, agentId, sessionType}`，不包含 runId
- `executeRunTaskNode` 虽然默认生成了 `run-${runId}-${agentId}`，但随即被 `getOrCreatePlanSession` 覆盖为 `plan-{planId}-{agentId}`

## 目标模型

隔离边界从 `Plan × Agent` 改为 `Plan × Agent × OrchestrationRun`：

```
Plan
 └── Agent
      ├── Orchestration Run 1 → 独立 Session (plan-{planId}-{agentId}-run-{runId})
      │    ├── task-a (执行)     ← 同一 run 内共享 session
      │    └── task-b (验证)
      │
      ├── Orchestration Run 2 → 独立 Session
      └── Debug Run → 独立 Session
```

## 改动步骤

### Step 1: Schema — agent-session.schema.ts
- `planContext` 增加 `orchestrationRunId?: string` 字段
- 增加复合索引 `{planContext.linkedPlanId, planContext.orchestrationRunId, ownerId, sessionType}`

### Step 2: Persistence — runtime-persistence.service.ts
- `getOrCreatePlanSession` options 增加 `orchestrationRunId?: string`
- 查询时如果有 `orchestrationRunId`，将其加入 lookup filter
- session ID 格式改为 `plan-{planId}-{agentId}-run-{runId}`（有 runId 时）
- `planContext` 写入 `orchestrationRunId`

### Step 3: 中间层透传 — agent-client.service.ts + runtime.controller.ts
- `getOrCreatePlanSession` HTTP 调用透传 `orchestrationRunId`

### Step 4: 编排入口 — orchestration.service.ts
- `executeRunTaskNode` 调用 `getOrCreatePlanSession` 时传入 `orchestrationRunId: runId`

## 兼容性

- 非 run 场景（legacy executeTaskNode、手动单任务）：不传 orchestrationRunId，行为不变
- run 场景（周期调度/调试/autorun）：传 orchestrationRunId，session 按 run 隔离
- 已有 session 数据：不受影响，旧 session 无此字段

## 影响范围

- backend/apps/agents: schema + persistence + controller
- backend/src/modules/orchestration: orchestration.service
- backend/src/modules/agents-client: agent-client.service

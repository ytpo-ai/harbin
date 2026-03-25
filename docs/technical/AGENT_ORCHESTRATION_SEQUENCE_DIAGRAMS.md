# [已弃用] AGENT_ORCHESTRATION_SEQUENCE_DIAGRAMS

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Agent Orchestration 时序图

## 1. Plan 创建时序

```mermaid
sequenceDiagram
  autonumber
  participant UI as Frontend
  participant ORCH as Legacy Orchestration
  participant PLANNER as PlannerService
  participant DB as MongoDB

  UI->>ORCH: POST /orchestration/plans/from-prompt
  ORCH->>PLANNER: planFromPrompt(prompt, mode)
  PLANNER-->>ORCH: tasks[] + dependencies + strategy

  ORCH->>DB: create OrchestrationPlan
  ORCH->>DB: insert OrchestrationTask[]
  ORCH->>DB: create PlanSession(tasks snapshot)

  ORCH-->>UI: plan + tasks + planSession
```

---

## 1.1 会议中通过 MCP 触发编排

```mermaid
sequenceDiagram
  autonumber
  participant USER as Meeting User
  participant AG as Meeting Agent
  participant TOOL as ToolService(orchestration_*)
  participant ORCH as Legacy Orchestration API

  USER->>AG: 在会议中下达编排任务
  AG->>TOOL: 调用 orchestration_create_plan
  TOOL->>ORCH: POST /orchestration/plans/from-prompt (signed headers)
  ORCH-->>TOOL: plan + tasks
  TOOL-->>AG: structured result

  AG->>TOOL: orchestration_run_plan(confirm=true)
  TOOL->>ORCH: POST /orchestration/plans/:id/run
  ORCH-->>TOOL: accepted/running
  TOOL-->>AG: run accepted
```

---

## 2. Task 执行时序（每个 Task 一个 Session）

```mermaid
sequenceDiagram
  autonumber
  participant ORCH as Legacy Orchestration
  participant AG as Agents API
  participant RT as Runtime Orchestrator
  participant DB as MongoDB

  ORCH->>ORCH: select runnable task by dependencies
  ORCH->>DB: update task status=in_progress
  ORCH->>DB: update PlanSession.tasks[taskId].status=in_progress

  ORCH->>AG: POST /agents/:id/execute
  Note over ORCH,AG: context.teamContext.sessionId = "orch-task-{taskId}"

  AG->>RT: startRun(agentId, taskId, sessionId, planId)
  RT->>DB: ensure AgentSession(sessionId)
  RT->>DB: create/find active run
  RT->>DB: write run/message/part/event
  RT->>DB: append AgentSession.messages[]

  AG-->>ORCH: {response, runId, sessionId}

  ORCH->>DB: update OrchestrationTask(result, sessionId, status)
  ORCH->>DB: update PlanSession.tasks[taskId](output, agentSessionId, agentRunId, status)
```

---

## 3. 失败/人工接管时序

```mermaid
sequenceDiagram
  autonumber
  participant ORCH as Legacy Orchestration
  participant AG as Agents API
  participant UI as Frontend
  participant DB as MongoDB

  ORCH->>AG: execute task
  AG-->>ORCH: error or unverifiable external action

  alt validation failed
    ORCH->>DB: update task status=failed
    ORCH->>DB: update PlanSession.tasks[taskId].status=failed
    ORCH->>DB: write error summary
  else waiting human
    ORCH->>DB: update task status=waiting_human
    ORCH->>DB: update PlanSession.tasks[taskId].status=waiting_human
    ORCH-->>UI: task requires human action
  end
```

---

## 4. 失败任务重试时序

```mermaid
sequenceDiagram
  autonumber
  participant UI as Frontend
  participant ORCH as Legacy Orchestration
  participant DB as MongoDB
  participant AG as Agents API

  UI->>ORCH: POST /orchestration/tasks/:id/retry
  ORCH->>DB: reset task status to assigned/pending
  ORCH->>DB: clear task result fields
  ORCH->>DB: update PlanSession.tasks[taskId].status

  ORCH->>ORCH: runPlanAsync(planId, continueOnFailure=true)
  ORCH->>AG: execute task again
  AG-->>ORCH: {response, runId, sessionId}
  ORCH->>DB: update task + PlanSession snapshot
```

---

## 5. 查询与排障时序

```mermaid
sequenceDiagram
  autonumber
  participant UI as Frontend
  participant ORCH as Legacy Orchestration
  participant ART as Agents Runtime API
  participant DB as MongoDB

  UI->>ORCH: GET /orchestration/plans/:id
  ORCH->>DB: load plan + tasks + planSession
  ORCH-->>UI: plan detail with planSession

  UI->>ART: GET /agents/runtime/runs/:runId
  ART->>DB: load run
  ART-->>UI: run status/events hint
```

---

## 6. 说明

- `PlanSession` 是编排视图，不记录工具调用细节。
- `AgentSession.messages` 是会话主消息流，便于会议/编排直接获取上下文。
- 工具调用/流式 token/事件状态在 runtime 数据层（run/message/part/outbox）。
- 推荐排障路径：`planSession.task -> agentRunId -> runtime run/outbox`。

# SESSION CONTEXT ARCHITECTURE

## 目标

将 Agent Runtime 的 session 粒度从 task 级逐步提升到 plan 级，并把上下文组装重构为 6 层可维护结构。

## 当前落地（本次实现）

1. `AgentSession` 扩展了 `chat` 类型，并新增：
   - `planContext.currentTaskId`
   - `planContext.completedTaskIds`
   - `meetingContext.meetingType`
   - `domainContext`
   - `collaborationContext`
   - `runSummaries`

2. Runtime 持久化层新增：
   - `getOrCreatePlanSession(planId, agentId, ...)`
   - `appendRunSummary(sessionId, summary)`

3. Runtime 编排层更新：
   - `startRun` 优先按 `meeting -> plan -> task -> chat` 选择 session
   - `completeRun` 自动生成结构化 run summary 并写入 session

4. Context 组装模块新增到：
   - `backend/apps/agents/src/modules/agents/context/`
   - 包含 `ContextAssemblerService` + 6 个 Builder
   - `AgentExecutorService.buildMessages()` 已改为调用 `contextAssembler.assemble(...)`

5. 编排调用上下文更新：
   - `orchestration.service.ts` 的 sessionId 改为 `plan-{planId}-{agentId}`
   - 通过 `sessionContext` 透传 `domainContext` 与 `collaborationContext`

6. Runtime API 新增：
   - `POST /agents/runtime/sessions/plan`

## 关键文件

- `backend/apps/agents/src/schemas/agent-session.schema.ts`
- `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`
- `backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts`
- `backend/apps/agents/src/modules/runtime/runtime.controller.ts`
- `backend/apps/agents/src/modules/agents/context/*`
- `backend/apps/agents/src/modules/agents/agent-executor.service.ts`
- `backend/src/modules/orchestration/orchestration.service.ts`
- `backend/src/modules/agents-client/agent-client.service.ts`

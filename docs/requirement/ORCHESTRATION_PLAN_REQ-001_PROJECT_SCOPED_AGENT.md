# Requirement: ORCHESTRATION_PLAN_REQ-001_PROJECT_SCOPED_AGENT

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-001 |
| 所属 Feature | [ORCHETRATION_TASK](../feature/ORCHETRATION_TASK.md)、[PROJECT_INCUBATION](../feature/PROJECT_%20INCUBATION.md) |
| 所属 Plan | [编排计划按项目约束 Planner 选择与执行者分配](../plan/ORCHESTRATION_PLAN_PROJECT_SCOPED_AGENT_CONSTRAINT_PLAN.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | done |
| 创建日期 | 2026-04-16 |
| 最后更新 | 2026-04-16 |

## 2. 需求描述

### 2.1 背景

编排系统中 plan 已支持 `projectId` 关联孵化项目，Agent 也已有 `projectId` 归属字段，但 Planner 选择和执行者分配环节未利用该字段进行约束。用户在创建归属某项目的计划时，可看到并选择其他项目的 agent，Planner AI 运行时也会将任务分配给不属于该项目的 agent。

### 2.2 目标

在前端 Planner 选择、后端 `list-agents` 工具、后端 `ExecutorSelectionService` 三个环节打通 projectId 约束，确保归属项目的计划只能选择该项目 agent + 全局 agent。

### 2.3 验收条件

- [x] 前端：选中项目时，Planner 下拉列表仅展示该项目 agent + 全局 agent（projectId 为空）；未选项目时展示全部
- [x] 前端：在弹窗内切换项目后，若当前 plannerAgentId 不在新列表中则自动清空
- [x] 后端：Planner AI 运行时调用 `list-agents` 工具返回的 agent 列表受 plan.projectId 约束
- [x] 后端：`ExecutorSelectionService` 在路由执行者时，候选集受 plan.projectId 约束
- [x] 无 projectId 的计划行为不变（全部 agent 可用）
- [x] 全局 agent（projectId 为空）在任何项目下均可用

## 3. 技术方案摘要

### 前端改造

1. `agentService.getAssignableAgents(projectId?)` — 有 projectId 时调用 `GET /agents/active?projectId=xxx`
2. `useOrchestrationQueries` — agents 查询 queryKey 加入 projectIdFilter
3. `CreatePlanModal` — 项目切换时清空失效的 plannerAgentId

### 后端改造

1. `tool-execution-dispatcher.service.ts` — list-agents case 传递 executionContext
2. `agent-tool-handler.service.ts` — `getAgentsMcpList` 接收 executionContext，按 projectId 过滤结果集
3. `executor-selection.service.ts` — `ExecutorSelectionContext` 增加 `projectId`，`routeExecutor` 候选集加过滤
4. `incremental-planning.service.ts` — 上游方法透传 plan.projectId 到 ExecutorSelectionContext

### 影响范围

- **前端**：`agentService.ts`、`useOrchestrationQueries.ts`、`CreatePlanModal.tsx`、`orchestration/index.tsx`
- **后端 agents 服务**：`tool-execution-dispatcher.service.ts`、`agent-tool-handler.service.ts`
- **后端编排服务**：`executor-selection.service.ts`、`incremental-planning.service.ts`
- **数据库**：无变更
- **API**：无新增端点

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/ORCHESTRATION_PLAN_REQ-001_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| — | — | — |

## 5. 备注

- 后端 `GET /agents/active?projectId=xxx` 的现有语义是精确匹配：传 projectId 返回该项目 agent，传空串返回全局 agent。前端需要"项目 agent + 全局 agent"的合集，需确认是前端两次请求合并还是后端提供新的过滤语义
- Employee 候选者暂不增加 projectId 过滤

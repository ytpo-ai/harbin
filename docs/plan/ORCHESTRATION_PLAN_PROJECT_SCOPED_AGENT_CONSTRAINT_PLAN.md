# Plan: 编排计划按项目约束 Planner 选择与执行者分配

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [ORCHETRATION_TASK](../feature/ORCHETRATION_TASK.md)、[PROJECT_INCUBATION](../feature/PROJECT_%20INCUBATION.md) |
| 需求管理 ID | — |
| 所属项目 | — |
| OpenCode Session | — |
| 状态 | done |
| 优先级 | high |
| 创建日期 | 2026-04-16 |

## 2. 背景

当前编排系统在创建计划时虽然支持指定 `projectId`（所属孵化项目），但该字段仅用于数据关联和查询过滤，**未在 Planner 选择和执行者分配环节生效**。具体表现：

1. **前端 Planner 选择无项目约束**：`CreatePlanModal` 中的 planner agent 下拉列表展示全局所有可分配 agent（`useOrchestrationQueries.ts:155` 调用 `agentService.getAssignableAgents()` 不传 `projectId`），即使用户已选择了某个孵化项目，仍可选择不属于该项目的 agent 作为 planner。

2. **后端 `list-agents` 工具无项目约束**：Planner AI 在 `phaseInitialize` 和 `phaseGenerate` 阶段通过 `list-agents` 工具获取可用 agent 列表时（`agent-tool-handler.service.ts:208`），执行 `this.agentModel.find()` 返回全部 agent，不根据 plan 的 `projectId` 过滤。Dispatcher 调用时也未传递 `executionContext`（`tool-execution-dispatcher.service.ts:121-122`）。

3. **后端执行者选择无项目约束**：`ExecutorSelectionService.routeExecutor()`（`executor-selection.service.ts:252`）候选集为 `agentModel.find({ isActive: true })` 全部活跃 agent，`ExecutorSelectionContext` 接口无 `projectId` 字段，多维度打分完全不考虑项目归属。

这导致：当一个编排计划归属某个孵化项目时，Planner 可能选择其他项目的 agent 来执行任务，破坏了项目的组织隔离性。

### 现有基础

- Agent schema 已有 `projectId` 字段（`backend/apps/agents/src/schemas/agent.schema.ts:117-119`），为空表示全局 agent
- 后端 `GET /agents` 和 `GET /agents/active` API 已支持 `?projectId=xxx` 查询参数（`agent.controller.ts:104-116`）
- 前端 `agentService.getAgents()` 已支持传入 `{ projectId }` 参数（`agentService.ts:328-331`）
- Plan、Task、Run schema 均已有 `projectId` 字段且从 plan 级联继承

## 3. 目标

在编排系统中打通 `projectId` 的约束能力，确保：

1. **前端**：用户选择项目后，Planner 下拉列表仅展示该项目 agent + 全局 agent
2. **后端 list-agents 工具**：Planner AI 运行时通过工具获取的候选 agent 列表受 plan.projectId 约束
3. **后端执行者选择**：`ExecutorSelectionService` 在路由执行者时，候选集受 plan.projectId 约束

**过滤策略统一**：
- 有 `projectId` 时 → `agent.projectId == projectId`（项目 agent）+ `agent.projectId 为空`（全局 agent）
- 无 `projectId` 时 → 全部 agent（行为不变）

## 4. 执行步骤

1. [x] **前端 — `agentService.getAssignableAgents` 增加 projectId 参数**：方法签名增加 `projectId?: string`，有值时调用 `GET /agents/active?projectId=xxx`（后端已支持），无值时维持当前行为
2. [x] **前端 — `useOrchestrationQueries` 中 agents 查询按项目过滤**：将 `agentService.getAssignableAgents()` 调用改为传入 `projectIdFilter`，queryKey 加入 `projectIdFilter` 使项目切换时自动重新请求
3. [x] **前端 — `CreatePlanModal` 中 planner 列表联动项目选择**：当用户在弹窗内切换"所属项目"时，刷新可选 planner 列表；若当前选中的 plannerAgentId 不在新列表中则自动清空
4. [x] **后端 — `list-agents` 工具支持项目过滤**：Dispatcher 调用 `getAgentsMcpList` 时传递 `executionContext`；`getAgentsMcpList` 从 `executionContext.collaborationContext.projectId` 提取项目 ID；有 projectId 时对结果集按 `agent.projectId == projectId || agent.projectId 为空` 过滤
5. [x] **后端 — `ExecutorSelectionContext` 新增 projectId 字段并在 `routeExecutor` 中应用**：`ExecutorSelectionContext` 接口增加 `projectId?: string`；`routeExecutor()` 加载候选 agent 时加入 projectId 过滤条件；调用链上游 (`resolveAssignmentForPlannerTask`、`resolveFallbackAssignment`、`selectExecutor`) 透传 plan.projectId
6. [x] **回归验证**：确认有 projectId 时过滤生效，无 projectId 时行为不变；确认 planner 运行时 list-agents 结果受约束；确认执行者分配结果受约束

## 5. Requirement 拆解

本 plan 所有步骤服务于同一个功能点（projectId 约束打通），前后端改动环环相扣，统一作为 1 个 requirement 交付。

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-001 | 编排计划按项目约束 Planner 选择与执行者分配 | [链接](../requirement/ORCHESTRATION_PLAN_REQ-001_PROJECT_SCOPED_AGENT.md) | done |

## 6. 关键影响点

- **前端**：`agentService.ts`（`getAssignableAgents` 方法）、`useOrchestrationQueries.ts`（agents 查询）、`CreatePlanModal.tsx`（planner 下拉联动）、`orchestration/index.tsx`（状态管理）
- **后端 agents 服务**：`tool-execution-dispatcher.service.ts`（list-agents 调度）、`agent-tool-handler.service.ts`（`getAgentsMcpList` 过滤）
- **后端编排服务**：`executor-selection.service.ts`（`ExecutorSelectionContext`、`routeExecutor`）、`incremental-planning.service.ts`（`resolveAssignmentForPlannerTask`、`resolveFallbackAssignment`）
- **数据库**：无 schema 变更，仅利用现有 `agent.projectId` 索引
- **API**：无新增端点，仅利用现有 `?projectId` 查询参数
- **文档**：更新 `ORCHETRATION_TASK.md` 功能文档中的 projectId 约束说明

## 7. 风险与依赖

| 风险 | 处理措施 |
|------|----------|
| 全局 agent（`projectId` 为空）的包含策略需统一 | 过滤条件统一为 `projectId == 目标值 OR projectId 为空`，确保全局 agent 始终可被选择 |
| 前端切换项目后当前 plannerAgentId 可能失效 | 切换项目时检测，若失效则自动清空为"默认 Planner" |
| 后端 `getAssignableAgents` 新增 projectId 参数后需向后兼容 | projectId 为可选参数，不传时维持原有全量返回行为 |
| `list-agents` 工具改为传递 executionContext 后需确保其他调用方不受影响 | Dispatcher 中仅 list-agents case 修改传参，其他 case 不受影响；`getAgentsMcpList` 内部 executionContext 为可选参数 |

## 8. 备注

- 本次改造不涉及 `resolveProjectBindingForPlan`（项目绑定解析）逻辑的变更，该链路仍用于注入 `localPath`/`opencodeProjectPath` 到 collaborationContext
- `list-agents` 工具的 projectId 过滤为**服务端侧过滤**（从 executionContext 自动提取），不新增工具参数暴露给 LLM，避免 LLM 幻觉
- Employee 候选者（`ExecutorSelectionService` 中的 employee 分支）暂不增加 projectId 过滤，因 employee 不具备 projectId 字段

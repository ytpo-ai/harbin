# 任务编排（Orchestration）

> 状态：当前有效（2026-03-26）

## 1. 功能范围

- 提供从自然语言到计划任务的编排能力（创建、重编排、增量生成、执行、调试、人工干预）。
- 计划执行采用 Run 语义，支持历史查询、取消运行、运行内任务追踪。
- 模块已完成 Facade + 领域服务拆分；Controller 和 API 入口保持兼容。
- `/orchestration/sessions/*` 仍保留，用于代理到 agents session 能力；不再在 orchestration 内维护独立会话模型。

## 2. 当前实现结构

### 2.1 后端模块

路径：`backend/src/modules/orchestration/`

| 组件 | 文件 | 职责 |
|---|---|---|
| Facade | `orchestration.service.ts` | 对外统一入口，按领域委派 |
| Controller | `orchestration.controller.ts` | `orchestration/*` API 路由 |
| Plan 管理 | `services/plan-management.service.ts` | 计划创建、重编排、更新、删除、发布/解锁 |
| Task 模板管理 | `services/task-management.service.ts` | 任务增删改重排、批量更新、复制、草稿更新 |
| Run 执行 | `services/plan-execution.service.ts` | run 启动、执行、取消、历史查询 |
| Task 运行态 | `services/task-lifecycle.service.ts` | 重分配、人工完成、重试、debug-run |
| 统计 | `services/plan-stats.service.ts` | 计划统计回写与同步 |
| 事件流 | `services/plan-event-stream.service.ts` | SSE 推送（plan/task/run 事件） |
| 上下文 | `services/orchestration-context.service.ts` | task prompt 组装、上下文增强 |
| 执行引擎 | `services/orchestration-execution-engine.service.ts` | task node / run task node 统一执行 |
| 增量编排 | `services/incremental-planning.service.ts` | generate-next 增量产出与落库 |
| Planner | `planner.service.ts` | planner 输出解析、兜底拆解 |
| 阶段调度 | `services/orchestration-step-dispatcher.service.ts` | 四阶段推进（generate/pre/execute/post）与 pre 阶段任务类型推断 |
| Session 代理 | `session-manager.service.ts` | 透传到 agents session 接口 |

### 2.2 前端模块

路径：`frontend/src/components/orchestration/`、`frontend/src/pages/PlanDetail.tsx`、`frontend/src/pages/orchestration/`、`frontend/src/services/orchestrationService.ts`

- 计划详情页支持任务编辑、重编排、run 历史、run 详情、取消运行。
- 编排中心页已拆分为页面编排层 + hooks + 组件层（详见 `docs/guide/ORCHESTRATION_PAGE_SPLIT_REFACTOR_ARCHITECTURE.MD`）。
- 通过 SSE 订阅计划生成和状态变化事件。
- 计划列表项支持“复制并新建”：点击后直接打开创建弹窗，并预填当前计划的创建参数用于二次编辑。

## 3. 数据模型与状态

核心 Schema 路径：`backend/src/shared/schemas/`

| 集合 | 文件 | 说明 |
|---|---|---|
| `orchestration_plans` | `orchestration-plan.schema.ts` | 计划主体、策略、统计、状态 |
| `orchestration_tasks` | `orchestration-task.schema.ts` | 模板任务（依赖、执行者、结果、taskType、runtimeTaskType） |
| `orchestration_runs` | `orchestration-run.schema.ts` | 单次运行记录 |
| `orchestration_run_tasks` | `orchestration-run-task.schema.ts` | 运行态任务快照 |
| `plan_sessions` | `orchestration-plan-session.schema.ts` | 计划聚合视图 |

Plan 关键状态：`draft`、`drafting`、`planned`、`production`

Task 关键状态：`pending`、`assigned`、`in_progress`、`blocked`、`waiting_human`、`completed`、`failed`、`cancelled`

Run 关键状态：`running`、`completed`、`failed`、`cancelled`

## 4. 核心链路

### 4.1 创建与编排

1. `POST /orchestration/plans/from-prompt` 创建计划占位并返回 `planId`。
2. 后台异步生成任务并推送 SSE：`plan.status.changed`、`plan.task.generated`、`plan.completed`、`plan.failed`。
3. incremental + dispatcher 链路在首次推进时先执行 `phaseInitialize`：产出 `plan.metadata.taskContext` 与 `plan.metadata.outline`。
4. development 域由 `phaseInitialize` 先锚定 `requirementId`，后续 step 不再依赖执行结果正则回填。
3. 支持 `POST /orchestration/plans/:id/replan` 覆盖重编排。
5. 支持 `POST /orchestration/plans/:id/generate-next` 增量生成下一任务。
6. 支持 `POST /orchestration/plans/:id/stop-generation` 手动停止当前计划生成流程。
7. Planner session 支持两种模式：
   - `shared`（默认）：`initialize/generating/pre_execute/post_execute` 复用 `generationState.plannerSessionId`
   - `isolated`：按 phase 使用 `generationState.plannerSessionIds[phase]` 独立 session，减少跨阶段上下文污染

### 4.2 执行与取消

1. `POST /orchestration/plans/:id/run` 异步受理运行。
2. 编排执行统一走 `orchestration-execution-engine.service.ts`。
3. agent 任务采用异步 Agent Task + SSE/轮询等待终态。
4. 支持 `POST /orchestration/runs/:runId/cancel` 取消运行并批量回写未完成 run task。

### 4.3 人工干预与调试

- 任务支持重分配、人工完成、重试。
- 支持 `POST /orchestration/tasks/:id/debug-run` 执行单任务调试。
- 模板任务支持新增、删除、完整更新、批量更新、重排、复制。

### 4.4 runtimeTaskType 推断（当前规则）

- 任务创建阶段（planner/generate-next）写入 `taskType`，默认值为 `general`。
- `runtimeTaskType` 统一在 `phasePreExecute` 推断并落库，优先级为：`existingRuntimeTaskType > taskType > domain fallback`。
- 当前有效值：`general`、`research`、`development.plan`、`development.exec`、`development.review`。
- `development.*` 任务默认禁用自动生成模式下的 retry 原地重试，post 阶段会转为 redesign 路径。
- 已移除编排上下文中的关键词分类函数（`isPlanningLikeTask` / `isResearchLikeTask` / `isCodeReviewLikeTask` / `isCodeLikeTask`）。

### 4.5 taskContext 计划级上下文（当前规则）

- 初始化阶段写入：`plan.metadata.taskContext`（development 常见字段：`requirementId`、`requirementTitle`、`requirementDescription`）。
- 执行阶段自动注入：`buildTaskDescription()` 在 prompt 中加入“计划上下文（系统自动注入）”区块。
- 运行追溯快照：创建 run 时快照到 `run.metadata.taskContext`（manual run 与 incremental autorun 均覆盖）。

## 5. API 清单（当前有效）

### 5.1 Plan / Run / Task

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/orchestration/plans/from-prompt` | 从 prompt 创建计划 |
| GET(SSE) | `/orchestration/plans/:id/events` | 订阅计划事件流 |
| GET | `/orchestration/plans` | 计划列表 |
| GET | `/orchestration/plans/:id` | 计划详情 |
| PATCH | `/orchestration/plans/:id` | 更新计划 |
| DELETE | `/orchestration/plans/:id` | 删除计划 |
| POST | `/orchestration/plans/:id/replan` | 重编排 |
| POST | `/orchestration/plans/:id/generate-next` | 增量生成 |
| POST | `/orchestration/plans/:id/stop-generation` | 停止计划生成 |
| POST | `/orchestration/plans/:id/run` | 启动运行 |
| POST | `/orchestration/runs/:runId/cancel` | 取消运行 |
| GET | `/orchestration/plans/:id/runs` | 运行历史 |
| GET | `/orchestration/plans/:id/runs/latest` | 最近运行 |
| GET | `/orchestration/runs/:runId` | 运行详情 |
| GET | `/orchestration/runs/:runId/tasks` | 运行任务明细 |
| GET | `/orchestration/plans/:id/tasks` | 模板任务列表 |
| POST | `/orchestration/plans/:planId/tasks` | 新增模板任务 |
| PATCH | `/orchestration/tasks/:taskId` | 完整更新模板任务 |
| DELETE | `/orchestration/tasks/:taskId` | 删除模板任务 |
| PUT | `/orchestration/plans/:planId/tasks/reorder` | 重排模板任务 |
| PUT | `/orchestration/plans/:planId/tasks/batch-update` | 批量更新模板任务 |
| POST | `/orchestration/plans/:planId/tasks/duplicate/:taskId` | 复制模板任务 |
| POST | `/orchestration/tasks/:id/reassign` | 重分配 |
| POST | `/orchestration/tasks/:id/complete-human` | 人工完成 |
| POST | `/orchestration/tasks/:id/retry` | 重试 |
| POST | `/orchestration/tasks/:id/debug-run` | 调试运行 |
| POST | `/orchestration/plans/:id/publish` | 发布生产态 |
| POST | `/orchestration/plans/:id/unlock` | 解锁可编辑 |
| POST | `/orchestration/tasks/:id/draft` | 草稿更新（兼容端点） |

### 5.2 Session 代理接口（仍可用）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/orchestration/sessions` | 创建会话（代理） |
| GET | `/orchestration/sessions` | 会话列表（当前返回空数组） |
| GET | `/orchestration/sessions/:id` | 查询会话 |
| POST | `/orchestration/sessions/:id/messages` | 追加消息 |
| POST | `/orchestration/sessions/:id/messages/batch` | 批量追加消息 |
| POST | `/orchestration/sessions/:id/archive` | 归档会话 |
| POST | `/orchestration/sessions/:id/resume` | 恢复会话 |

## 6. 文档状态治理（plan / guide / technical）

### 6.1 当前有效文档

- 功能文档：`docs/feature/ORCHETRATION_TASK.md`、`docs/feature/ORCHETRATION_SCHEDULER.md`
- Guide：`docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD`、`docs/guide/ORCHESTRATION_TASK_TYPE_ROUTING_CHAIN.MD`
- Technical：`docs/technical/SCHEDULER_SERVICE_REFACTOR_TECHNICAL_DESIGN.md`
- Plan（仍在使用/推进）：
  - `docs/plan/ORCHESTRATION_DOMAIN_TYPE_SIMPLIFICATION_PLAN.MD`
  - `docs/plan/ORCHESTRATION_AGENT_FIRST_REQUIREMENT_MCP_PLAN.MD`
  - `docs/plan/ORCHESTRATION_OPENCODE_ROUTING_FOR_DEV_WORKFLOW_PLAN.md`
  - `docs/plan/ORCHESTRATION_DEV_WORKFLOW_REMAINING_ISSUES_PLAN.md`
  - `docs/plan/SCHEDULER_SERVICE_REFACTOR_PLAN.md`

### 6.2 已废弃文档（归档参考，不作为实现依据）

#### 已废弃 Plan

- `docs/plan/ORCHESTRATION_TASK_OUTPUT_VALIDATION_FIX_PLAN.md`
- `docs/plan/ORCHESTRATION_TASK_MANUAL_EDIT_PLAN.md`
- `docs/plan/ORCHESTRATION_UPDATE_PLAN_TOOL_PLAN.md`
- `docs/plan/ORCHESTRATION_SCHEDULER_MCP_PLAN.md`
- `docs/plan/ORCHESTRATION_SCHEDULER_MODULE_PLAN.md`
- `docs/plan/ORCHESTRATION_TASK_DEBUG_MCP_PLAN.md`
- `docs/plan/ORCHESTRATION_SERVICE_SPLIT_PLAN.md`
- `docs/plan/ORCHESTRATION_PLAN_LIST_DELETE_GUARD_PLAN.md`
- `docs/plan/ORCHESTRATION_PLANNING_QUALITY_OPTIMIZATION_PLAN.md`
- `docs/plan/ORCHESTRATION_PLANNER_JSON_CONFORMANCE_PLAN.md`
- `docs/plan/ORCHESTRATION_PAGE_OPTIMIZATION_PLAN.md`
- `docs/plan/ORCHESTRATION_PLANNER_AGENT_SELECTION_FIX_PLAN.md`
- `docs/plan/ORCHESTRATION_MCP_SKILL_PARAM_AUDIT_PLAN.md`
- `docs/plan/ORCHESTRATION_OPTIMIZATION_PLAN.md`
- `docs/plan/ORCHESTRATION_INCREMENTAL_PLANNING_REFACTOR_PLAN.md`
- `docs/plan/ORCHESTRATION_INCREMENTAL_PLANNING_FAILOVER_FIX_PLAN.md`
- `docs/plan/ORCHESTRATION_EXECUTOR_SELECTION_SKILL_ACTIVATION_PLAN.md`
- `docs/plan/ORCHESTRATION_DETAIL_REPLAN_PROMPT_PERSIST_PLAN.md`
- `docs/plan/ORCHESTRATION_DEBUG_RUN_GATEWAY_500_FIX_PLAN.md`
- `docs/plan/ORCHESTRATION_CREATE_PLAN_400_DIAGNOSTICS_PLAN.md`
- `docs/plan/ORCHESTRATION_ASYNC_STREAMING_PLAN_CREATION_PLAN.md`
- `docs/plan/ORCHESTRATION_ASYNC_AGENT_TASK_EXECUTION_PLAN.md`
- `docs/plan/MEETING_ORCHESTRATION_EXECUTION_MASTER_PLAN.md`
- `docs/plan/AGENT_ORCHESTRATION_SESSION_PLAN.md`
- `docs/plan/MEETING_ORCHESTRATION_MCP_PLAN.md`
- `docs/plan/MEETING_ORCHESTRATION_PENDING_INTENT_PLAN.md`
- `docs/plan/AGENT_ORCHESTRATION_AGENTSESSION_UNIFICATION_PLAN.md`
- `docs/plan/MEETING_ORCHESTRATION_FORCED_TOOLCALL_PLAN.md`
- `docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_E_SCHEMA_COLLECTION_GOVERNANCE.md`
- `docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_F_STABILITY_ARCH_HARDENING.md`
- `docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_REMEDIATION_PLAN.md`
- `docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_D_ORCHESTRATION_SCHEDULER_REFACTOR.md`
- `docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_A_SECURITY_AUTH_HOTFIX.md`
- `docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_B_REQUIREMENT_CLOSED_LOOP.md`
- `docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_C_AGENTS_REFACTOR_PHASE1.md`
- `docs/plan/ORCHESTRATION_SCHEDULER_PLAN_BINDING_OPTIMIZATION_PLAN.md`（已被 `SCHEDULER_SERVICE_REFACTOR_PLAN.md` 替代）

#### 已废弃 Guide

- `docs/guide/ORCHESTRATION_PLAN.MD`
- `docs/guide/EXECUTOR.MD`
- `docs/guide/PLANER&PROMPT.MD`

#### 已废弃 Technical

- `docs/technical/ORCHESTRATION_SCHEDULER_TECHNICAL_DESIGN.md`
- `docs/technical/ORCHESTRATION_INCREMENTAL_PLANNING_TECHNICAL_DESIGN.md`
- `docs/technical/MEETING_ORCHESTRATION_EXECUTION_TECHNICAL.md`
- `docs/technical/AGENT_ORCHESTRATION_ARCHITECTURE_DESIGN.md`
- `docs/technical/AGENT_ORCHESTRATION_SEQUENCE_DIAGRAMS.md`
- `docs/technical/ORCHESTRATION_TASK_MANUAL_EDIT.MD`

## 7. 关联功能文档

- 定时调度：`docs/feature/ORCHETRATION_SCHEDULER.md`
- Agent 运行时：`docs/feature/AGENT_RUNTIME.md`
- Agent 协作消息：`docs/feature/INNER_MESSAGE.md`

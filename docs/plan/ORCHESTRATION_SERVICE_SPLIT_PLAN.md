# [已弃用] ORCHESTRATION_SERVICE_SPLIT_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Orchestration Service 拆分计划

## 背景

`backend/src/modules/orchestration/orchestration.service.ts` 目前有 **4164 行**，承担了 Plan CRUD、Task CRUD、执行引擎、状态管理、SSE 事件流、上下文构建、tier 治理等多项职责，严重违反单一职责原则，维护和测试成本极高。

需要将其拆分为多个职责单一的子 service，原 `orchestration.service.ts` 瘦身为 Facade 层，仅做方法委派。

## 拆分目标

- 每个子 service 职责单一、边界清晰
- 拆分后不改变任何外部行为（Controller 层无需改动）
- `orchestration.service.ts` 保留为 Facade，注入所有子 service，将 Controller 的调用委派到对应子 service
- 清理已被独立 service 取代的遗留代码（legacy validation 方法）

## 拆分方案

### 子 Service 划分（7 个）

| # | 文件名 | 职责 | 核心公开方法 |
|---|--------|------|-------------|
| 1 | `plan-management.service.ts` | Plan CRUD & 生命周期 | `createPlanFromPrompt`, `listPlans`, `getPlanById`, `updatePlan`, `deletePlan`, `replanPlan`, `replanPlanAsync` |
| 2 | `task-management.service.ts` | Task 模板 CRUD & 编辑 | `addTaskToPlan`, `removeTaskFromPlan`, `updateTaskFull`, `reorderPlanTasks`, `batchUpdateTasks`, `duplicateTask`, `updateTaskDraft`, `listTasksByPlan` |
| 3 | `plan-execution.service.ts` | 执行引擎 & Run 管理 | `runPlan`, `runPlanAsync`, `executePlanRun`, `listPlanRuns`, `getLatestPlanRun`, `getRunById`, `listRunTasks` |
| 4 | `task-lifecycle.service.ts` | 任务运行时操作（重分配/完成/重试/调试） | `reassignTask`, `completeHumanTask`, `retryTask`, `debugTaskStep`, `executeStandaloneTask` |
| 5 | `plan-stats.service.ts` | 状态计算 & Session 同步 | `refreshPlanStats`, `setPlanStatus`, `setPlanSessionStatus`, `normalizePlanStatus`, `syncPlanSessionTasks`, `updatePlanSessionTask` |
| 6 | `plan-event-stream.service.ts` | SSE 事件流 | `streamPlanEvents`, `emitPlanStreamEvent`, `emitTaskLifecycleEvent` |
| 7 | `orchestration-context.service.ts` | 上下文构建 & 外部集成 | `buildTaskDescription`, `buildDependencyContext`, `buildRunDependencyContext`, `buildOrchestrationCollaborationContext`, `resolvePlanDomainContext`, `tryUpdateRequirementStatus` |

### 各子 Service 详细内容

#### 1. `plan-management.service.ts` — Plan CRUD & 生命周期

**公开方法：**
- `createPlanFromPrompt(createdBy, dto)` — 从 prompt 创建 plan，触发异步任务生成
- `listPlans()` — 列出所有 plan
- `getPlanById(planId)` — 获取 plan 详情（含 tasks、session、last run）
- `updatePlan(planId, dto)` — 更新 plan 基本信息（title, prompt, mode, planner agent, metadata）
- `deletePlan(planId)` — 删除 plan（阻止有 schedule 关联时删除）
- `replanPlan(planId, dto)` — 重新规划（删除旧 tasks，重新调用 planner 生成）
- `replanPlanAsync(planId, dto)` — replan 的非阻塞包装

**迁移的私有/辅助方法：**
- `generatePlanTasksAsync()` — 异步 plan 任务生成管线
- `assertPlanEditable()` — 校验 plan 可编辑状态
- `derivePlanTitle()` — 从 prompt 截取标题
- `detectAssignmentPolicy()` — 检测 prompt 是否请求锁定所有 task 给 planner agent

**依赖注入：**
- `OrchestrationPlan` model, `OrchestrationTask` model, `OrchestrationSchedule` model, `PlanSession` model
- `PlannerService`, `PlanningContextService`, `ExecutorSelectionService`, `TaskClassificationService`
- `PlanStatsService`（用于创建后刷新状态）
- `PlanEventStreamService`（用于发送 SSE 事件）

---

#### 2. `task-management.service.ts` — Task 模板 CRUD & 编辑

**公开方法：**
- `listTasksByPlan(planId)` — 列出 plan 下所有模板 task
- `addTaskToPlan(planId, dto)` — 手动新增 task（支持 insertAfterTaskId）
- `removeTaskFromPlan(taskId)` — 删除 task，清理依赖引用，重排序
- `updateTaskFull(taskId, dto)` — 全量更新（title, description, priority, assignment, dependencies, runtimeTaskType）
- `reorderPlanTasks(planId, dto)` — 通过 taskIds 数组重排序
- `batchUpdateTasks(planId, dto)` — 批量更新多个 task
- `duplicateTask(planId, sourceTaskId)` — 复制 task（加 "(copy)" 后缀）
- `updateTaskDraft(taskId, dto)` — 轻量更新 title/description

**迁移的私有/辅助方法：**
- `assertTaskIdsBelongToPlan()` — 校验 taskId 归属
- `assertNoDependencyCycle()` / `hasCyclicDependency()` — Kahn 算法环检测
- `normalizeAssignment()` — 标准化 assignment
- `normalizeDependencyTaskIds()` / `normalizeTaskIdList()` — 标准化依赖列表
- `resolveTaskStatusByAssignment()` — 根据 assignment 推导 task 状态
- `normalizeRuntimeTaskTypeOverride()` — 标准化 runtimeTaskType

**依赖注入：**
- `OrchestrationTask` model, `OrchestrationPlan` model
- `PlanStatsService`（修改后刷新状态）
- `PlanEventStreamService`（发送 task 变更事件）

---

#### 3. `plan-execution.service.ts` — 执行引擎 & Run 管理

**公开方法：**
- `runPlan(planId, dto)` — 同步执行 plan run
- `runPlanAsync(planId, dto)` — 非阻塞执行包装
- `executePlanRun(planId, triggerType, options)` — 核心执行引擎：创建 Run → 快照 tasks 为 RunTasks → 按顺序/并行执行 → 统计结果
- `listPlanRuns(planId, limit)` — 列出 plan 的 run 历史
- `getLatestPlanRun(planId)` — 获取最新 run
- `getRunById(runId)` — 获取指定 run
- `listRunTasks(runId)` — 列出 run 的 RunTask 快照

**迁移的私有/辅助方法：**
- `executeRunTasks()` — while 循环执行器，解析依赖、并行/顺序调度
- `executeTaskNode()` — 执行单个模板 task（agent 调用、校验、状态管理）
- `executeRunTaskNode()` — 在 run 上下文中执行单个 RunTask
- `waitForAsyncAgentTaskResult()` — SSE 优先、轮询兜底的异步等待
- `computeRunStats()` / `deriveRunStatus()` / `derivePlanStatus()` — 运行时统计
- `isPlanRunActive()` — 检查是否有 running 状态的 run
- `sleep()` — 异步延迟工具
- `tryParseJson()` — 健壮 JSON 解析器
- `getRetryFailureHint()` — 提取 runLogs 中的最后错误

**内存状态：**
- `runningPlans: Set<string>` — 追踪当前正在执行的 plan（防重入）

**依赖注入：**
- `OrchestrationPlan` model, `OrchestrationTask` model, `OrchestrationRun` model, `OrchestrationRunTask` model, `PlanSession` model
- `AgentClientService`（agent 任务执行、SSE、轮询）
- `TaskOutputValidationService`（agent 输出校验）
- `OrchestrationContextService`（构建 task description & 依赖上下文）
- `PlanStatsService`（刷新 plan 状态）
- `PlanEventStreamService`（发送执行事件）

---

#### 4. `task-lifecycle.service.ts` — 任务运行时操作

**公开方法：**
- `reassignTask(taskId, dto)` — 重分配 task（agent/employee/unassigned），包含 tier 治理检查
- `completeHumanTask(taskId, dto)` — 标记 employee 分配的 task 为已完成（兼容模板 task 和 RunTask）
- `retryTask(taskId)` — 重试失败 task（兼容 RunTask 和模板 task；模板 task 同时触发 plan run）
- `debugTaskStep(taskId, dto)` — 调试执行单个 task（可选 draft 更新后执行，含依赖检查）
- `executeStandaloneTask(taskId)` — 在 plan run 外单独执行一个 task

**迁移的私有/辅助方法：**
- `resolveAgentTierById()` / `resolveEmployeeTierById()` / `resolveAssignmentTargetTier()` — tier 解析
- `buildTierGuardException()` — 构造 tier 违规错误

**依赖注入：**
- `OrchestrationTask` model, `OrchestrationRunTask` model, `OrchestrationRun` model, `Agent` model, `Employee` model
- `PlanExecutionService`（retryTask 触发 plan run 时）
- `PlanStatsService`, `PlanEventStreamService`

---

#### 5. `plan-stats.service.ts` — 状态计算 & Session 同步

**公开方法：**
- `refreshPlanStats(planId)` — 重新计算 plan 的 task 统计并更新 plan 状态
- `setPlanStatus(planId, status)` — 直接设置 plan 状态
- `setPlanSessionStatus(planId, status)` — 设置 plan session 状态
- `normalizePlanStatus(planId)` — 根据当前 task 分布自动推导 plan 状态
- `syncPlanSessionTasks(planId)` — 全量重建 PlanSession 的 task 快照
- `updatePlanSessionTask(planId, taskId, patch)` — 单个 task 在 PlanSession 中的补丁更新

**依赖注入：**
- `OrchestrationPlan` model, `OrchestrationTask` model, `PlanSession` model

---

#### 6. `plan-event-stream.service.ts` — SSE 事件流

**公开方法：**
- `streamPlanEvents(planId)` — 返回 Observable，SSE 事件流（连接时发快照，后续推送实时更新）
- `emitPlanStreamEvent(planId, event)` — 向指定 plan 的所有订阅者推送事件
- `emitTaskLifecycleEvent(taskId, event)` — 通过 `AgentClientService` 发布 task 生命周期事件

**内存状态：**
- `planEventStreams: Map<string, Set<Subject<any>>>` — SSE 事件通道管理

**依赖注入：**
- `AgentClientService`（task lifecycle 事件发布）
- `OrchestrationPlan` model（快照数据）

---

#### 7. `orchestration-context.service.ts` — 上下文构建 & 外部集成

**公开方法：**
- `buildTaskDescription(task, options)` — 组装增强的 task prompt（依赖上下文、重试提示、输出契约）
- `buildDependencyContext(task)` — 收集上游 task 输出（模板 task）
- `buildRunDependencyContext(runTask)` — 收集上游 task 输出（RunTask）
- `buildOrchestrationCollaborationContext(plan, task)` — 协作元数据
- `resolvePlanDomainContext(plan)` — plan 领域上下文
- `tryUpdateRequirementStatus(planId, status)` — 最佳努力调用 EI 服务更新需求状态

**迁移的私有/辅助方法：**
- `inferDomainContext()` / `inferDomainType()` — 领域推断
- `resolveRequirementIdFromPlan()` / `resolveRequirementObjectIdFromPlan()` / `parseRequirementObjectId()` — 需求 ID 解析
- `buildResearchOutputContract()` — 研究类 task 输出契约构建

**依赖注入：**
- `OrchestrationTask` model, `OrchestrationRunTask` model, `OrchestrationPlan` model
- `axios`（EI 服务 HTTP 调用）

---

### Facade 层 — `orchestration.service.ts`（瘦身后）

拆分完成后，`orchestration.service.ts` 仅保留：
- 注入所有 7 个子 service
- 对外暴露与当前完全一致的公开方法签名
- 每个方法体内仅做一行委派调用，如：

```typescript
async createPlanFromPrompt(createdBy: string, dto: CreatePlanDto) {
  return this.planManagementService.createPlanFromPrompt(createdBy, dto);
}
```

Controller 层无需任何改动。

---

### 遗留代码清理

以下代码在拆分过程中**直接删除**，不迁移到任何子 service：

| 行范围 | 方法 | 原因 |
|--------|------|------|
| ~3780-4088 | `validateResearchOutput`, `validateResearchJson`, `validateResearchTable`, `validateResearchNumberedList`, `validateKindSpecificJson`, `validateKindSpecificTable`, `validateKindSpecificList`, `detectResearchTaskKind`, `buildResearchOutputContract`, `validateResearchExecutionProof`, `isReviewTask`, `validateReviewOutput`, `extractEmailSendProof` | 已被 `TaskClassificationService` 和 `TaskOutputValidationService` 取代 |

> 注：`buildResearchOutputContract` 如果仍被 `buildTaskDescription` 引用，需确认是否已在 `TaskOutputValidationService` 中有对应实现，若有则直接替换调用；若无则迁移到 `orchestration-context.service.ts`。

---

## 拆分后目录结构

```
backend/src/modules/orchestration/
├── dto/
│   └── index.ts
├── scheduler/
│   ├── dto/
│   │   └── index.ts
│   ├── scheduler.controller.ts
│   ├── scheduler.module.ts
│   └── scheduler.service.ts
├── services/
│   ├── plan-management.service.ts        ← 新增：Plan CRUD & 生命周期
│   ├── task-management.service.ts        ← 新增：Task 模板 CRUD & 编辑
│   ├── plan-execution.service.ts         ← 新增：执行引擎 & Run 管理
│   ├── task-lifecycle.service.ts         ← 新增：任务运行时操作
│   ├── plan-stats.service.ts             ← 新增：状态计算 & Session 同步
│   ├── plan-event-stream.service.ts      ← 新增：SSE 事件流
│   ├── orchestration-context.service.ts  ← 新增：上下文构建 & 外部集成
│   ├── executor-selection.service.ts     （已有，不动）
│   ├── planning-context.service.ts       （已有，不动）
│   ├── scene-optimization.service.ts     （已有，不动）
│   ├── task-classification.service.ts    （已有，不动）
│   └── task-output-validation.service.ts （已有，不动）
├── orchestration.controller.ts           （不动）
├── orchestration.module.ts               （更新：注册新 service）
├── orchestration.service.ts              ← 瘦身为 Facade
├── planner.service.ts                    （不动）
└── session-manager.service.ts            （不动）
```

---

## 执行步骤

### Step 1: 创建基础设施
1. 在 `services/` 下创建 7 个新 service 文件（空壳 + `@Injectable()` 装饰器）
2. 在 `orchestration.module.ts` 中注册所有新 service

### Step 2: 迁移 plan-stats.service.ts（最少依赖，先行）
- 迁移状态计算和 session 同步方法
- 仅依赖 Model 注入，无跨 service 依赖

### Step 3: 迁移 plan-event-stream.service.ts
- 迁移 SSE 事件流管理
- 迁移 `planEventStreams` Map

### Step 4: 迁移 orchestration-context.service.ts
- 迁移上下文构建和外部集成方法

### Step 5: 迁移 task-management.service.ts
- 迁移 task CRUD 和编辑方法
- 依赖 `PlanStatsService` 和 `PlanEventStreamService`

### Step 6: 迁移 plan-management.service.ts
- 迁移 plan CRUD 和生命周期方法
- 依赖 `PlannerService`、`PlanStatsService`、`PlanEventStreamService`

### Step 7: 迁移 plan-execution.service.ts
- 迁移执行引擎（最复杂的部分）
- 依赖 `AgentClientService`、`OrchestrationContextService`、`PlanStatsService`、`PlanEventStreamService`

### Step 8: 迁移 task-lifecycle.service.ts
- 迁移任务运行时操作
- 依赖 `PlanExecutionService`（retryTask 触发 plan run）

### Step 9: 瘦身 orchestration.service.ts 为 Facade
- 注入所有 7 个子 service
- 将所有公开方法改为一行委派调用
- 删除所有已迁移的私有方法

### Step 10: 清理遗留代码
- 删除 legacy validation 方法（~3780-4088 行）
- 确认无残留引用

### Step 11: 验证
- 运行 `npm run lint` 确认无类型/lint 错误
- 运行 `npm run build` 确认编译通过
- 功能回归测试

---

## 风险与注意事项

1. **循环依赖风险**: `task-lifecycle.service.ts` 依赖 `plan-execution.service.ts`（retryTask 触发 run），而 `plan-execution.service.ts` 的执行过程中可能需要 task 状态变更。需要用 NestJS `forwardRef()` 或通过事件机制解耦
2. **共享内存状态**: `runningPlans` 放在 `plan-execution.service.ts`，`planEventStreams` 放在 `plan-event-stream.service.ts`，确保各方通过 service 方法访问，不暴露内部状态
3. **Model 注入重复**: 多个子 service 需要注入相同的 Model（如 `OrchestrationPlan`），这在 NestJS 中是正常的，不会产生问题
4. **Facade 保持向后兼容**: Controller 和外部调用方（如 MCP tool、scheduler 等）只依赖 `OrchestrationService`，拆分不影响它们
5. **迁移顺序很重要**: 按依赖关系从底层到上层迁移，避免中间状态编译失败

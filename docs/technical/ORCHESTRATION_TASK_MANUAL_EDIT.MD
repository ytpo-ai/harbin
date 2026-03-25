# [已弃用] ORCHESTRATION_TASK_MANUAL_EDIT

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# 编排任务人工编辑 — 技术梳理文档

> 更新时间：2026-03-22  
> 关联 plan：`docs/plan/ORCHESTRATION_TASK_MANUAL_EDIT_PLAN.md`  
> 关联 feature：`docs/feature/ORCHETRATION_TASK.md`  
> 存放目录：`docs/technical/`（技术实现梳理文档统一存放于此）

---

## 一、现有任务 CRUD 能力盘点

### 1.1 后端已有端点（task 操作相关）

| 端点 | Controller 方法 | Service 方法 | 可操作字段 |
|---|---|---|---|
| `GET /plans/:id/tasks` | `listTasks` | `listTasksByPlan` | — (只读) |
| `POST /tasks/:id/reassign` | `reassignTask` | `reassignTask` | `assignment.{executorType, executorId, reason}` + `status` |
| `POST /tasks/:id/complete-human` | `completeHumanTask` | `completeHumanTask` | `status → completed` + `result.{summary, output}` |
| `POST /tasks/:id/retry` | `retryTask` | `retryTask` | `status → pending` + 清除 result |
| `POST /tasks/:id/draft` | `updateTaskDraft` | `updateTaskDraft` | 仅 `title` + `description` |
| `POST /tasks/:id/debug-run` | `debugTaskStep` | `debugTaskStep` | 先 draft 更新 title/desc，再触发 agent 执行 |

### 1.2 明确不存在的能力

| 操作 | 状态 | 说明 |
|---|---|---|
| 手动添加单个任务 | **不存在** | 任务仅在 `generatePlanTasksAsync()` 和 `replanPlan()` 中批量创建 |
| 删除单个任务 | **不存在** | 仅 `deletePlan()` 和 `replanPlan()` 做 `deleteMany({ planId })` |
| 调整 order | **不存在** | order 在创建时按数组索引赋值 (`order: i`)，之后不可变 |
| 修改 dependencyTaskIds | **不存在** | 依赖仅在创建时写入，之后不可变 |
| 修改 priority | **不存在** | 无任何入口 |
| 完整更新任务字段 | **不存在** | `updateTaskDraft` 只能改 title/description |

---

## 二、关键代码定位

### 2.1 Schema

- **OrchestrationTask**: `backend/src/shared/schemas/orchestration-task.schema.ts`
  - 已有字段：`title`, `description`, `priority`, `status`, `order`, `dependencyTaskIds`, `assignment`, `result`, `runLogs`, `planId`, `mode`, `scheduleId`, `requirementId`, `sessionId`
  - **数据模型已完备**，新增 CRUD 能力不需要改 Schema

- **OrchestrationPlan**: `backend/src/shared/schemas/orchestration-plan.schema.ts`
  - 关键字段：`taskIds: string[]`, `stats: { totalTasks, completedTasks, failedTasks, waitingHumanTasks }`
  - 增删任务时必须同步维护 `taskIds` 和 `stats`

- **PlanSession**: `backend/src/shared/schemas/orchestration-plan-session.schema.ts`
  - `tasks: PlanTaskSnapshot[]`（内嵌任务快照数组）
  - 增删改任务时需同步更新快照

### 2.2 DTO

- 文件：`backend/src/modules/orchestration/dto/index.ts`（215 行）
- `UpdateTaskDraftDto`：仅含 `title?` (max 200) + `description?` (max 4000)
- `DebugTaskStepDto extends UpdateTaskDraftDto`：额外 `resetResult?: boolean`
- `ReassignTaskDto`：`executorType` + `executorId?` + `reason?` + `sourceAgentId?`
- **新增 DTO 应追加到此文件**

### 2.3 Controller

- 文件：`backend/src/modules/orchestration/orchestration.controller.ts`
- 新端点需追加到此 Controller（保持 `@Controller('orchestration')` 路由前缀）

### 2.4 Service 核心方法

- 文件：`backend/src/modules/orchestration/orchestration.service.ts`（2736 行）

#### 任务创建逻辑位置

任务批量创建发生在两个位置：

1. **`generatePlanTasksAsync()`**（约第 250-350 行）  
   - Plan 创建流程中由 Planner 推理后调用
   - 逐条创建 task → `this.orchestrationTaskModel.create({...})`
   - 设置 `order: i`、处理 `dependencyTaskIds` 索引→ObjectId 映射
   - 更新 `plan.taskIds`、`plan.stats`
   - 同步 PlanSession

2. **`replanPlan()`**（约第 440-600 行）  
   - 先 `deleteMany({ planId })` 清空旧任务
   - 再走同样的批量创建流程

#### 关键 helper 方法

| 方法 | 作用 | 位置 |
|---|---|---|
| `refreshPlanStats(planId)` | 重算 plan 的 stats 字段 | 约第 780-810 行 |
| `setPlanStatus(planId, status)` | 更新 plan 状态 + 推 SSE | 约第 815-830 行 |
| `updatePlanSessionTask(planId, taskId, update)` | 更新 PlanSession 中单个 task 的快照 | 约第 2300-2350 行 |
| `requirePlanId(task)` | 从 task 中提取 planId（防 null） | 工具方法 |

#### `updateTaskDraft()` 实现（约第 1222-1266 行）

```typescript
async updateTaskDraft(taskId: string, dto: UpdateTaskDraftDto) {
  const task = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
  if (!task) throw new NotFoundException('Task not found');
  if (task.status === 'in_progress') throw new BadRequestException('Task is running');

  const title = dto.title?.trim();
  const description = dto.description?.trim();

  const updated = await this.orchestrationTaskModel.findOneAndUpdate(
    { _id: taskId },
    {
      $set: {
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
      },
      $push: { runLogs: { timestamp: new Date(), level: 'info', message: 'Task draft updated' } },
    },
    { new: true },
  ).exec();

  // 同步 PlanSession
  if (task.mode === 'plan') {
    await this.updatePlanSessionTask(this.requirePlanId(task), taskId, { input: updated.description });
  }
  return updated;
}
```

**新的 `updateTaskFull()` 应以此为基础扩展**，增加 priority / dependencyTaskIds / assignment 字段的处理。

### 2.5 SSE 事件推送

- 推送方法：`this.planEventEmitter.emit(planId, event)`
- 已有事件类型：`plan.task.generated`, `plan.completed`, `plan.failed`, `plan.status.changed`
- **需新增**：`plan.task.added`, `plan.task.removed`, `plan.task.updated`, `plan.tasks.reordered`, `plan.tasks.batch-updated`

### 2.6 前端 Service

- 文件：`frontend/src/services/orchestrationService.ts`
- 已有方法：`updateTaskDraft(taskId, data)`, `reassignTask(taskId, data)` 等
- **需新增**：`addTaskToPlan`, `deleteTask`, `updateTaskFull`, `reorderTasks`, `batchUpdateTasks`, `duplicateTask`

### 2.7 前端页面

- **PlanDetail.tsx** (`frontend/src/pages/PlanDetail.tsx`, 1036 行)：计划详情独立页面，任务列表展示和操作的主要入口。改造集中在此文件。
- **Orchestration.tsx** (`frontend/src/pages/Orchestration.tsx`, 1095 行)：计划列表页 + 详情抽屉。抽屉内的任务区域也需同步改造，但优先级低于 PlanDetail。

---

## 三、依赖关系处理要点

### 3.1 当前依赖机制

- 创建时：Planner 返回的 `dependencies` 是前置任务的**数组索引**（0-based），在 `generatePlanTasksAsync()` 中映射为 ObjectId：
  ```typescript
  // 约第 311-319 行
  if (draft.dependencies?.length) {
    const depIds = draft.dependencies
      .filter(idx => idx < taskDocs.length)
      .map(idx => taskDocs[idx]._id.toString());
    await this.orchestrationTaskModel.updateOne(
      { _id: newTask._id },
      { $set: { dependencyTaskIds: depIds } }
    );
  }
  ```

- 执行时：`runPlan()` 的 while 循环中，通过检查 `task.dependencyTaskIds` 中所有任务是否已 completed 来判断是否可执行。

### 3.2 删除任务时的依赖处理

当删除 task A 时，需要扫描同 plan 下所有任务，从它们的 `dependencyTaskIds` 中移除 A 的引用：

```typescript
await this.orchestrationTaskModel.updateMany(
  { planId, dependencyTaskIds: taskId },
  { $pull: { dependencyTaskIds: taskId } }
);
```

### 3.3 循环依赖检测

修改 `dependencyTaskIds` 时需检测有向图中是否存在环。算法（Kahn 拓扑排序）：

```
输入：同一 plan 下所有 task 的 { _id, dependencyTaskIds } 列表
1. 构建邻接表（dependency → dependents）和入度表
2. 入度为 0 的节点入队
3. BFS：出队节点计数 +1，其下游入度 -1，归零则入队
4. 若计数 !== 节点总数 → 存在循环依赖
```

需要注意：检测时应使用**更新后的依赖关系**（即先在内存中应用修改，再检测），而非先写入 DB。

---

## 四、Plan 状态机与编辑窗口

```
draft ──→ drafting ──→ planned ──→ running ──→ completed
  │                       │           │            │
  │                       ▼           ▼            │
  │                    failed ←── paused           │
  │                       │                        │
  └───────────────────────┴────────────────────────┘
                     (deletable)

可编辑状态：draft, planned, failed
部分可编辑：paused（仅未开始的任务）
不可编辑：drafting, running, completed
```

Service 层校验逻辑：

```typescript
const EDITABLE_PLAN_STATUSES = ['draft', 'planned', 'failed'];
const PARTIALLY_EDITABLE_PLAN_STATUSES = ['paused'];

function assertPlanEditable(plan: OrchestrationPlan) {
  if (!EDITABLE_PLAN_STATUSES.includes(plan.status)) {
    if (PARTIALLY_EDITABLE_PLAN_STATUSES.includes(plan.status)) {
      return 'partial'; // 调用方需额外检查 task 级别状态
    }
    throw new BadRequestException(`Plan in "${plan.status}" status cannot be edited`);
  }
  return 'full';
}
```

---

## 五、前端拖拽排序技术选型

推荐 `@dnd-kit/sortable`（项目前端为 React + Tailwind）：

- 轻量、性能好、React 原生 hooks API
- 支持键盘可访问性
- 支持自定义拖拽手柄、拖拽预览
- 与虚拟化列表兼容（任务数量大时可扩展）

核心组件使用：

```tsx
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';

// 拖拽结束回调
function handleDragEnd(event) {
  const { active, over } = event;
  if (active.id !== over.id) {
    const newOrder = arrayMove(taskIds, oldIndex, newIndex);
    reorderTasksMutation.mutate({ planId, taskIds: newOrder });
  }
}
```

---

## 六、与现有逻辑的兼容关系

| 现有逻辑 | 影响 | 处理方式 |
|---|---|---|
| `updateTaskDraft` 端点 | 被新 `PATCH /tasks/:taskId` 超集覆盖 | 标记 deprecated，内部转发新逻辑 |
| `reassignTask` 端点 | assignment 字段可通过新 PATCH 直接改 | 保留旧端点兼容，不删除 |
| `replanPlan()` | 会 deleteMany 清空所有任务 | 前端 replan 前增加二次确认提示 |
| `debugTaskStep` | 内部先调 `updateTaskDraft` | 改为调用新 `updateTaskFull` 的子集 |
| `runPlan()` 的依赖检查 | 依赖 `task.dependencyTaskIds` 已完成判断 | 人工编辑后的依赖关系完全兼容此逻辑 |
| MCP OrchestrationToolHandler | Agent 通过 MCP 调用编排 | 暂不扩展人工编辑能力到 MCP |
| PlanSession 快照 | 需同步维护 | 所有新操作统一调用 helper 同步 |
| Memo（memo-task-todo） | 监听 task.completed 事件 | 不受影响，人工编辑不触发完成事件 |

---

## 七、Plan / Schedule / Run 模型校正 — 技术改造详细分析

### 7.1 当前执行链路问题定位

#### A. Schedule 触发每次新建 task（膨胀根源）

- 入口：`SchedulerService.dispatchSchedule()`
- `executeSingleAttempt()` 每次 attempt 都新建一条 task：
  - `mode: 'schedule'`, `scheduleId`, `planId: schedule.planId`
  - 代码位置：`scheduler.service.ts:622-626`
- 执行通过：`executeScheduleTaskByInput()` → `orchestrationService.executeStandaloneTask(taskId)`
  - 代码位置：`scheduler.service.ts:976`

#### B. runPlan() 直接修改模板任务（语义污染）

- `runPlan()` 中 `executeTaskNode()` 直接修改 task 的 status/result/sessionId：
  - 代码位置：`orchestration.service.ts:1211-1274`
- 模板任务被执行覆盖后，再次 run 需要先 reset（目前没有 reset 逻辑）

#### C. 查询和统计不区分 mode

- `listTasksByPlan(planId)`：`find({ planId })` 不加 mode 过滤
  - 代码位置：`orchestration.service.ts:874-878`
- `refreshPlanStats(planId)`：同上
  - 代码位置：`orchestration.service.ts:2769-2776`

### 7.2 需要改造的代码清单

#### 新增文件

| 文件 | 用途 |
|---|---|
| `backend/src/shared/schemas/orchestration-run.schema.ts` | Run Schema |
| `backend/src/shared/schemas/orchestration-run-task.schema.ts` | RunTask Schema |
| `frontend/src/services/runService.ts`（或扩展 orchestrationService） | Run API 调用 |

#### 后端需修改的文件

| 文件 | 改动要点 |
|---|---|
| `orchestration.service.ts` | 核心：新增 `executePlanRun()`；改造 `runPlan()` / `runPlanAsync()` 调用入口；`listTasksByPlan` 移除 mode 过滤（因为 task 表不再有 schedule 记录）；`refreshPlanStats` 改为只统计模板数量；`executeStandaloneTask` 移除 schedule 分支；`getPlanById` 聚合 lastRun |
| `orchestration.controller.ts` | 新增 Run API 端点（runs 列表/详情/latest/tasks） |
| `orchestration.module.ts` | 注册 Run/RunTask Model |
| `dto/index.ts` | 新增 Run 相关 Query DTO |
| `scheduler/scheduler.service.ts` | 核心：`executeSingleAttempt()` 改为调用 `executePlanRun(schedule)`；移除直接创建 task 的逻辑；`getScheduleHistory()` 改查 runs；移除 `executeScheduleTaskByInput()` |
| `orchestration-task.schema.ts` | 移除 `mode` 和 `scheduleId` 字段及相关索引 |
| `orchestration-plan.schema.ts` | 新增 `lastRunId?: string` |

#### 前端需修改的文件

| 文件 | 改动要点 |
|---|---|
| `services/orchestrationService.ts` | 新增 Run API 方法；类型定义新增 Run/RunTask；移除 `OrchestrationTask.mode`/`scheduleId` 字段 |
| `pages/PlanDetail.tsx` | 核心：拆为"任务设置"和"执行历史"两个 tab；执行历史展示 runs 列表 + last run 卡片 + run 详情抽屉 |
| `pages/Orchestration.tsx` | 计划列表/抽屉中 task 展示适配（移除 mode 区分） |
| `pages/Scheduler.tsx` | 执行历史改查 runs |

### 7.3 `executePlanRun()` 核心逻辑设计

这是整个改造的核心方法，替代当前 `runPlan()` 的执行逻辑：

```typescript
async executePlanRun(
  planId: string,
  triggerType: 'manual' | 'schedule' | 'autorun',
  options?: {
    scheduleId?: string;
    continueOnFailure?: boolean;
  },
): Promise<OrchestrationRun> {
  const plan = await this.getPlanById(planId);
  const templateTasks = await this.listTasksByPlan(planId);

  // 1. 创建 Run
  const run = await new this.runModel({
    planId,
    triggerType,
    scheduleId: options?.scheduleId,
    status: 'running',
    startedAt: new Date(),
    stats: { totalTasks: templateTasks.length, completedTasks: 0, failedTasks: 0, waitingHumanTasks: 0 },
  }).save();

  const runId = run._id.toString();

  // 2. 基于模板任务批量创建 RunTask（快照）
  const runTasks = await Promise.all(
    templateTasks.map((tpl) =>
      new this.runTaskModel({
        runId,
        planId,
        sourceTaskId: this.getEntityId(tpl as any),
        order: tpl.order,
        title: tpl.title,
        description: tpl.description,
        priority: tpl.priority,
        status: 'pending',
        assignment: tpl.assignment,
        dependencyTaskIds: tpl.dependencyTaskIds,
      }).save(),
    ),
  );

  // 3. 构建 sourceTaskId → runTaskId 映射（依赖解析用）
  const sourceToRunTask = new Map(
    runTasks.map((rt) => [rt.sourceTaskId, rt]),
  );

  // 4. 按 strategy.mode 执行（复用现有 sequential/parallel/hybrid 逻辑）
  //    但所有状态流转写 run_task，不写模板 task
  //    scopeId 改为 runId
  try {
    await this.executeRunTasks(run, runTasks, plan.strategy.mode, options?.continueOnFailure);
  } catch (error) {
    // 异常兜底
  }

  // 5. 汇总 + 回写
  const finalRunTasks = await this.runTaskModel.find({ runId }).exec();
  const completedAt = new Date();
  const stats = this.computeRunStats(finalRunTasks);
  const status = this.deriveRunStatus(finalRunTasks);

  await this.runModel.updateOne({ _id: runId }, {
    $set: {
      status,
      completedAt,
      durationMs: completedAt.getTime() - run.startedAt.getTime(),
      stats,
    },
  }).exec();

  // 6. 更新 plan.lastRunId
  await this.orchestrationPlanModel.updateOne(
    { _id: planId },
    { $set: { lastRunId: runId } },
  ).exec();

  // 7. 若 schedule 触发，回写 schedule.lastRun
  if (options?.scheduleId) {
    // 回写 schedule.lastRun 摘要
  }

  return this.runModel.findOne({ _id: runId }).exec();
}
```

### 7.4 `executeRunTasks()` 与现有 `executeTaskNode()` 的关系

现有 `executeTaskNode(planId, task)` 内部做了：
- 任务分类（external/research/review）
- 构建依赖上下文（上游任务输出）
- 设置 task.status = in_progress
- 创建 async agent task → 等待结果
- 输出验证 → 设置 task.status = completed/failed
- 更新 PlanSession

改造策略：
- **抽取** `executeTaskNode` 的核心逻辑为 `executeRunTaskNode(runId, runTask)`
- 状态流转写 `orchestration_run_tasks` 而非 `orchestration_tasks`
- 依赖上下文从同 run 的已完成 run_tasks 中获取
- Session scopeId 从 `plan-{planId}-{agentId}` 改为 `run-{runId}-{agentId}`
- SSE 事件从 plan 维度改为 run 维度

### 7.5 Scheduler 改造详细

当前 `SchedulerService.executeSingleAttempt()`（`scheduler.service.ts:596-676`）：

```
1. new this.taskModel({ mode: 'schedule', scheduleId, planId, ... }).save()
2. this.executeScheduleTaskByInput(taskId, schedule, effectiveInput)
   ├─ memo command 分支
   ├─ tool 调用分支
   └─ default: this.orchestrationService.executeStandaloneTask(taskId)
```

改造后：

```
1. 判断 schedule 是否关联 plan（schedule.planId 存在）
   ├─ 有 plan：调用 orchestrationService.executePlanRun(planId, 'schedule', { scheduleId })
   └─ 无 plan（独立 schedule，如 memo/tool 类）：
       保留独立 task 创建逻辑（但不写 planId，不污染 plan 视图）
       或创建一个仅含单任务的 run
2. 移除 executeScheduleTaskByInput() 中对 executeStandaloneTask 的调用
3. getScheduleHistory() 改为查 orchestration_runs({ scheduleId })
```

注意：部分 schedule 是"无 plan"的独立调度（如 memo flush、tool 调用），这些可以保持简单的独立 task 方式，但不再写 planId。

### 7.6 数据清理脚本

上线时执行（一次性）：

```javascript
// 1. 删除所有 mode='schedule' 的历史 task
db.orchestration_tasks.deleteMany({ mode: 'schedule' });

// 2. 移除 task 文档中的 mode 和 scheduleId 字段（全量）
db.orchestration_tasks.updateMany({}, { $unset: { mode: 1, scheduleId: 1 } });

// 3. 删除失效的索引
db.orchestration_tasks.dropIndex('mode_1_scheduleId_1_createdAt_-1');

// 4. 创建新集合索引
db.orchestration_runs.createIndex({ planId: 1, startedAt: -1 });
db.orchestration_runs.createIndex({ scheduleId: 1, startedAt: -1 });
db.orchestration_runs.createIndex({ status: 1 });
db.orchestration_run_tasks.createIndex({ runId: 1, order: 1 });
db.orchestration_run_tasks.createIndex({ planId: 1, runId: 1 });
db.orchestration_run_tasks.createIndex({ sourceTaskId: 1 });
```

### 7.7 SSE 事件体系调整

| 旧事件 | 新事件 | 说明 |
|---|---|---|
| `plan.status.changed` (running) | `run.started` | run 开始 |
| — | `run.task.started` | run 内某任务开始 |
| — | `run.task.completed` | run 内某任务完成 |
| — | `run.task.failed` | run 内某任务失败 |
| `plan.completed` | `run.completed` | 整个 run 完成 |
| `plan.failed` | `run.failed` | 整个 run 失败 |
| `plan.task.generated` | 保留 | AI 生成模板任务时仍推送 |
| `plan.task.added/removed/updated` | 保留 | 模板编辑时推送 |

前端 PlanDetail 的"执行历史"tab 订阅 `run.*` 事件；"任务设置"tab 订阅 `plan.*` 事件。

### 7.8 retry / complete-human 的适配

- `POST /tasks/:id/retry`：改为接受 runTaskId，在 run_tasks 中将对应记录状态重置为 pending 并重新执行
- `POST /tasks/:id/complete-human`：改为接受 runTaskId，在 run_tasks 中标记完成
- 前端在"执行历史 → run 详情"中触发这些操作，而非在"任务设置"中

### 7.9 影响评估矩阵

| 模块 | 影响程度 | 说明 |
|---|---|---|
| `orchestration.service.ts` | **高** | 新增 executePlanRun，改造 runPlan/runPlanAsync 入口，调整统计/查询 |
| `scheduler.service.ts` | **高** | executeSingleAttempt 重写，getScheduleHistory 改查 runs |
| `orchestration.controller.ts` | **中** | 新增 4 个 run 端点 |
| `orchestration-task.schema.ts` | **低** | 移除 mode/scheduleId 字段 |
| `orchestration-plan.schema.ts` | **低** | 新增 lastRunId |
| `PlanDetail.tsx` | **高** | 双 tab 改造 + run 详情 |
| `Scheduler.tsx` | **中** | 历史展示切到 runs |
| `Orchestration.tsx` | **低** | 计划列表适配 |
| MCP OrchestrationToolHandler | **低** | run 维度暂不暴露给 MCP |
| Memo (task-todo/task-history) | **低** | 事件监听可能需从 task.completed 适配到 run_task.completed |
| PlanSession | **中** | 执行态快照可能需要迁移到 run 维度，或仅在模板编辑时维护 |

### 7.10 当前实现状态（2026-03-22）

已完成：

- `frontend/src/services/orchestrationService.ts`：Run API 类型与方法已落地（`OrchestrationRun`、`OrchestrationRunTask`、`getPlanRuns/getPlanLatestRun/getRunById/getRunTasks`）。
- `frontend/src/pages/Scheduler.tsx` + `frontend/src/services/schedulerService.ts`：历史查询与类型已切换到 run 摘要结构（`summary/error/stats/triggerType`）。
- `frontend/src/pages/PlanDetail.tsx`：完成双 Tab 信息架构改造。
  - Tab1「任务设置」保留模板任务编辑能力（增删改重排、批量保存、调试抽屉）。
  - Tab2「执行历史」新增 last run 卡片、run 列表（trigger/status 过滤）与 run 明细抽屉（run 摘要 + run_tasks 列表）。
- `frontend/src/pages/Orchestration.tsx`：计划详情抽屉补齐 run 视图，与 PlanDetail 对齐。
  - 新增抽屉内「任务设置 / 执行历史」Tab 切换。
  - 执行历史支持 last run 卡片、run 列表筛选和 run 详情抽屉（含 run_tasks）。

仍待完善：

- run 维度 SSE（`run.started/run.task.*/run.completed/run.failed`）在前端尚未完整接入，当前历史页以 Query 轮询兜底。

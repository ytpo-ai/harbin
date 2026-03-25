# [已弃用] ORCHESTRATION_TASK_MANUAL_EDIT_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# 编排任务人工编辑能力建设计划

> 状态：执行中（已完成后端端点、前端 service 扩展、PlanDetail 双 Tab + Run 明细抽屉、Orchestration 抽屉双 Tab + Run 历史视图）  
> 创建时间：2026-03-22  
> 关联文档：`docs/feature/ORCHETRATION_TASK.md`、`docs/guide/ORCHESTRATION_PLAN.MD`、`docs/technical/ORCHESTRATION_TASK_MANUAL_EDIT.MD`

---

## 一、背景与问题

当前任务编排系统中，任务列表**完全依赖 AI Planner 推理生成**。Planner 质量尚不稳定，经常出现任务拆解粒度不合理、描述空泛、执行者分配不当、依赖关系缺失等问题。

用户对生成后任务列表的干预能力极其有限：

| 操作 | 现状 |
|---|---|
| 编辑标题/描述 | 仅 `updateTaskDraft`（title + description） |
| 重新分配执行者 | 仅 `reassignTask`（切换 agent/employee） |
| **新增任务** | 不存在 — 只能 replan 全部重建 |
| **删除任务** | 不存在 — 只能 replan 全部重建 |
| **调整顺序** | 不存在 — order 创建后不可变 |
| **修改依赖关系** | 不存在 — dependencyTaskIds 创建后不可变 |
| **修改优先级** | 不存在 |

唯一的"修正手段"是 **replan（重新编排）**，但会清空所有旧任务后重新 AI 生成，用户的手动微调全部丢失，且新结果可能仍不满意。

**目标**：作为过渡方案，赋予人类用户在前端对 AI 生成的任务列表进行充分调整的能力，使编排结果可控、可修正。

---

## 二、设计原则

1. **最小侵入** — 在现有 Controller/Service 上扩展端点，不改动已有方法签名和行为
2. **状态安全** — 仅允许在 `planned`/`draft`/`failed` 状态的 Plan 下编辑任务；`running`/`drafting` 状态禁止编辑
3. **数据一致性** — 每次增删改后同步 `plan.taskIds`、`plan.stats`、`PlanSession.tasks`
4. **前端操作直觉化** — 拖拽排序、内联编辑、可视化依赖关系选择

---

## 三、后端 API 扩展

### 3.1 新增端点（6 个）

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | `POST` | `/orchestration/plans/:planId/tasks` | 手动添加任务（可指定插入位置） |
| 2 | `DELETE` | `/orchestration/tasks/:taskId` | 删除单个任务（级联清理依赖引用） |
| 3 | `PATCH` | `/orchestration/tasks/:taskId` | 完整更新任务字段（统一编辑入口） |
| 4 | `PUT` | `/orchestration/plans/:planId/tasks/reorder` | 批量重排序（接收有序 taskId 数组） |
| 5 | `PUT` | `/orchestration/plans/:planId/tasks/batch-update` | 批量更新（一次提交多个任务修改） |
| 6 | `POST` | `/orchestration/plans/:planId/tasks/duplicate/:taskId` | 复制任务（基于已有任务快速克隆） |

### 3.2 增强现有端点

- `POST /tasks/:id/draft` 标记为 **deprecated**，功能合并到 `PATCH /tasks/:taskId`
- 旧端点保留兼容，内部转发到新逻辑

### 3.3 新增 DTO

```typescript
// 手动添加任务
class AddTaskToPlanDto {
  @IsString() @MaxLength(200)
  title: string;

  @IsString() @MaxLength(4000)
  description: string;

  @IsOptional() @IsEnum(['low','medium','high','urgent'])
  priority?: 'low' | 'medium' | 'high' | 'urgent'; // 默认 medium

  @IsOptional() @IsString()
  insertAfterTaskId?: string; // 插入到某任务之后；不传则追加到末尾

  @IsOptional() @IsArray() @IsString({ each: true })
  dependencyTaskIds?: string[];

  @IsOptional() @ValidateNested()
  assignment?: AssignmentDto;
}

// 完整更新任务（PATCH /tasks/:taskId 的超集）
class UpdateTaskFullDto {
  @IsOptional() @IsString() @MaxLength(200)
  title?: string;

  @IsOptional() @IsString() @MaxLength(4000)
  description?: string;

  @IsOptional() @IsEnum(['low','medium','high','urgent'])
  priority?: 'low' | 'medium' | 'high' | 'urgent';

  @IsOptional() @IsArray() @IsString({ each: true })
  dependencyTaskIds?: string[]; // 完整覆盖依赖列表

  @IsOptional() @ValidateNested()
  assignment?: AssignmentDto;
}

// 共用的 assignment 子结构
class AssignmentDto {
  @IsEnum(['agent','employee','unassigned'])
  executorType: 'agent' | 'employee' | 'unassigned';

  @IsOptional() @IsString()
  executorId?: string;

  @IsOptional() @IsString()
  reason?: string;
}

// 批量重排序
class ReorderTasksDto {
  @IsArray() @IsString({ each: true })
  taskIds: string[]; // 有序 taskId 数组，索引即新 order
}

// 批量更新
class BatchUpdateTasksDto {
  @IsArray() @ValidateNested({ each: true })
  updates: BatchUpdateTaskItemDto[];
}

class BatchUpdateTaskItemDto {
  @IsString()
  taskId: string;

  @IsOptional() @IsString() @MaxLength(200)
  title?: string;

  @IsOptional() @IsString() @MaxLength(4000)
  description?: string;

  @IsOptional() @IsEnum(['low','medium','high','urgent'])
  priority?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  dependencyTaskIds?: string[];

  @IsOptional() @ValidateNested()
  assignment?: AssignmentDto;
}
```

### 3.4 核心 Service 逻辑

#### addTaskToPlan(planId, dto)

1. 校验 Plan 状态 ∈ `{draft, planned, failed}`，否则 400
2. 创建 `OrchestrationTask`：`planId`、`mode: 'plan'`、`status: 'pending'`
3. 计算 `order`：
   - 若指定 `insertAfterTaskId`：找到该任务的 order，后续所有任务 order +1，新任务 order = 目标 order + 1
   - 否则：order = 当前最大 order + 1
4. 若指定 `dependencyTaskIds`：校验引用的 taskId 均属于同一 planId
5. 更新 `plan.taskIds`（push/splice 新 taskId）
6. `refreshPlanStats()`
7. 同步 PlanSession（addTaskSnapshot）
8. 推送 SSE 事件 `plan.task.added`
9. 返回新创建的 task

#### removeTaskFromPlan(taskId)

1. 查找 task，校验 Plan 状态 ∈ `{draft, planned, failed}`
2. 校验 task.status 不是 `in_progress`
3. **级联清理依赖**：从同 plan 下其他任务的 `dependencyTaskIds` 中移除该 taskId
4. 删除 OrchestrationTask 文档
5. 从 `plan.taskIds` 中移除
6. 重新计算后续任务的 `order`（填补空隙，使 order 连续）
7. `refreshPlanStats()`
8. 同步 PlanSession（removeTaskSnapshot）
9. 推送 SSE 事件 `plan.task.removed`

#### updateTaskFull(taskId, dto)

1. 查找 task，校验 Plan 状态允许编辑
2. 校验 task.status 不是 `in_progress` 或 `completed`
3. 若 `dependencyTaskIds` 变更：
   - 校验引用 taskId 均属于同一 planId
   - **循环依赖检测**：构建有向图，跑拓扑排序（Kahn 算法），有环则 400 报错
4. 原子更新所有变更字段
5. 同步 PlanSession
6. 推送 SSE 事件 `plan.task.updated`
7. 返回更新后的 task

#### reorderPlanTasks(planId, dto)

1. 校验 Plan 状态 ∈ `{draft, planned, failed}`
2. 校验 `dto.taskIds` 与 `plan.taskIds` 集合一致（长度相等、元素相同）
3. `bulkWrite`：批量更新每个 task 的 `order = 数组索引`
4. 更新 `plan.taskIds` 为新顺序
5. 同步 PlanSession（重建快照顺序）
6. 推送 SSE 事件 `plan.tasks.reordered`

#### batchUpdateTasks(planId, dto)

1. 校验 Plan 状态
2. 遍历 `dto.updates`，逐条调用 `updateTaskFull` 的核心逻辑（跳过单独推送）
3. 全部完成后一次性 `refreshPlanStats()` + 同步 PlanSession
4. 推送一次聚合 SSE 事件 `plan.tasks.batch-updated`

#### duplicateTask(planId, sourceTaskId)

1. 查找源 task，校验 Plan 状态
2. 创建新 task：复制 title（追加 " (副本)"）、description、priority、assignment
3. `order = 源 task.order + 1`（后续任务 order +1）
4. `dependencyTaskIds = []`（副本默认无依赖）
5. 同 `addTaskToPlan` 的后续步骤（更新 plan/stats/session/SSE）

### 3.5 数据一致性同步清单

每次任务增删改操作，Service 层必须执行：

```
任务变更
  ├── 1. 更新 OrchestrationTask 文档
  ├── 2. 更新 Plan.taskIds 数组（增删场景）
  ├── 3. refreshPlanStats() → 重算 totalTasks/completedTasks/failedTasks/waitingHumanTasks
  ├── 4. 同步 PlanSession.tasks 快照
  └── 5. 推送 SSE 事件
```

### 3.6 循环依赖检测算法

使用 Kahn 拓扑排序，在 `updateTaskFull` 和 `batchUpdateTasks` 中执行：

```
function hasCyclicDependency(tasks: { _id, dependencyTaskIds }[]): boolean {
  构建邻接表 + 入度表
  入度为 0 的节点入队
  while 队列非空:
    出队节点，计数 +1
    遍历该节点的下游，入度 -1，入度归零则入队
  return 计数 !== 节点总数  // true = 有环
}
```

---

## 四、前端交互设计

### 4.1 任务列表区域改造（PlanDetail.tsx）

#### 可编辑模式触发条件

Plan 状态 ∈ `{draft, planned, failed}` 时，任务列表自动进入可编辑模式。

#### 布局结构

```
PlanDetail（可编辑模式）
├── 工具栏
│   ├── [+ 添加任务] 按钮
│   ├── [批量保存] 按钮（有未保存修改时高亮显示）
│   └── [运行计划] / [重新编排] / ...（已有按钮）
│
├── 任务列表（可拖拽排序）
│   ├── ⠿ 拖拽手柄
│   ├── 任务卡片（可展开/折叠）
│   │   ├── 标题（inline 编辑，点击即可修改）
│   │   ├── 优先级 Tag（点击切换 low/medium/high/urgent）
│   │   ├── 执行者分配下拉（已有 reassign 逻辑）
│   │   ├── 描述（展开后 textarea 编辑）
│   │   ├── 依赖关系选择器（多选下拉，可选同 plan 内其他任务）
│   │   └── 操作按钮
│   │       ├── [复制]
│   │       ├── [删除]（需二次确认）
│   │       ├── [调试] / [重试] / [人工完成]（已有）
│   │       └── [↑] [↓] 快捷排序（备选方案，移动端友好）
│   └── ... 更多任务卡片
│
└── 底部 [+ 在此处添加任务] 占位行
```

### 4.2 交互细节

| 操作 | 交互方式 | 技术方案 |
|---|---|---|
| 排序 | 拖拽或上下箭头按钮 | @dnd-kit/sortable；释放后调用 `PUT /plans/:id/tasks/reorder` |
| 内联编辑 | 点击标题/描述直接编辑，失焦保存 | 可 debounce 300ms 后单条保存，或累积后批量提交 |
| 优先级 | 点击 Tag 弹出 4 选 1 下拉 | 修改后即时保存 |
| 依赖关系 | 多选下拉（显示任务标题），自动过滤自身 | 前端校验循环依赖并给出提示 |
| 添加任务 | 点击按钮弹出轻量 Modal（标题+描述+优先级+执行者） | 可选"插入位置"（在哪个任务之后） |
| 删除任务 | 点击 → 确认弹窗 | 提示"依赖此任务的下游任务将自动解除依赖" |
| 复制任务 | 基于已有任务创建副本 | 标题自动加 " (副本)" 后缀，追加到源任务下方 |

### 4.3 状态感知 UI 控制矩阵

#### Plan 级别

| Plan 状态 | 编辑能力 | UI 表现 |
|---|---|---|
| `draft` / `planned` / `failed` | 完全可编辑 | 所有编辑控件可用 |
| `running` | 只读 + 状态观察 | 编辑控件禁用灰显，显示实时执行进度 |
| `drafting` | 只读 + 流式观察 | 显示 AI 正在生成任务的动画 |
| `paused` | 部分可编辑 | 未开始的任务可编辑，已完成/进行中的锁定 |
| `completed` | 只读 | 纯查看模式 |

#### Task 级别

| Task status | 可否编辑 | 可否删除 | 说明 |
|---|---|---|---|
| `pending` / `assigned` | 完全可编辑 | 可删除 | 尚未执行 |
| `blocked` | 完全可编辑 | 可删除 | 被阻塞但未执行 |
| `waiting_human` | 部分可编辑（描述/执行者） | 不可删除 | 等待人工操作中 |
| `in_progress` | 不可编辑 | 不可删除 | 正在执行 |
| `completed` | 不可编辑 | 不可删除 | 已完成锁定 |
| `failed` | 可编辑 | 可删除 | 便于修改后重试 |
| `cancelled` | 可编辑 | 可删除 | 可恢复为 pending 后使用 |

### 4.4 前端 API Service 扩展

在 `orchestrationService.ts` 中新增：

```typescript
addTaskToPlan(planId: string, data: AddTaskToPlanPayload): Promise<OrchestrationTask>
deleteTask(taskId: string): Promise<void>
updateTaskFull(taskId: string, data: UpdateTaskFullPayload): Promise<OrchestrationTask>
reorderTasks(planId: string, taskIds: string[]): Promise<void>
batchUpdateTasks(planId: string, updates: BatchUpdateItem[]): Promise<void>
duplicateTask(planId: string, taskId: string): Promise<OrchestrationTask>
```

---

## 五、实施步骤

| 阶段 | 内容 | 优先级 | 预估 |
|---|---|---|---|
| **P1 - 核心 CRUD** | 后端：`PATCH /tasks/:taskId` + `DELETE /tasks/:taskId` + `POST /plans/:planId/tasks` | 高 | 1-1.5 天 |
| **P2 - 排序与依赖** | 后端：`PUT /plans/:planId/tasks/reorder` + 循环依赖检测 | 高 | 0.5 天 |
| **P3 - 前端内联编辑** | 前端：任务卡片内联编辑（标题/描述/优先级/依赖/执行者） | 高 | 1-1.5 天 |
| **P4 - 前端交互增强** | 前端：拖拽排序（@dnd-kit）+ 添加/删除/复制按钮 | 中 | 1 天 |
| **P5 - 批量操作** | 前端：batch-update + 脏检测 + 未保存提示 | 中 | 0.5 天 |
| **P6 - 辅助端点** | 后端：`batch-update` + `duplicate` 端点 | 低 | 0.5 天 |

**推荐上线顺序**：P1 → P3 先完成核心闭环可用，再迭代 P2 → P4 → P5 → P6。

**总计约 4-5 天**。

---

## 六、风险与注意事项

| 风险项 | 缓解措施 |
|---|---|
| 循环依赖 | 前后端双重校验，后端用拓扑排序检测；前端在依赖选择时实时提示 |
| 并发编辑冲突 | 过渡方案暂不处理多人编辑；后续可通过 `updatedAt` 做乐观锁 |
| replan 覆盖手动调整 | UI 上 replan 按钮增加二次确认："重新编排将覆盖所有手动调整，是否继续？" |
| 已有 `updateTaskDraft` 兼容 | 旧端点标记 deprecated 但保留，内部转发到新 `updateTaskFull` 逻辑 |
| 删除任务的下游影响 | 删除前自动清理其他任务中对该 taskId 的依赖引用；前端弹窗提示影响范围 |
| PlanSession 快照不一致 | 所有操作统一通过 helper 方法同步 PlanSession，不允许绕过 |

---

## 七、与现有功能的关系

- **replan** 仍保留作为"全部重来"的选项，适用于需求变更较大的场景
- **debug-run** 保持不变，可在手动编辑任务后单步调试验证
- **reassignTask** 可被 `PATCH /tasks/:taskId` 的 `assignment` 字段覆盖，但旧端点保留兼容
- **MCP Tool Handler** 中的 Agent 编排工具（`updateOrchestrationPlan` 等）暂不扩展人工编辑能力；Agent 仍走 replan 路径

---

## 八、产品模型校正 — Plan / Schedule / Run（一步到位）

### 8.1 目标

修正当前"plan 与执行记录混放"的产品模型，**一次性**完成三层对象拆分，历史数据直接清除：

- **Plan**：任务模板（静态、可编辑，不被执行污染）
- **Schedule**：触发规则（cron/interval，纯调度器）
- **Run**：一次执行实例（轻量摘要）
- **RunTask**：单次执行中每个任务的详情（独立集合，按需加载）

同时满足：

1. Plan 详情分"任务设置"和"执行历史"两个 tab
2. 默认展示最后一次执行结果
3. 支持查看任意历史执行（包括非周期计划的多次手动触发）
4. 模板任务始终保持配置态，不被执行过程修改

### 8.2 现状问题

- 定时执行每次新建 `mode='schedule'` 的 task 并写入同一个 `planId`，导致 plan 任务列表持续膨胀
- `listTasksByPlan()` 和 `refreshPlanStats()` 按 `planId` 全量聚合，不区分 mode，统计失真
- 手动多次 `runPlan()` 直接修改模板任务的 status/result/sessionId，模板被执行态覆盖
- 缺少 run 维度，无法追溯任意一次执行的完整快照

### 8.3 数据模型

#### A. 新增 `orchestration_runs`（轻量摘要）

```typescript
interface OrchestrationRun {
  _id: string;
  planId: string;
  triggerType: 'manual' | 'schedule' | 'autorun';
  scheduleId?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  summary?: string;
  error?: string;
  stats: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    waitingHumanTasks: number;
  };
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
```

索引：
- `{ planId: 1, startedAt: -1 }`
- `{ scheduleId: 1, startedAt: -1 }`
- `{ status: 1 }`

#### B. 新增 `orchestration_run_tasks`（任务级执行详情）

```typescript
interface OrchestrationRunTask {
  _id: string;
  runId: string;
  planId: string;
  sourceTaskId: string;       // 对应模板任务 _id
  order: number;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: OrchestrationTaskStatus;
  assignment: {
    executorType: 'agent' | 'employee' | 'unassigned';
    executorId?: string;
    reason?: string;
  };
  dependencyTaskIds: string[];  // 对应模板任务依赖（快照）
  result?: {
    summary?: string;
    output?: string;
    error?: string;
  };
  sessionId?: string;
  runLogs?: Array<{
    timestamp: Date;
    level: 'info' | 'warn' | 'error';
    message: string;
    metadata?: Record<string, unknown>;
  }>;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

索引：
- `{ runId: 1, order: 1 }`
- `{ planId: 1, runId: 1 }`
- `{ sourceTaskId: 1 }`

#### C. Plan 语义收敛

- `orchestration_tasks` 仅作为模板任务（`mode='plan'`），始终保持配置态（status = pending/assigned）
- 执行不修改模板任务的 status/result/sessionId
- `plan.stats` 仅统计模板任务数量（totalTasks），不再统计完成/失败
- Plan 新增 `lastRunId?: string` 字段，指向最后一次 run

#### D. Schedule 语义收敛

- `orchestration_schedule` 仅管理触发规则
- 触发时创建 `run` + `run_tasks`，不再向 `orchestration_tasks` 写 `mode='schedule'` 记录
- `schedule.lastRun` 保留，指向最后一次 run 的摘要

### 8.4 执行链路改造

#### 统一执行入口 `executePlanRun(planId, triggerType, scheduleId?)`

```
1. 创建 OrchestrationRun（status=running, triggerType, scheduleId?）
2. 读取模板任务 listTasksByPlan(planId)  // mode='plan'
3. 基于模板批量创建 OrchestrationRunTask（快照模板字段，status=pending）
4. 按 strategy.mode（sequential/parallel/hybrid）执行 run_tasks：
   - 依赖检查基于 run_tasks 内部的 dependencyTaskIds
   - 状态流转写 run_task，不写模板 task
   - Agent 调用、SSE 推送、session 管理维持现有逻辑，scopeId 改为 runId
5. 执行完成：
   - 汇总 run_tasks 状态 → 回写 run.stats/status/durationMs
   - 更新 plan.lastRunId
   - 若有 scheduleId → 回写 schedule.lastRun
6. SSE 推送 run 维度事件（run.started / run.task.completed / run.completed / run.failed）
```

#### 手动执行

`POST /orchestration/plans/:id/run` → `executePlanRun(planId, 'manual')`

#### Schedule 触发

`SchedulerService.dispatchSchedule()` → `executePlanRun(planId, 'schedule', scheduleId)`

不再直接创建 `mode='schedule'` 的 task。

#### autorun（创建计划后自动执行）

`generatePlanTasksAsync()` 末尾 → `executePlanRun(planId, 'autorun')`

### 8.5 API 调整

#### 新增端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/orchestration/plans/:id/runs` | Run 历史列表（分页，默认 limit=20） |
| `GET` | `/orchestration/plans/:id/runs/latest` | 最后一次 Run 摘要 |
| `GET` | `/orchestration/runs/:runId` | Run 详情（含 stats，不含 tasks） |
| `GET` | `/orchestration/runs/:runId/tasks` | Run 下的 run_tasks 列表 |

#### 调整端点

| 端点 | 调整内容 |
|---|---|
| `GET /plans/:id` | 返回 `tasks`（模板）+ `lastRun`（最后执行摘要） |
| `POST /plans/:id/run` | 改为创建 run → 执行 run_tasks |
| `GET /schedules/:id/history` | 改查 `orchestration_runs`（scheduleId 匹配） |
| `POST /tasks/:id/retry` | 改为在最后一次 run 中重试该 run_task |
| `POST /tasks/:id/complete-human` | 改为在最后一次 run 中标记该 run_task 完成 |
| `POST /tasks/:id/debug-run` | 保持对模板任务操作（调试不产生 run） |

### 8.6 前端信息架构

```
PlanDetail
├── Tab: 任务设置（默认）
│   ├── 模板任务列表（可编辑：增删排序/标题/描述/优先级/依赖/执行者）
│   └── 操作栏：添加任务 / 批量保存 / 运行计划 / 重新编排
│
└── Tab: 执行历史
    ├── 最后一次执行卡片
    │   ├── 状态 badge（running/completed/failed）
    │   ├── 触发来源（手动/定时/自动）
    │   ├── 开始时间 / 耗时
    │   ├── 完成率进度条（completedTasks / totalTasks）
    │   └── [查看详情] 按钮
    │
    ├── 执行历史列表
    │   ├── 每行：Run ID / 触发类型 / 状态 / 开始时间 / 耗时 / 完成率
    │   ├── 支持按 triggerType / status 过滤
    │   └── 分页加载
    │
    └── Run 详情（抽屉或子页）
        ├── Run 摘要（同卡片信息 + error）
        └── RunTask 列表
            ├── 每个 task：标题 / 状态 / 执行者 / 输出 / 错误 / 耗时
            └── 支持展开查看完整 output 和 runLogs
```

### 8.7 数据清理（一步到位）

不做历史兼容、不做双读、不做回填：

1. 上线前清理 `orchestration_tasks` 中 `mode='schedule'` 的历史记录
2. 移除 `orchestration_task.schema` 中的 `mode` 和 `scheduleId` 字段
3. 移除 Scheduler 中创建 `mode='schedule'` task 的逻辑
4. 移除 `getScheduleHistory()` 中查 `orchestration_tasks` 的逻辑

### 8.8 实施步骤

| 步骤 | 内容 | 预估 |
|---|---|---|
| 1 | 定义 `OrchestrationRun` + `OrchestrationRunTask` Schema、索引 | 0.5 天 |
| 2 | Plan Schema 新增 `lastRunId`；Task Schema 移除 `mode`/`scheduleId` | 0.5 天 |
| 3 | 实现 `executePlanRun()` 统一执行入口（创建 run → 快照 run_tasks → 执行 → 回写） | 2 天 |
| 4 | 改造 `runPlan()` / `runPlanAsync()` 调用 `executePlanRun(manual)` | 0.5 天 |
| 5 | 改造 `SchedulerService.dispatchSchedule()` 调用 `executePlanRun(schedule)` | 0.5 天 |
| 6 | 新增 Run API 端点（runs 列表/详情/latest/tasks） | 1 天 |
| 7 | 调整 Plan 详情 API 返回 lastRun | 0.5 天 |
| 8 | 前端 PlanDetail 增加"执行历史"tab + Run 详情抽屉 | 1.5 天 |
| 9 | Scheduler 历史页切到 runs 查询 | 0.5 天 |
| 10 | 清理：删 mode=schedule 旧数据、移除旧字段和逻辑 | 0.5 天 |

**总计约 8 天**（含上方任务编辑能力的 4-5 天，共约 12-13 天）

### 8.9 风险与注意事项

| 风险项 | 缓解措施 |
|---|---|
| 执行链路改造范围大 | `executePlanRun` 封装为独立方法，不改现有 helper 签名，只改调用入口 |
| run_tasks 与模板 task 的 ID 映射 | run_task 保留 `sourceTaskId` 字段，始终可溯源到模板 |
| SSE 事件需补充 run 维度 | 新增 `run.started` / `run.task.updated` / `run.completed` / `run.failed` 事件 |
| retry/complete-human 操作需适配 | 这些操作改为作用于"最后一次 run 的对应 run_task"，而非模板任务 |
| 模板任务始终 pending 的用户认知 | 前端在"任务设置"tab 展示模板状态；在"执行历史"tab 展示实际执行状态，通过 tab 分区避免混淆 |
| Plan.stats 语义变化 | stats 改为仅反映模板任务数量，执行维度的统计归属 run.stats |

### 8.10 当前落地进度（2026-03-22）

已完成（前端）：

- `frontend/src/pages/Scheduler.tsx` 历史展示从旧 task 结果结构切换为 run 结构，适配 `summary/error` 字段。
- `frontend/src/services/schedulerService.ts` 历史类型改为 run 维度（`ScheduleRunHistory` 对齐 run 摘要）。
- `frontend/src/services/orchestrationService.ts` 新增 run 查询接口与类型：`getPlanRuns/getPlanLatestRun/getRunById/getRunTasks`。
- `frontend/src/pages/PlanDetail.tsx` 完成“任务设置 / 执行历史”双 Tab、最近一次 run 卡片、run 历史筛选列表、run 明细抽屉（含 run task 列表）。
- `frontend/src/pages/Orchestration.tsx` 计划详情抽屉补齐 run 历史视图：双 Tab、最近一次 run 卡片、run 列表筛选与 run 详情抽屉。

待继续推进：

- run 维度 SSE（`run.*`）联动优化，减少历史 tab 的轮询刷新依赖。

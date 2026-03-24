# PlanDetail 页面综合重构计划

> 状态：执行中（2026-03-24 已启动开发，2026-03-24 第二轮继续收敛）  
> 创建时间：2026-03-24  
> 关联文档：`docs/feature/ORCHETRATION_TASK.md`、`docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD`、`docs/plan/ORCHESTRATION_TASK_MANUAL_EDIT_PLAN.md`

---

## 执行进展（2026-03-24 第二轮）

- 前端文件体量收敛：`DebugDrawer.tsx`、`usePlanMutations.ts`、`useTaskMutations.ts` 已拆分到 200 行以内。
- 调试区拆分为 `DebugDrawerDebugTab.tsx` 与 `DebugDrawerSessionTab.tsx`，并补充 production 只读锁定（禁止调试草稿保存与执行）。
- Task 卡片边缘操作加锁：production 下禁用 `调试 / 人工完成 / 重试`。
- 后端补充 production 保护：`task-lifecycle.service.ts` 在 `reassign / complete-human / retry / debug` 的计划任务路径增加状态拦截。
- 新增后端接口单测：`backend/test/orchestration/orchestration.controller.spec.ts` 覆盖 `cancelRun/publishPlan/unlockPlan` 入口委派与鉴权路径。
- 已验证：`frontend npm run build`、`backend npm run build`、`backend jest --runTestsByPath test/orchestration/orchestration.controller.spec.ts` 通过。

> 仍待继续：`PlanDetail.tsx` 页面壳进一步下沉（当前 471 行，未达 <=200/<=150 目标）以及前端交互定向测试补齐。

---

## 一、背景与目标

### 1.1 现状问题

`frontend/src/pages/PlanDetail.tsx` 当前为 **2097 行的单体组件**，承载了计划详情页的全部 UI 和业务逻辑，存在以下问题：

| 问题维度 | 现状 | 影响 |
|---|---|---|
| **文件体量** | 2097 行单文件，~50 个 useState、14 个 useMutation、8 个 useQuery | 可读性差、改动风险高、协作困难 |
| **任务编辑模式** | 全部 inline 编辑（input/textarea/select 直接嵌在任务卡片中） | 信息密度过高、表单区挤占列表空间、移动端体验差 |
| **执行控制缺失** | 无「停止/取消正在运行的 Plan Run」功能 | 失控的执行无法中止，只能等失败或自然结束 |
| **状态保护缺失** | 无「生产/锁定」状态，draft/planned 即可随意编辑和运行 | 已投产的计划容易被误操作修改，缺乏发布保护 |
| **组件复用性** | 所有 drawer/modal/任务卡片均为行内 JSX，无法在 Orchestration.tsx 等处复用 | Orchestration.tsx（2066 行）存在大量重复代码 |

### 1.2 改造目标

本次改造覆盖 **4 个方向**，一次性解决上述问题：

| # | 方向 | 目标 |
|---|---|---|
| **A** | 全面重构 PlanDetail 页面 | 将 2097 行单体组件拆分为 15+ 个职责清晰的子组件/hooks，提升可维护性和复用性 |
| **B** | 新增「停止/取消 Plan Run」 | 前后端完整实现运行中 run 的取消机制，用户可在执行历史和详情中一键停止 |
| **C** | 新增「生产/锁定」Plan 状态 | 增加 `production` 状态，投产计划默认锁定编辑，需显式解锁后才可修改 |
| **D** | 任务编辑改用 Drawer 模式 | 从 inline 编辑改为右侧 Drawer 侧抽屉编辑，任务列表回归简洁展示 |

---

## 二、方向 A：PlanDetail 页面组件拆分

### 2.1 拆分策略

按「页面壳 → 区块组件 → 原子组件 → 自定义 hooks」四层拆分：

```
frontend/src/pages/PlanDetail.tsx          (页面壳，~150 行)
frontend/src/components/orchestration/
├── PlanHeader.tsx                          (顶部标题栏 + 操作按钮)
├── PlanSummaryCards.tsx                    (状态/统计摘要卡片行)
├── PlanDraftingBanner.tsx                  (drafting 状态横幅)
├── PlanTabBar.tsx                          (任务设置 / 执行历史 Tab 切换)
├── PlanSettingsTab.tsx                     (设置 Tab 容器：模式/Prompt + 任务列表)
├── PlanPromptEditor.tsx                    (模式选择 + Prompt 编辑区)
├── TaskList.tsx                            (任务列表容器：工具栏 + 列表)
├── TaskCard.tsx                            (单个任务卡片：摘要展示模式)
├── TaskEditDrawer.tsx                      (任务编辑 Drawer —— 方向 D)
├── TaskDependencyModal.tsx                 (依赖设置弹窗)
├── AddTaskModal.tsx                        (添加任务弹窗)
├── PlanHistoryTab.tsx                      (执行历史 Tab 容器)
├── LatestRunCard.tsx                       (最近一次 run 摘要卡片)
├── RunHistoryList.tsx                      (历史 run 列表 + 筛选)
├── RunDetailDrawer.tsx                     (Run 详情抽屉)
├── DebugDrawer.tsx                         (单步调试抽屉)
├── ReplanModal.tsx                         (重新编排确认弹窗)
├── PlanStatusBadge.tsx                     (状态 badge 原子组件)
└── constants.ts                            (STATUS_COLOR 等常量)
frontend/src/hooks/
├── usePlanDetail.ts                        (plan 数据查询 + SSE 订阅)
├── usePlanMutations.ts                     (所有 plan 级 mutations)
├── useTaskMutations.ts                     (所有 task 级 mutations)
├── useTaskEditing.ts                       (taskEdits 状态管理 + dirtyTaskUpdates 计算)
└── usePlanRunHistory.ts                    (run 数据查询 + 筛选)
```

### 2.2 各组件职责与行数预估

| 组件/Hook | 职责 | 预估行数 |
|---|---|---|
| `PlanDetail.tsx`（页面壳） | 路由参数获取、组合 hooks、向子组件传递 props | ~120 |
| `PlanHeader.tsx` | 返回按钮、标题、刷新/生成/保存/重排/运行/复制MD/停止 按钮 | ~120 |
| `PlanSummaryCards.tsx` | 5 列摘要卡片（状态/任务数/增量进度/最后执行/执行时间） | ~60 |
| `PlanDraftingBanner.tsx` | drafting 状态 + stream 连接提示 | ~30 |
| `PlanTabBar.tsx` | Tab 切换（任务设置 / 执行历史） | ~25 |
| `PlanSettingsTab.tsx` | 组合 PlanPromptEditor + TaskList | ~40 |
| `PlanPromptEditor.tsx` | 模式 select + Prompt textarea + hint | ~50 |
| `TaskList.tsx` | 工具栏（添加/批量保存）+ 任务卡片列表循环 | ~80 |
| `TaskCard.tsx` | 摘要展示：序号、标题、状态 badge、类型 badge、操作按钮（编辑/调试/删除/复制/移动） | ~120 |
| `TaskEditDrawer.tsx` | 右侧 Drawer：完整编辑表单（标题/描述/优先级/执行者/依赖/上下文） | ~200 |
| `TaskDependencyModal.tsx` | 从现有 inline 依赖弹窗提取 | ~80 |
| `AddTaskModal.tsx` | 从现有 inline 添加弹窗提取 | ~90 |
| `PlanHistoryTab.tsx` | 组合 LatestRunCard + RunHistoryList | ~40 |
| `LatestRunCard.tsx` | 最近 run 摘要 + 完成率进度条 | ~80 |
| `RunHistoryList.tsx` | 筛选 + run 列表 | ~100 |
| `RunDetailDrawer.tsx` | Run 详情 + RunTask 列表 | ~150 |
| `DebugDrawer.tsx` | 调试/Session 双 Tab Drawer | ~200 |
| `ReplanModal.tsx` | Planner 选择 + 自动生成 checkbox | ~80 |
| `PlanStatusBadge.tsx` | 通用状态 badge | ~20 |
| `constants.ts` | 所有颜色/标签常量集中管理 | ~60 |
| `usePlanDetail.ts` | plan 查询 + SSE 订阅 + stream 状态 | ~80 |
| `usePlanMutations.ts` | savePrompt/runPlan/generateNext/replan mutations | ~100 |
| `useTaskMutations.ts` | add/remove/duplicate/reorder/batchUpdate/saveDraft/debugStep/reassign/retry/completeHuman | ~120 |
| `useTaskEditing.ts` | taskEdits Record + dirtyTaskUpdates memo + helpers | ~80 |
| `usePlanRunHistory.ts` | planRuns/latestRun/runDetail/runTasks 查询 + 筛选 | ~70 |

**总计**：~2195 行（分散在 25 个文件中），相比原来的 2097 行单文件，总行数略增但每个文件均在 200 行以内。

### 2.3 组件通信方式

- **页面壳 → 区块组件**：通过 props 传递 hooks 返回值（plan data, mutations, editing state）
- **区块组件 → 原子组件**：通过 props 传递具体数据和回调
- **跨组件状态**：通过 hooks 集中管理，不引入额外 Context（规模尚可控）
- **常量/类型/工具函数**：统一导出自 `constants.ts` 和 `orchestrationService.ts`

### 2.4 迁移策略

采用**渐进式提取**，保持功能持续可用：

1. 先提取 `constants.ts`、`PlanStatusBadge.tsx` 等无状态组件
2. 提取自定义 hooks（usePlanDetail、usePlanMutations 等），原 PlanDetail 中改为调用 hooks
3. 由外向内逐个提取区块组件（Header → SummaryCards → TabBar → ...）
4. 最后提取 TaskCard + TaskEditDrawer（涉及方向 D 交互改造）
5. 每步提取后运行 `npm run build && npm run lint` 验证

---

## 三、方向 B：新增「停止/取消 Plan Run」功能

### 3.1 现状分析

- 前端 `orchestrationService.ts` **无** cancel/stop/abort 相关方法
- 后端 `orchestration.controller.ts` 的 30+ 端点中**无**取消 run 的端点
- `OrchestrationRun` 类型已包含 `cancelled` 状态，但无触发路径
- 后端 `plan-execution.service.ts` 中 `deriveRunStatus()` 已能识别 `cancelled` 状态
- `agentService.cancelRuntimeRun(runId, reason)` 仅针对 Agent Runtime 任务，不适用于编排 Run

### 3.2 后端实现

#### 3.2.1 新增 API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/orchestration/runs/:runId/cancel` | 取消指定 run |

#### 3.2.2 Controller 层

```typescript
// orchestration.controller.ts
@Post('runs/:runId/cancel')
async cancelRun(
  @Param('runId') runId: string,
  @Body() body: { reason?: string },
) {
  return this.orchestrationService.cancelRun(runId, body?.reason);
}
```

#### 3.2.3 Service 层（plan-execution.service.ts）

`cancelRun(runId, reason?)` 核心逻辑：

1. **查询 Run**：获取 `OrchestrationRun`，校验 `status === 'running'`，否则返回 400
2. **标记 Run 取消**：
   ```
   run.status = 'cancelled'
   run.completedAt = new Date()
   run.durationMs = completedAt - startedAt
   run.error = reason || '用户手动取消'
   ```
3. **批量取消未完成的 RunTask**：
   ```
   将 run 下所有 status ∈ {pending, assigned, blocked} 的 run_tasks 批量更新为 cancelled
   ```
4. **中止进行中的 RunTask**：
   - 查找 `status === 'in_progress'` 的 run_tasks
   - 对于每个进行中的 agent 任务，调用 `agentClientService.cancelAsyncTask(taskId)` 尝试中止（best-effort）
   - 将这些 run_tasks 标记为 `cancelled`
5. **重算 Run Stats**：
   ```
   stats.completedTasks = count(status === 'completed')
   stats.failedTasks = count(status === 'failed')
   ```
6. **更新 Plan**：`plan.lastRunId` 保持不变（已指向此 run）
7. **推送 SSE 事件**：`run.cancelled`
8. **返回**：
   ```json
   { "success": true, "runId": "...", "status": "cancelled", "cancelledTasks": 5 }
   ```

#### 3.2.4 执行引擎适配（orchestration-execution-engine.service.ts）

在 `executeRunTaskNode` 的 async agent 等待循环中增加 **cancellation check**：

```typescript
// 每次轮询 agent task 状态前，先检查 run 是否已被取消
const currentRun = await this.runModel.findById(runId).lean();
if (currentRun?.status === 'cancelled') {
  // 中止当前等待，标记 run_task 为 cancelled
  await this.updateRunTaskStatus(runTaskId, 'cancelled', { error: 'Run cancelled by user' });
  return;
}
```

同样在 `executePlanRun` 的主循环中，每轮执行前检查 run 状态：

```typescript
for (const runTask of pendingRunTasks) {
  const freshRun = await this.runModel.findById(run._id).lean();
  if (freshRun?.status === 'cancelled') {
    break; // 停止调度后续任务
  }
  await this.executeRunTaskNode(runTask, ...);
}
```

#### 3.2.5 DTO

```typescript
// dto/cancel-run.dto.ts
export class CancelRunDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
```

### 3.3 前端实现

#### 3.3.1 Service 层（orchestrationService.ts）

```typescript
async cancelRun(runId: string, reason?: string): Promise<{ success: boolean; runId: string; status: string; cancelledTasks: number }> {
  const response = await api.post(`/orchestration/runs/${runId}/cancel`, { reason });
  return response.data;
},
```

#### 3.3.2 UI 入口

**位置 1：PlanHeader 操作栏**

当 `latestRunSummary?.status === 'running'` 时，"运行"按钮旁显示红色"停止运行"按钮：

```
[▶ 运行] [■ 停止运行]
```

点击后弹出确认对话框："确认停止当前正在运行的计划？进行中的任务将被中止。"

**位置 2：RunDetailDrawer 详情抽屉**

当 `runDetail.status === 'running'` 时，在抽屉顶部操作区显示"取消此次运行"按钮。

**位置 3：RunHistoryList 历史列表**

在每条 `status === 'running'` 的 run 行项上显示"取消"按钮。

#### 3.3.3 Mutation Hook

```typescript
// usePlanMutations.ts 中新增
const cancelRunMutation = useMutation(
  ({ runId, reason }: { runId: string; reason?: string }) =>
    orchestrationService.cancelRun(runId, reason),
  {
    onSuccess: async () => {
      await refreshPlanData();
    },
  },
);
```

---

## 四、方向 C：新增「生产/锁定」Plan 状态

### 4.1 状态模型扩展

#### 4.1.1 PlanStatus 类型扩展

**当前**：
```typescript
export type PlanStatus = 'draft' | 'drafting' | 'planned';
```

**扩展后**：
```typescript
export type PlanStatus = 'draft' | 'drafting' | 'planned' | 'production';
```

#### 4.1.2 production 状态语义

| 属性 | 说明 |
|---|---|
| **含义** | 计划已投入生产使用，任务结构被锁定 |
| **进入条件** | 用户在 `planned` 状态下点击「发布为生产」 |
| **退出条件** | 用户点击「解锁编辑」→ 回退到 `planned` 状态 |
| **可运行** | 是（production 状态可正常运行、触发定时调度） |
| **可编辑任务** | 否（任务增删改排序全部禁用） |
| **可修改 Prompt** | 否（Prompt/模式均只读） |
| **可重新编排** | 否（replan 按钮禁用） |
| **可取消** | 是（可取消运行中的 run） |
| **可删除计划** | 否（需先解锁为 planned） |

#### 4.1.3 状态流转图

```
                ┌──────────────────────────────┐
                │                              │
                ▼                              │
  [draft] ──▶ [drafting] ──▶ [planned] ──▶ [production]
    │              │              │              │
    │              │              │              │
    │              ▼              ▼              │
    │          (生成失败      (可编辑          │
    │           回退draft)    可运行           │
    │                         可发布)          │
    │                            │              │
    │                            ▼              │
    │                      ┌─────────┐          │
    │                      │ 发布为  │──────────┘
    │                      │ 生产    │
    │                      └─────────┘
    │                                           │
    │                      ┌─────────┐          │
    │                      │ 解锁    │◀─────────┘
    │                      │ 编辑    │
    │                      └────┬────┘
    │                           │
    │                           ▼
    └──────────────────── [planned]
```

### 4.2 后端实现

#### 4.2.1 新增 API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/orchestration/plans/:id/publish` | 将计划发布为 production |
| `POST` | `/orchestration/plans/:id/unlock` | 将 production 计划解锁回 planned |

#### 4.2.2 Controller 层

```typescript
@Post('plans/:id/publish')
async publishPlan(@Param('id') planId: string) {
  return this.orchestrationService.publishPlan(planId);
}

@Post('plans/:id/unlock')
async unlockPlan(@Param('id') planId: string) {
  return this.orchestrationService.unlockPlan(planId);
}
```

#### 4.2.3 Service 层（plan-management.service.ts）

**publishPlan(planId)**：
1. 校验当前 status === 'planned'，否则 400（"仅 planned 状态可发布"）
2. 校验 `tasks.length > 0`，否则 400（"空计划不可发布"）
3. 更新 `plan.status = 'production'`
4. 推送 SSE 事件 `plan.status.changed`
5. 返回更新后的 plan

**unlockPlan(planId)**：
1. 校验当前 status === 'production'，否则 400
2. 校验无 running 状态的 run（"有运行中的执行，无法解锁"），否则 400
3. 更新 `plan.status = 'planned'`
4. 推送 SSE 事件 `plan.status.changed`
5. 返回更新后的 plan

#### 4.2.4 编辑保护加固

在 `task-management.service.ts` 的所有任务编辑方法（add/remove/update/reorder/batch/duplicate）中，将状态校验更新：

```typescript
// 当前
const EDITABLE_STATUS = new Set(['draft', 'planned']);

// 更新后：production 不可编辑
const EDITABLE_STATUS = new Set(['draft', 'planned']);
// production 显式不在可编辑集合中，已自动拦截
```

在 `plan-management.service.ts` 的 updatePlan 和 replanPlan 方法中增加 production 状态拦截：

```typescript
if (plan.status === 'production') {
  throw new BadRequestException('生产状态的计划不可修改，请先解锁');
}
```

在 `plan-management.service.ts` 的 deletePlan 方法中增加 production 拦截：

```typescript
if (plan.status === 'production') {
  throw new BadRequestException('生产状态的计划不可删除，请先解锁');
}
```

#### 4.2.5 normalizePlanStatus 更新

```typescript
// orchestrationService.ts 前端
const normalizePlanStatus = (status: string | undefined, taskCount = 0): PlanStatus => {
  if (status === 'draft' || status === 'drafting' || status === 'planned' || status === 'production') {
    return status;
  }
  if (status === 'failed' && taskCount === 0) {
    return 'draft';
  }
  return 'planned';
};
```

#### 4.2.6 Schema 更新

```typescript
// orchestration-plan.schema.ts
status: {
  type: String,
  enum: ['draft', 'drafting', 'planned', 'production'],
  default: 'draft',
},
```

### 4.3 前端实现

#### 4.3.1 类型更新（orchestrationService.ts）

```typescript
export type PlanStatus = 'draft' | 'drafting' | 'planned' | 'production';
```

#### 4.3.2 常量更新

```typescript
// constants.ts
const STATUS_COLOR = {
  ...existing,
  production: 'bg-green-100 text-green-700 ring-1 ring-green-300',
};

const FULLY_EDITABLE_PLAN_STATUS = new Set(['draft', 'planned']);
// production 不在其中，自动不可编辑

const RUNNABLE_PLAN_STATUS = new Set(['planned', 'production']);
```

#### 4.3.3 Service 层新增

```typescript
async publishPlan(planId: string): Promise<OrchestrationPlan> {
  const response = await api.post(`/orchestration/plans/${planId}/publish`);
  return normalizePlan(response.data);
},

async unlockPlan(planId: string): Promise<OrchestrationPlan> {
  const response = await api.post(`/orchestration/plans/${planId}/unlock`);
  return normalizePlan(response.data);
},
```

#### 4.3.4 UI 表现

**PlanHeader 操作栏**：

当 `status === 'planned'` 时显示「发布为生产」按钮（绿色，带锁图标）：
- 点击后确认对话框："发布后计划将被锁定，任务结构不可修改。确认发布？"

当 `status === 'production'` 时：
- 显示绿色 `production` 状态 badge
- 显示「解锁编辑」按钮（黄色，带解锁图标）
- 所有编辑按钮（保存/重新编排/生成下一步/添加任务/批量保存）灰显禁用
- "运行"按钮保持可用
- 点击「解锁编辑」确认对话框："解锁后计划可被修改，确认解锁？"

**TaskList / TaskCard**：

当 `status === 'production'` 时：
- 任务卡片标题/描述/优先级/执行者 均为只读展示（无 input/textarea/select）
- 移动/复制/删除按钮隐藏
- 调试按钮保持可用（调试不修改模板）

**PlanPromptEditor**：

当 `status === 'production'` 时：
- Prompt textarea 变为只读
- 模式 select 禁用

---

## 五、方向 D：任务编辑改用 Drawer 模式

### 5.1 设计理念

将任务列表从"每卡片内嵌完整编辑表单"改为"列表简洁展示 + 右侧 Drawer 详细编辑"模式：

- **TaskCard**（任务卡片）：仅展示摘要信息（序号、标题、状态、优先级 badge、执行者、操作按钮）
- **TaskEditDrawer**（编辑抽屉）：承载完整编辑能力（标题、描述、优先级、执行者、依赖、上下文信息、操作按钮）

### 5.2 TaskCard 简洁展示模式

每个 TaskCard 展示以下信息：

```
┌─────────────────────────────────────────────────────────────────┐
│ #1  [pending]  [type: auto]                                     │
│ 任务标题文本（只读展示，截断显示）                                    │
│ 优先级: medium  ·  执行者: agent:xxx  ·  依赖: 2项               │
│                                      [编辑] [调试] [↑] [↓] [×]  │
└─────────────────────────────────────────────────────────────────┘
```

操作按钮说明：
- **编辑（PencilSquareIcon）**：打开 TaskEditDrawer
- **调试（BeakerIcon）**：打开 DebugDrawer（保持现有行为）
- **↑ / ↓**：快速排序（保持现有行为）
- **×（删除）**：确认删除（保持现有行为）

### 5.3 TaskEditDrawer 详细设计

#### 5.3.1 布局结构

```
┌─────────────────────────────────────────────────────┐
│ [关闭]  编辑任务 #1                    [保存] [复制] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  任务标题                                            │
│  ┌─────────────────────────────────────────────┐    │
│  │ (input)                                     │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  优先级         任务类型                              │
│  ┌──────────┐  ┌──────────┐                         │
│  │ (select) │  │ (select) │                         │
│  └──────────┘  └──────────┘                         │
│                                                     │
│  执行者类型     执行者                                │
│  ┌──────────┐  ┌──────────┐                         │
│  │ (select) │  │ (select) │                         │
│  └──────────┘  └──────────┘                         │
│                                                     │
│  任务描述                                            │
│  ┌─────────────────────────────────────────────┐    │
│  │ (textarea, min-height: 200px)               │    │
│  │                                             │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  依赖任务                          [设置依赖]        │
│  已选 2 项：#2 数据收集, #3 方案设计                   │
│                                                     │
│  ─────────── 执行信息（只读）───────────              │
│                                                     │
│  状态: pending                                       │
│  输出: -                                             │
│  错误: -                                             │
│  Session: (链接)                                     │
│                                                     │
│  ─────────── 操作 ───────────                        │
│                                                     │
│  [人工完成]  [重试]  (根据 task status 条件显示)       │
│                                                     │
│  ─────────── 脏状态提示 ───────────                   │
│  ⚠ 有未保存的改动                    [保存] [放弃]    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

#### 5.3.2 交互行为

| 操作 | 行为 |
|---|---|
| 打开 Drawer | 从 taskEdits 中读取已有草稿，无则从 task 数据初始化 |
| 编辑字段 | 实时更新到 `taskEdits` state（与现有 inline 编辑共享同一 state） |
| 点击"保存" | 调用 `batchUpdateTasksMutation`（仅包含当前 task 的 dirty updates） |
| 点击"放弃" | 从 `taskEdits` 中移除当前 task 的草稿，关闭 Drawer |
| 点击"复制" | 调用 `duplicateTaskMutation`，成功后关闭 Drawer |
| 关闭 Drawer | 若有未保存改动，提示"有未保存的改动，是否放弃？" |
| 设置依赖 | 打开 TaskDependencyModal（复用现有弹窗） |
| 人工完成/重试 | 保持现有行为 |

#### 5.3.3 z-index 层级

保持与现有 Drawer/Modal 一致的层级策略：

| 组件 | z-index |
|---|---|
| RunDetailDrawer | 88 |
| DebugDrawer | 90 |
| TaskEditDrawer | 89（新增，介于 Run 和 Debug 之间） |
| AddTaskModal | 92 |
| TaskDependencyModal | 93 |
| ReplanModal | 95 |

#### 5.3.4 状态感知

- `isPlanEditable === false`（production / drafting / running）时：Drawer 内所有表单控件禁用，仅做信息查看
- `task.status === 'in_progress'` 或 `'completed'` 时：Drawer 中展示只读信息

---

## 六、实施步骤

### 阶段 1：基础设施（预估 0.5 天）

| # | 步骤 | 影响范围 |
|---|---|---|
| 1.1 | 创建 `frontend/src/components/orchestration/` 目录 | Frontend |
| 1.2 | 提取 `constants.ts`（STATUS_COLOR、RUN_STATUS_COLOR 等所有常量） | Frontend |
| 1.3 | 提取 `PlanStatusBadge.tsx` 原子组件 | Frontend |
| 1.4 | 提取工具函数（formatDateTime、formatDuration、formatExecutor、buildPlanTasksMarkdown） | Frontend |

### 阶段 2：自定义 Hooks 提取（预估 1 天）

| # | 步骤 | 影响范围 |
|---|---|---|
| 2.1 | 提取 `usePlanDetail.ts`（plan 查询 + SSE + stream state） | Frontend |
| 2.2 | 提取 `usePlanMutations.ts`（plan 级 mutations） | Frontend |
| 2.3 | 提取 `useTaskMutations.ts`（task 级 mutations） | Frontend |
| 2.4 | 提取 `useTaskEditing.ts`（taskEdits + dirtyTaskUpdates） | Frontend |
| 2.5 | 提取 `usePlanRunHistory.ts`（run 查询 + 筛选 state） | Frontend |

### 阶段 3：后端 — 停止/取消 Run + Production 状态（预估 1.5 天）

| # | 步骤 | 影响范围 |
|---|---|---|
| 3.1 | Schema 更新：PlanStatus 枚举增加 `production` | Backend DB |
| 3.2 | 实现 `cancelRun(runId, reason)` service 方法 | Backend |
| 3.3 | 实现执行引擎 cancellation check（轮询前检查 run 状态） | Backend |
| 3.4 | 实现 `publishPlan(planId)` 和 `unlockPlan(planId)` | Backend |
| 3.5 | 加固 task-management / plan-management 的 production 状态拦截 | Backend |
| 3.6 | 新增 Controller 端点：`POST /runs/:runId/cancel`、`POST /plans/:id/publish`、`POST /plans/:id/unlock` | Backend API |
| 3.7 | 更新 `normalizePlanStatus` 适配 `production` | Backend |

### 阶段 4：前端 Service + 类型更新（预估 0.5 天）

| # | 步骤 | 影响范围 |
|---|---|---|
| 4.1 | `orchestrationService.ts`：新增 `cancelRun`、`publishPlan`、`unlockPlan` 方法 | Frontend Service |
| 4.2 | `orchestrationService.ts`：`PlanStatus` 类型增加 `production` | Frontend Types |
| 4.3 | `orchestrationService.ts`：`normalizePlanStatus` 适配 `production` | Frontend Service |

### 阶段 5：区块组件提取 + Drawer 模式改造（预估 2.5 天）

| # | 步骤 | 影响范围 |
|---|---|---|
| 5.1 | 提取 `PlanHeader.tsx`（含停止运行按钮、发布/解锁按钮） | Frontend |
| 5.2 | 提取 `PlanSummaryCards.tsx` | Frontend |
| 5.3 | 提取 `PlanDraftingBanner.tsx` | Frontend |
| 5.4 | 提取 `PlanTabBar.tsx` | Frontend |
| 5.5 | 提取 `PlanPromptEditor.tsx`（含 production 只读） | Frontend |
| 5.6 | 提取 `AddTaskModal.tsx` | Frontend |
| 5.7 | 提取 `TaskDependencyModal.tsx` | Frontend |
| 5.8 | 提取 `ReplanModal.tsx` | Frontend |
| 5.9 | 实现 `TaskCard.tsx`（简洁摘要模式） | Frontend |
| 5.10 | 实现 `TaskEditDrawer.tsx`（完整编辑 Drawer） | Frontend |
| 5.11 | 提取 `TaskList.tsx`（组合 TaskCard + 工具栏） | Frontend |
| 5.12 | 提取 `PlanSettingsTab.tsx` | Frontend |

### 阶段 6：执行历史组件提取（预估 1 天）

| # | 步骤 | 影响范围 |
|---|---|---|
| 6.1 | 提取 `LatestRunCard.tsx` | Frontend |
| 6.2 | 提取 `RunHistoryList.tsx`（含 cancel 按钮） | Frontend |
| 6.3 | 提取 `RunDetailDrawer.tsx`（含 cancel 按钮） | Frontend |
| 6.4 | 提取 `DebugDrawer.tsx` | Frontend |
| 6.5 | 提取 `PlanHistoryTab.tsx` | Frontend |

### 阶段 7：页面壳组装 + 集成验证（预估 0.5 天）

| # | 步骤 | 影响范围 |
|---|---|---|
| 7.1 | 重写 `PlanDetail.tsx` 页面壳，组合所有子组件和 hooks | Frontend |
| 7.2 | 运行 `npm run build && npm run lint` 确认无编译/类型错误 | Frontend |
| 7.3 | 手动验证全部交互功能（创建/编辑/运行/停止/发布/解锁/调试/历史） | Frontend + Backend |

### 阶段 8：Orchestration.tsx 复用对齐（预估 1 天，可后续迭代）

| # | 步骤 | 影响范围 |
|---|---|---|
| 8.1 | 在 Orchestration.tsx 的计划详情抽屉中复用提取的组件（TaskCard、RunHistoryList 等） | Frontend |
| 8.2 | 逐步消除 Orchestration.tsx 中的重复代码 | Frontend |

---

## 七、风险与注意事项

| 风险项 | 缓解措施 |
|---|---|
| 重构期间功能回归 | 渐进式提取，每步提取后运行 build + lint；组件拆分不改变业务逻辑 |
| 取消 run 时 agent 任务已在执行 | cancelAsyncTask 为 best-effort，agent 侧可能已完成；run_task 状态以编排侧标记为准 |
| production 状态与 scheduler 兼容 | production 计划允许被 scheduler 触发运行；scheduler 不依赖 plan 可编辑性 |
| TaskEditDrawer 与 DebugDrawer 同时打开 | z-index 分层处理（89 vs 90），但交互上应互斥：打开 TaskEditDrawer 时关闭 DebugDrawer，反之亦然 |
| taskEdits state 在 Drawer 模式下的同步 | Drawer 使用同一个 taskEdits state，打开时从中读取，编辑时实时写入，与原 inline 模式共享数据层 |
| production 解锁后立即被误操作 | 解锁前要求确认弹窗，且解锁后 UI 不自动刷新到编辑态（需手动触发） |
| 与 Orchestration.tsx 抽屉的功能对齐 | 阶段 8 专门处理，组件化后可直接在 Orchestration.tsx 中 import 使用 |

---

## 八、关键影响点

| 影响点 | 涉及文件 | 说明 |
|---|---|---|
| **后端 API** | `orchestration.controller.ts` | 新增 3 个端点（cancel/publish/unlock） |
| **后端 Schema** | `orchestration-plan.schema.ts` | PlanStatus 枚举增加 `production` |
| **后端 Service** | `plan-execution.service.ts` | 新增 cancelRun 方法 |
| **后端 Service** | `plan-management.service.ts` | 新增 publish/unlock + production 拦截 |
| **后端 Service** | `task-management.service.ts` | production 状态编辑拦截（已有逻辑无需改动，自动拦截） |
| **后端 Service** | `orchestration-execution-engine.service.ts` | cancellation check 注入 |
| **前端 Service** | `orchestrationService.ts` | 新增 3 个方法 + PlanStatus 类型更新 |
| **前端页面** | `PlanDetail.tsx` | 从 2097 行重构为 ~120 行页面壳 |
| **前端组件** | `components/orchestration/` | 新增 ~19 个组件文件 |
| **前端 Hooks** | `hooks/` | 新增 5 个自定义 hooks |
| **数据库** | `orchestration_plans` | status 枚举增加 `production` |

---

## 九、总预估工时

| 阶段 | 内容 | 预估 |
|---|---|---|
| 阶段 1 | 基础设施（constants/utils/badge） | 0.5 天 |
| 阶段 2 | 自定义 Hooks 提取 | 1 天 |
| 阶段 3 | 后端：停止 Run + Production 状态 | 1.5 天 |
| 阶段 4 | 前端 Service + 类型更新 | 0.5 天 |
| 阶段 5 | 区块组件提取 + Drawer 改造 | 2.5 天 |
| 阶段 6 | 执行历史组件提取 | 1 天 |
| 阶段 7 | 页面壳组装 + 集成验证 | 0.5 天 |
| 阶段 8 | Orchestration.tsx 复用对齐（可延后） | 1 天 |
| **合计** | | **8.5 天**（不含阶段 8 为 7.5 天） |

---

## 十、验收标准

- [ ] `PlanDetail.tsx` 页面壳不超过 150 行，所有子组件/hooks 单文件不超过 200 行
- [ ] 所有现有功能保持正常（任务编辑/运行/调试/重排/历史查看/SSE 流式更新）
- [ ] production 状态下所有编辑操作被拦截（前后端双重校验）
- [ ] 可成功取消 running 状态的 run，取消后 run 状态变为 cancelled，未完成 task 批量标记 cancelled
- [ ] TaskEditDrawer 可正常打开/编辑/保存/关闭，脏状态检测正常
- [ ] `npm run build` 和 `npm run lint` 无报错
- [ ] Orchestration.tsx 列表页详情抽屉可复用提取的组件（阶段 8）

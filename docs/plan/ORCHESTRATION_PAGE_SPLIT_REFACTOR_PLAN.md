# Orchestration 页面拆分重构计划

## 背景

`frontend/src/pages/Orchestration.tsx` 当前为 **2090 行**的单体组件，包含：

- 30 个 `useState`
- 8 个 `useQuery`
- 12 个 `useMutation`
- 6 个 `useEffect`
- 6 个 `useMemo`
- 14 个 handler 函数
- 3 个 Modal + 3 个 Drawer 的 JSX 全部内联
- **0 个子组件提取**

文件过大导致维护困难、职责不清、难以复用，需要拆分。

## 目标目录结构

```
frontend/src/pages/orchestration/
├── index.tsx                          # 主页面（布局 + 组件拼装，~150 行）
├── constants.ts                       # 常量 & 类型定义（~70 行）
├── utils.ts                           # 工具函数（~75 行）
├── hooks/
│   ├── useOrchestrationQueries.ts     # 8 个 useQuery + 派生值（~160 行）
│   ├── useOrchestrationMutations.ts   # 12 个 useMutation + refreshPlanData（~290 行）
│   └── useTaskEditing.ts             # 任务内联编辑状态 + 依赖/移动/排序逻辑（~100 行）
├── components/
│   ├── PlanListTable.tsx              # 计划列表表格（~80 行）
│   ├── CreatePlanModal.tsx            # 创建计划弹窗（~110 行）
│   ├── PlanDetailDrawer/
│   │   ├── index.tsx                  # Drawer 壳 + Tab 切换 + Action Bar（~120 行）
│   │   ├── SettingsTab.tsx            # 任务设置 Tab（~290 行，最大子模块）
│   │   └── HistoryTab.tsx             # 执行历史 Tab（~130 行）
│   ├── AddTaskModal.tsx               # 新增任务弹窗（~85 行）
│   ├── DependencyModal.tsx            # 依赖关系弹窗（~70 行）
│   ├── RunDetailDrawer.tsx            # 执行详情抽屉（~85 行）
│   └── DebugDrawer.tsx                # 调试抽屉（~175 行）
```

## 拆分步骤

### Step 1：提取 constants.ts（类型 + 常量）

**来源**：原文件 L31-96

提取内容：
- `DrawerTab`、`PlanDrawerTab`、`TaskEditableDraft` 类型定义
- `STATUS_COLOR`、`RUN_STATUS_COLOR`、`RUN_STATUS_LABEL`、`TRIGGER_TYPE_LABEL` 映射表
- `PLAN_PROMPT_DRAFT_STORAGE_KEY`、`FULLY_EDITABLE_PLAN_STATUS` 常量
- `DEBUG_RUNTIME_TYPE_OPTIONS`、`TASK_RUNTIME_TYPE_LABEL` 常量

**影响**：零依赖，所有其他模块引用此文件。

---

### Step 2：提取 utils.ts（工具函数）

**来源**：原文件 L98-170

提取内容：
- `formatDateTime` — 日期格式化
- `formatDuration` — 毫秒转可读时长
- `getRunCompletionPercent` — 运行完成百分比
- `extractErrorMessage` — 错误信息提取
- `normalizeIdList` / `normalizeComparableIdList` / `isSameIdList` — ID 列表工具
- `getTaskEditableDraft` — 任务草稿提取
- `isTaskEditable` — 任务可编辑判定

**依赖**：`constants.ts`（`FULLY_EDITABLE_PLAN_STATUS`）、`orchestrationService` 类型。

---

### Step 3：提取 hooks/useOrchestrationQueries.ts

**来源**：原文件 L213-370

提取内容：
- 8 个 `useQuery` 调用（plans、planDetail、planRuns、latestRun、runDetail、runTasks、debugSession、agents/employees）
- 相关 `useMemo` 派生值（debugTask、planTasks、dependencyModalCandidates、isPlanEditable、filteredPlanRuns、latestRunSummary）

**输入参数**：selectedPlanId、selectedRunId、debugSessionId、debugTaskId、debugDrawerOpen、runDetailDrawerOpen、activePlanDrawerTab、runStatusFilter、runTriggerFilter 等。

**返回**：所有 query data + loading/error 状态 + 派生值。

---

### Step 4：提取 hooks/useOrchestrationMutations.ts

**来源**：原文件 L458-744

提取内容：
- `refreshPlanData` 函数
- 12 个 `useMutation`：createPlan、runPlan、savePlanPrompt、replanPlan、retryTask、saveTaskDraft、debugStep、deletePlan、reassign、completeHumanTask、addTask、removeTask、duplicateTask、reorderTasks、batchUpdateTasks

**输入参数**：queryClient、selectedPlanId、各状态 setter。

**返回**：所有 mutation 对象 + refreshPlanData。

---

### Step 5：提取 hooks/useTaskEditing.ts

**来源**：原文件 L782-877（handler 函数部分）

提取内容：
- `taskEdits` 状态管理
- `dirtyTaskUpdates` 计算（useMemo）
- `getEffectiveTaskDraft` / `updateTaskDraftField` / `removeTaskEdit`
- 依赖弹窗状态：`dependencyModalTaskId`、`dependencyModalDraftIds`、open/close/toggle/apply 函数
- `handleMoveTask` / `handleSaveTaskEdits`

**依赖**：`useOrchestrationMutations`（batchUpdateTasks、reorderTasks）、planTasks。

---

### Step 6：提取 6 个 UI 组件

| 组件 | 来源行范围 | 说明 |
|------|-----------|------|
| `PlanListTable` | L944-1019 | 计划列表表格，接收 plans/loading/selectedId/onSelect/onDelete |
| `CreatePlanModal` | L1021-1126 | 创建弹窗，接收 open/onClose/form 状态/onSubmit |
| `PlanDetailDrawer/index` | L1128-1242 + 壳 | Drawer 容器 + ActionBar + Tab 切换 |
| `PlanDetailDrawer/SettingsTab` | L1244-1534 | 最复杂模块：计划信息、Prompt 编辑、任务列表内联编辑 |
| `PlanDetailDrawer/HistoryTab` | L1535-1664 | 最新运行摘要 + 筛选 + 历史列表 |
| `AddTaskModal` | L1672-1755 | 新增任务弹窗 |
| `DependencyModal` | L1757-1824 | 依赖选择弹窗 |
| `RunDetailDrawer` | L1826-1910 | 运行详情抽屉 |
| `DebugDrawer` | L1912-2085 | 调试抽屉（Debug Tab + Session Tab） |

---

### Step 7：精简主页面 index.tsx

主页面职责缩减为：
1. 调用 3 个 custom hooks 获取数据/mutations/编辑状态
2. 管理页面级 UI 状态（selectedPlanId、drawer/modal 开关）
3. 6 个 useEffect 保持不变（挂在主页面或迁入对应 hook）
4. 组合渲染所有子组件，传递 props

预期行数：**~150-200 行**。

## 拆分原则

1. **常量/工具先行** — `constants.ts` 和 `utils.ts` 零外部依赖，最先提取
2. **Hooks 承载逻辑** — 30 个 useState 按职责分散到 3 个 custom hooks，主页面只做组合
3. **组件按 UI 边界切** — 每个 Modal/Drawer 是天然独立渲染单元
4. **SettingsTab 独立文件** — 最大最复杂的 UI 块（内联编辑 + 依赖管理 + 任务列表）
5. **Props 类型显式定义** — 每个子组件定义清晰的 Props interface

## 风险与注意事项

- **路由兼容**：原文件 `export default Orchestration`，拆分后 `orchestration/index.tsx` 需保持相同默认导出，路由配置中引用路径需同步更新
- **状态联动**：30 个 useState 之间存在交叉依赖（如 selectedPlanId 变化重置 drawer 状态），拆分时需确认 useEffect 依赖链不断裂
- **渐进式拆分**：建议每步完成后运行 `npm run build` 验证编译通过，避免一次性大改引入回归

## 预期效果

| 指标 | 拆分前 | 拆分后 |
|------|--------|--------|
| 主文件行数 | 2090 | ~150-200 |
| 最大子文件行数 | - | ~290（SettingsTab） |
| 子组件数 | 0 | 9 |
| Custom Hooks | 0 | 3 |
| 文件总数 | 1 | 14 |

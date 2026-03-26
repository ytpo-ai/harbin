# ORCHESTRATION PAGE SPLIT REFACTOR ARCHITECTURE

> 状态：当前有效（2026-03-26）

## 背景

- 原 `frontend/src/pages/Orchestration.tsx` 为 2000+ 行单体页面，数据查询、变更逻辑、任务编辑状态与 6 个弹层 UI 高度耦合。
- 本次重构按照 `docs/plan/ORCHESTRATION_PAGE_SPLIT_REFACTOR_PLAN.md` 拆分为页面编排层 + hooks + 组件层，降低维护与回归成本。

## 新目录结构

```
frontend/src/pages/orchestration/
├── index.tsx
├── constants.ts
├── utils.ts
├── hooks/
│   ├── useOrchestrationQueries.ts
│   ├── useOrchestrationMutations.ts
│   └── useTaskEditing.ts
└── components/
    ├── PlanListTable.tsx
    ├── CreatePlanModal.tsx
    ├── AddTaskModal.tsx
    ├── DependencyModal.tsx
    ├── RunDetailDrawer.tsx
    ├── DebugDrawer.tsx
    └── PlanDetailDrawer/
        ├── index.tsx
        ├── SettingsTab.tsx
        └── HistoryTab.tsx
```

兼容层：`frontend/src/pages/Orchestration.tsx` 保留为 re-export，继续提供原页面入口。

## 职责划分

### 1) 页面编排层（`index.tsx`）

- 仅承载页面级状态（当前计划、弹窗开关、筛选值、调试输入等）。
- 编排 3 个 hooks 的输入输出。
- 保留跨模块联动的 `useEffect`（计划切换重置、草稿 localStorage 同步、任务集合变化裁剪编辑草稿）。

### 2) 数据查询层（`useOrchestrationQueries.ts`）

- 集中托管计划/运行/调试会话等 query。
- 返回派生值：`debugTask`、`planTasks`、`isPlanEditable`、`filteredPlanRuns`、`latestRunSummary`。

### 3) 写操作层（`useOrchestrationMutations.ts`）

- 集中托管计划创建、重编排、运行、任务增删改重排、调试等 mutation。
- 统一处理 invalidate 与成功/失败 hint。
- 提供 `refreshPlanData` 供页面和子流程复用。

### 4) 任务编辑层（`useTaskEditing.ts`）

- 维护 `taskEdits`、依赖弹窗状态与脏数据计算。
- 封装 `handleMoveTask`、`handleSaveTaskEdits`、依赖选择应用逻辑。

### 5) 组件层（`components/*`）

- 每个 Modal/Drawer 独立成组件，按 UI 边界组织。
- `PlanDetailDrawer/SettingsTab.tsx` 聚合任务编辑复杂 UI。
- `PlanDetailDrawer/HistoryTab.tsx` 聚合 run 历史与筛选 UI。

## 关键约束

- Query key、接口调用、字段结构保持不变，确保后端 API 无需变更。
- 保留本地存储 key：`orchestration-plan-prompt-drafts`。
- 保持路由兼容：外部仍通过 `frontend/src/pages/Orchestration.tsx` 引用页面。

## 验证

- 已执行：`pnpm -C frontend build`（通过）。

# Requirement: ORCHESTRATION_TASK_REQ-003_ADDTASK_ASSIGNEE

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-003 |
| 所属 Feature | [任务编排](../feature/ORCHETRATION_TASK.md) |
| 所属 Plan | [计划执行追加任务指定执行者 & 补充任务](../plan/ORCHESTRATION_TASK_ADDTASK_ASSIGNEE_AND_SUBTASK_PLAN.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | draft |
| 创建日期 | 2026-04-23 |
| 最后更新 | 2026-04-23 |

## 2. 需求描述

### 2.1 背景

前端"添加任务"弹窗（`AddTaskModal`）当前只支持输入标题、描述、优先级和插入位置，不支持指定执行者。但后端 `AddTaskToPlanDto` 已经支持 `assignment` 字段（`executorType` / `executorId` / `reason`），前端 `AddTaskToPlanPayload` 也已定义了 `assignment` 类型。仅需在前端 UI 和调用链上补齐。

### 2.2 目标

用户在"添加任务"弹窗中可以选择执行类型（agent / employee / unassigned）和对应的执行者（Agent 下拉 / Employee 下拉），提交时将 `assignment` 字段透传到后端。

### 2.3 验收条件

- [ ] AddTaskModal 弹窗新增"执行类型"下拉（agent / employee / unassigned）
- [ ] 选择 agent 时显示 Agent 下拉列表（数据来源：`agentService.getAssignableAgents`）
- [ ] 选择 employee 时显示 Employee 下拉列表
- [ ] 选择 unassigned 时不显示执行者下拉
- [ ] 提交时 `assignment` 字段正确传递到后端 API
- [ ] 创建的任务 assignment 字段与用户选择一致（`agent` + `executorId` 时状态为 `assigned`）
- [ ] 新版 `AddTaskModal`（`components/orchestration/`）和旧版（`pages/orchestration/components/`）均需更新

## 3. 技术方案摘要

### 改动范围（仅前端）

1. **`AddTaskModal.tsx`**（两个版本）
   - Props 新增：`agents`、`employees`（可选）、`executorType`、`executorId`、`onChangeExecutorType`、`onChangeExecutorId`
   - 渲染新增：执行类型 `<select>` + 条件渲染 Agent/Employee `<select>`
   - 参考 `SettingsTab.tsx:304-348` 已有的实现模式

2. **`useTaskMutations.ts`**
   - `addTaskMutation` 参数新增 `assignment?: { executorType, executorId }`
   - 调用 `orchestrationService.addTaskToPlan()` 时传递 `assignment`

3. **调用链 props 打通**
   - `PlanDetailTaskOverlays.tsx` 新增 agents/employees props 透传
   - `PlanDetail.tsx` / `orchestration/index.tsx` 等页面传递 agents 数据
   - 新增 state：`newTaskExecutorType`、`newTaskExecutorId`

### 影响范围

- **后端**：无改动（已支持）
- **前端**：`AddTaskModal.tsx`（×2）、`useTaskMutations.ts`、`PlanDetailTaskOverlays.tsx`、页面入口文件
- **数据库**：无改动
- **API**：无改动

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/ORCHESTRATION_TASK_REQ-003_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| — | — | — |

## 5. 备注

- 此需求为纯前端改动，可独立交付，不阻塞 REQ-004（补充任务）
- 执行类型下拉默认值建议为 `unassigned`，与当前行为保持一致

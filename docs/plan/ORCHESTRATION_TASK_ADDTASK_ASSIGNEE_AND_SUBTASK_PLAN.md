# Plan: 计划执行追加任务指定执行者 & 补充任务（子任务）

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [任务编排](../feature/ORCHETRATION_TASK.md) |
| 需求管理 ID | — |
| 所属项目 | — |
| OpenCode Session | — |
| 状态 | approved |
| 优先级 | high |
| 创建日期 | 2026-04-23 |

## 2. 背景

计划执行中存在两个体验缺口：

1. **追加任务时无法指定执行者**：后端 `AddTaskToPlanDto` 和前端 `AddTaskToPlanPayload` 均已支持 `assignment` 字段（executorType / executorId），但前端 `AddTaskModal` 弹窗只有标题、描述、优先级、插入位置四个字段，未渲染执行者选择 UI；`useTaskMutations.ts` 的 `addTaskMutation` 调用 API 时也未传递 `assignment` 参数。

2. **无法为偏差任务创建补充任务**：当一个任务执行结果偏差（如开发任务未创建 commit），用户希望能基于该任务创建一个补充任务（子任务），让执行者继续完成遗漏的工作。补充任务的产出（如 commit）应能聚合到父任务的输出中。当前任务模型是扁平的 Plan → Task[] 一对多关系，没有 `parentTaskId` 字段，不支持父子任务关系。

## 3. 目标

1. 前端"添加任务"弹窗支持选择执行者（agent / employee / unassigned），并将 `assignment` 透传到后端。
2. 支持"补充任务"（子任务）概念：可基于已有任务创建子任务，子任务紧跟父任务排列，子任务的产出可聚合到父任务输出。

## 4. 执行步骤

1. [x] **前端 AddTaskModal 增加执行者选择 UI**
   - 复用 SettingsTab / TaskEditDrawer 中已有的执行类型 + Agent/Employee 下拉模式
   - 在弹窗中新增"执行类型"和"执行者"两个下拉

2. [x] **前端 useTaskMutations 透传 assignment**
   - `addTaskMutation` 的参数和调用增加 `assignment` 字段
   - 调用链上的 state/props 打通（PlanDetailTaskOverlays 等中间层）

3. [ ] **Schema 层新增 parentTaskId 字段**
   - `OrchestrationTask` schema 增加 `parentTaskId?: string`（索引）
   - `OrchestrationRunTask` schema 同步增加

4. [ ] **DTO 层扩展**
   - `AddTaskToPlanDto` 增加 `parentTaskId?: string`
   - 前端 `AddTaskToPlanPayload` 同步增加

5. [ ] **后端 Service 处理子任务逻辑**
   - `addTaskToPlan()` 处理 `parentTaskId`：校验父任务存在且属于同 plan
   - 子任务自动插入到父任务后面
   - 子任务继承父任务的 `projectId`
   - 查询任务列表时包含 `parentTaskId` 信息

6. [ ] **子任务产出聚合**
   - 子任务完成后，将其 output（含 commit 等）追加到父任务的 result 中
   - 在 task lifecycle 事件中处理聚合逻辑

7. [ ] **前端"创建补充任务"入口 & 子任务展示**
   - 任务列表中对 failed/completed 任务增加"创建补充任务"操作按钮
   - 点击后打开 AddTaskModal，自动填入 parentTaskId
   - 任务列表中子任务以缩进样式展示，标注关联的父任务

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-003 | 追加任务指定执行者（前端 UI + 透传） | [链接](../requirement/ORCHESTRATION_TASK_REQ-003_ADDTASK_ASSIGNEE.md) | draft |
| REQ-004 | 补充任务（子任务）全链路支持 | [链接](../requirement/ORCHESTRATION_TASK_REQ-004_SUBTASK_SUPPORT.md) | draft |

## 6. 关键影响点

- **后端/Schema**：`orchestration-task.schema.ts`、`orchestration-run-task.schema.ts` 新增 `parentTaskId` 字段
- **后端/DTO**：`dto/index.ts` 扩展 `AddTaskToPlanDto`
- **后端/Service**：`task-management.service.ts` 子任务插入逻辑、`task-lifecycle.service.ts` 产出聚合
- **前端/组件**：`AddTaskModal.tsx` 增加执行者选择 UI、`TaskList.tsx` 增加补充任务入口和缩进展示
- **前端/Hooks**：`useTaskMutations.ts` 透传 assignment 和 parentTaskId
- **前端/Service**：`orchestrationService.ts` payload 类型更新
- **数据库**：`orchestration_tasks` 集合新增 `parentTaskId` 字段和索引

## 7. 风险与依赖

- **子任务 order 管理**：子任务应紧跟父任务排列，需确保插入和重排逻辑兼容
- **子任务与调度器兼容**：四阶段推进（step dispatcher）需要识别子任务，避免子任务被独立调度为主任务
- **产出聚合边界**：需明确哪些 output 字段参与聚合（如 commit hash），避免覆盖父任务已有输出
- **运行时副本**：创建 RunTask 时需要正确复制 `parentTaskId`

## 8. 备注

- 问题 1（执行者选择）是纯前端改动，后端已完全支持，可优先独立交付
- 问题 2（补充任务）涉及全链路改动，建议分步实现：先完成 Schema + DTO + 基本 CRUD，再做产出聚合和前端展示

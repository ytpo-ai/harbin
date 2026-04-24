# Requirement: ORCHESTRATION_TASK_REQ-005_SUBTASK_PARENT_ROUTER_INHERIT

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-005 |
| 所属 Feature | [任务编排](../feature/ORCHETRATION_TASK.md) |
| 所属 Plan | [补充任务继承父任务 Agent Session Router](../plan/ORCHESTRATION_SUBTASK_PARENT_ROUTER_INHERIT_PLAN.MD) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | draft |
| 创建日期 | 2026-04-25 |
| 最后更新 | 2026-04-25 |

## 2. 需求描述

### 2.1 背景

开发父任务失败后，用户通过“创建补充任务”继续执行。当前子任务容易因执行者/任务类型未继承而脱离 OpenCode 路由，无法完成代码与 git 操作。

### 2.2 目标

1. 开发类子任务自动继承父任务执行上下文，保持同 Agent、同执行路由。
2. 前端创建补充任务时默认带入父任务 Agent，减少手工配置错误。

### 2.3 验收条件

- [ ] 当 `parentTaskId` 对应父任务为 `development.*` 时，子任务自动继承父任务 `assignment(agent)`
- [ ] 当父任务为 `development.*` 时，子任务写入同样的 `taskType/runtimeTaskType`
- [ ] 当父任务存在 `sessionId` 时，子任务写入同 `sessionId`
- [ ] 前端点击“创建补充任务”时，默认选中父任务 Agent
- [ ] 非开发类父任务创建子任务时维持原有行为

## 3. 技术方案摘要

- 后端 `TaskManagementService.addTaskToPlan()` 增加开发子任务继承逻辑。
- 前端两个详情页入口调整“创建补充任务”默认执行者。

## 4. 交付物与追溯

| 文档 | 状态 |
|------|------|
| [开发记录](../development/ORCHESTRATION_TASK_REQ-005_DEVELOPMENT.md) | 待创建 |

## 5. 状态跟踪

| 日期 | 状态 | 说明 |
|------|------|------|
| 2026-04-25 | draft | 完成需求建档，进入开发实现 |

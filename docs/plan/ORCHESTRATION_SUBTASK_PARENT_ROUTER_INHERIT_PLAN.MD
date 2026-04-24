# Plan: 补充任务继承父任务 Agent Session Router

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [任务编排](../feature/ORCHETRATION_TASK.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | approved |
| 优先级 | high |
| 创建日期 | 2026-04-25 |

## 2. 背景

当前补充任务（子任务）用于补救父任务遗漏动作（例如开发任务未提交 commit）。
但子任务创建时默认 `unassigned + general`，导致执行链路容易回落到非 OpenCode 路由，出现 `TASK_INABILITY`，与父任务执行上下文不一致。

## 3. 目标

1. 开发类子任务默认继承父任务的 Agent、任务类型和运行时类型，保持与父任务同路由。
2. 子任务创建入口默认预填父任务 Agent，减少人工误配。
3. 保持对非开发类子任务的现有行为兼容。

## 4. 执行步骤

1. **后端子任务继承规则**
   - 在 `task-management.service.ts` 中，当 `parentTaskId` 存在且父任务为 `development.*` 时：
     - 子任务强制继承父任务 `assignment(agent)`
     - 子任务写入与父任务一致的 `taskType/runtimeTaskType`
     - 子任务复用父任务 `sessionId`（若存在）

2. **前端补充任务默认执行者**
   - 在两个编排详情入口（新旧页面）点击“创建补充任务”时，默认带入父任务 Agent。

3. **验证与回归**
   - 构造开发父任务 + 子任务场景，确认子任务运行时类型为 `development.*` 且执行者与父任务一致。
   - 确认非开发父任务不受影响。

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-005 | 补充任务继承父任务路由上下文 | [链接](../requirement/ORCHESTRATION_TASK_REQ-005_SUBTASK_PARENT_ROUTER_INHERIT.md) | draft |

## 6. 关键影响点

- 后端：`backend/src/modules/orchestration/services/task-management.service.ts`
- 前端：`frontend/src/pages/orchestration/index.tsx`、`frontend/src/pages/PlanDetail.tsx`
- 文档：feature 追溯表、requirement 文档、dailylog

## 7. 风险与回滚

- 风险：父任务不是 Agent 指派时，开发子任务无法满足“同路由”要求。
- 处理：后端在开发子任务继承时做显式校验并返回可解释错误。
- 回滚：若出现兼容问题，可先回滚“强制继承”逻辑，保留前端默认预填方案。

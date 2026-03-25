# 定时计划绑定编排计划优化方案

> 状态：**已废弃（被 SCHEDULER_SERVICE_REFACTOR_PLAN 替代）**
>
> 说明：当前 Scheduler 已改为“按时向 Agent 发送 inner-message”的模型，`planId` 不再作为创建/执行的必填锚点。

## 需求目标

将“定时计划”收敛为纯触发器能力：创建定时器时不再指定 Agent，必须绑定已存在的编排计划（plan），由调度器按计划触发执行。

## 执行步骤

1. 调整 Scheduler DTO 与校验规则：`CreateSchedule` 强制 `planId` 必填，移除（或禁用）创建/更新入参中的 `target` 指定能力。
2. 调整后端创建与更新流程：创建/更新 schedule 时校验 `planId` 对应 plan 存在，并将 `planId` 持久化为唯一执行锚点。
3. 调整调度触发语义：定时器触发统一走 `executePlanRun(planId, 'schedule')`，不再依赖“定时器指定 agent”的执行路径。
4. 调整前端定时服务页：新建/编辑弹窗移除 Agent 选择，新增并强制“关联编排计划”选择。
5. 调整列表与详情展示：突出 schedule 与 plan 的绑定关系，支持快速跳转到计划详情。
6. 回归验证与文档同步：执行 lint/typecheck/build（按模块可执行性），更新 `docs/feature/ORCHETRATION_SCHEDULER.md` 与当日日志。

## 关键影响点

- 后端：`backend/src/modules/orchestration/scheduler/dto/index.ts`、`backend/src/modules/orchestration/scheduler/scheduler.service.ts`
- 前端：`frontend/src/pages/Scheduler.tsx`、`frontend/src/services/schedulerService.ts`
- 文档：`docs/feature/ORCHETRATION_SCHEDULER.md`、`docs/dailylog/day/`
- API：`POST/PUT /orchestration/schedules` 入参约束变化（`planId` 必填，移除 `target`）

## 风险与依赖

- 历史 schedule 可能存在未绑定 plan 的存量数据，需要兼容读取并在编辑时引导补齐。
- 若某些系统 schedule 仍依赖旧的 target/input 语义，需要保留运行时兼容，避免影响现网定时任务。

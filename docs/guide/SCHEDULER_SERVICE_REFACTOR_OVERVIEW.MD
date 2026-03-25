# SCHEDULER SERVICE REFACTOR OVERVIEW

## 模块落点

- Scheduler 模块从 `backend/src/modules/orchestration/scheduler/` 迁移为一级模块：`backend/src/modules/scheduler/`。
- `AppModule` 只注册 `SchedulerModule`，旧目录代码已移除。

## 职责边界

- 新职责：只负责调度 + 发送 inner-message。
- 移除职责：不再直接调用 `OrchestrationService.executePlanRun/executeStandaloneTask`，不再直接调用 `executeTool` 或 memo queue。

## 新执行链路

1. Scheduler 定时触发
2. `dispatchToAgent()` 发送 `POST /api/inner-messages/direct`
3. agents app dispatcher 投递
4. runtime bridge 根据 `schedule.*` eventType 构建 prompt 并执行

## 关键结构变化

- 新 schema：`backend/src/shared/schemas/schedule.schema.ts`
- 集合保持：`orchestration_schedules`
- 新字段：`message.eventType/title`
- `planId` 保留为 deprecated 兼容字段，不作为查询/执行入口

## 路由与兼容

- 主路由：`/schedules/*`
- 兼容路由：`/orchestration/schedules/*`（同一 controller 双前缀）

## Seed 变化

- 文件：`backend/scripts/seed/system-schedule.ts`
- 6 个系统 schedule 统一写入 `target + input + message`
- seed 不再依赖 system plan，也不再设置 planId

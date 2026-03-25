# 定时调度（Scheduler）

> 状态：当前有效（2026-03-26）

## 1. 功能范围

- Scheduler 已从 orchestration 子目录迁出，作为 legacy app 一级模块独立运行。
- 核心职责收敛为“按时向 Agent 发送 inner-message”。
- 不再直接执行 Orchestration Plan/Task，不依赖 `OrchestrationService` 运行入口。

## 2. 当前实现结构

### 2.1 后端模块

| 维度 | 路径 | 说明 |
|---|---|---|
| 模块 | `backend/src/modules/scheduler/` | `scheduler.module.ts` / `scheduler.controller.ts` / `scheduler.service.ts` |
| Schema | `backend/src/shared/schemas/schedule.schema.ts` | 主 Schema，集合名仍为 `orchestration_schedules` |
| 兼容导出 | `backend/src/shared/schemas/orchestration-schedule.schema.ts` | 兼容旧 import |

### 2.2 前端模块

- 页面：`frontend/src/pages/Scheduler.tsx`
- 服务：`frontend/src/services/schedulerService.ts`

## 3. 执行链路

1. cron/interval 到点，或调用 `POST /schedules/:id/trigger` 手动触发。
2. `SchedulerService` 获取锁并组装 inner-message。
3. 调用 `AgentClientService.sendDirectInnerMessage()` 发送给目标 Agent。
4. agents app 通过 inner-message dispatcher/runtime bridge 执行。
5. Scheduler 轮询消息终态并异步回写 `lastRun` 与统计。
6. 历史查询优先读取 `source=scheduler` 且 `payload.scheduleId` 的 inner-message。

## 4. 关键字段

- `schedule`: `cron | interval`
- `target.executorId`: 目标 Agent
- `input.prompt` / `input.payload`: 发送给 Agent 的指令参数
- `message.eventType` / `message.title`: 消息事件类型与标题（默认 `schedule.trigger`）
- `planId`: deprecated，仅兼容保留，不再作为执行依赖

## 5. API 清单（当前有效）

### 5.1 主路由

主路由为 `/schedules/*`，同时保留 `/orchestration/schedules/*` 兼容别名。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/schedules` | 创建 |
| GET | `/schedules` | 列表 |
| GET | `/schedules/:id` | 详情 |
| PUT | `/schedules/:id` | 更新 |
| DELETE | `/schedules/:id` | 删除 |
| POST | `/schedules/:id/enable` | 启用 |
| POST | `/schedules/:id/disable` | 停用 |
| POST | `/schedules/:id/trigger` | 手动触发 |
| GET | `/schedules/:id/history` | 调度历史 |

### 5.2 系统调度端点

- `GET /schedules/system/engineering-statistics`
- `POST /schedules/system/engineering-statistics/trigger`
- `GET /schedules/system/docs-heat`
- `POST /schedules/system/docs-heat/trigger`

## 6. 文档状态治理（plan / guide / technical）

### 6.1 当前有效文档

- 功能文档：`docs/feature/ORCHETRATION_SCHEDULER.md`
- Plan：
  - `docs/plan/SCHEDULER_SERVICE_REFACTOR_PLAN.md`
  - `docs/plan/SCHEDULER_PAGE_OPTIMIZATION_PLAN.md`
- Technical：`docs/technical/SCHEDULER_SERVICE_REFACTOR_TECHNICAL_DESIGN.md`

### 6.2 已废弃文档（归档参考）

- `docs/plan/ORCHESTRATION_SCHEDULER_MODULE_PLAN.md`
- `docs/plan/ORCHESTRATION_SCHEDULER_MCP_PLAN.md`
- `docs/plan/ORCHESTRATION_SCHEDULER_PLAN_BINDING_OPTIMIZATION_PLAN.md`
- `docs/technical/ORCHESTRATION_SCHEDULER_TECHNICAL_DESIGN.md`

## 7. 关联功能文档

- 任务编排主文档：`docs/feature/ORCHETRATION_TASK.md`
- Agent 协作消息：`docs/feature/INNER_MESSAGE.md`

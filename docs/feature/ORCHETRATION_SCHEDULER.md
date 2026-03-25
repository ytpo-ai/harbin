# 定时调度（Scheduler）

## 1. 功能设计

### 1.1 目标

- Scheduler 独立为 legacy 一级模块，职责收敛为“按时向 Agent 发送 inner-message”。
- 不再直接执行 Orchestration Plan / Task，不再依赖 OrchestrationService 执行入口。
- Agent 收到 `schedule.*` 消息后自主调用工具/执行流程。

### 1.2 模块与数据模型

| 维度 | 路径 | 说明 |
|------|------|------|
| 模块 | `backend/src/modules/scheduler/` | `scheduler.module.ts` / `scheduler.controller.ts` / `scheduler.service.ts` |
| Schema | `backend/src/shared/schemas/schedule.schema.ts` | 新主 Schema，集合仍为 `orchestration_schedules` |
| 兼容导出 | `backend/src/shared/schemas/orchestration-schedule.schema.ts` | 向后兼容旧 import |

#### Schedule 核心字段

- `schedule`: `cron | interval`
- `target.executorId`: 接收消息的 Agent
- `input.prompt/payload`: 传递给 Agent 的指令和参数
- `message.eventType/title`: inner-message 事件类型和标题（默认 `schedule.trigger`）
- `planId`: deprecated（保留兼容，不再作为调度执行依赖）

### 1.3 执行链路

1. cron/interval 或手动触发 `POST /schedules/:id/trigger`
2. SchedulerService 获取锁并组装 message
3. 调用 `AgentClientService.sendDirectInnerMessage()`
4. agents app 通过 inner-message dispatcher/runtime bridge 投递并执行
5. Scheduler 轮询 inner-message 状态并异步回写 `lastRun`（语义为“消息处理终态”）与 `stats`
6. 历史查询优先读取 inner-message（`source=scheduler` + `payload.scheduleId`）

### 1.4 重试与失败策略

- Scheduler 不做执行层重试，统一依赖 inner-message `maxAttempts`。
- 发送失败、处理失败或生命周期监控超时时，写入 `deadLetters` 并触发告警 webhook。

### 1.5 API 路由

主路由为 `/schedules/*`，同时保留 `/orchestration/schedules/*` 兼容别名。

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/schedules` | 创建 |
| GET | `/schedules` | 列表 |
| GET | `/schedules/:id` | 详情 |
| PUT | `/schedules/:id` | 更新 |
| DELETE | `/schedules/:id` | 删除 |
| POST | `/schedules/:id/enable` | 启用 |
| POST | `/schedules/:id/disable` | 停用 |
| POST | `/schedules/:id/trigger` | 手动触发 |
| GET | `/schedules/:id/history` | 调度历史 |

系统调度端点：

- `GET /schedules/system/engineering-statistics`
- `POST /schedules/system/engineering-statistics/trigger`
- `GET /schedules/system/docs-heat`
- `POST /schedules/system/docs-heat/trigger`

## 2. 前端

- 页面：`frontend/src/pages/Scheduler.tsx`
- 服务：`frontend/src/services/schedulerService.ts`
- 新建/编辑项：
  - Agent 选择（`target.executorId`）
  - 消息 eventType（`message.eventType`）
  - 保留调度规则、prompt/payload

## 3. 相关代码文件

### 后端

- `backend/src/modules/scheduler/scheduler.module.ts`
- `backend/src/modules/scheduler/scheduler.controller.ts`
- `backend/src/modules/scheduler/scheduler.service.ts`
- `backend/src/modules/scheduler/dto/index.ts`
- `backend/src/modules/agents-client/agent-client.service.ts`
- `backend/apps/agents/src/modules/inner-message/inner-message-agent-runtime-bridge.service.ts`
- `backend/scripts/seed/system-schedule.ts`

### 前端

- `frontend/src/pages/Scheduler.tsx`
- `frontend/src/services/schedulerService.ts`

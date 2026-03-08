# 定时调度（Orchestration Scheduler）

## 1. 功能设计

### 1.1 目标

- 提供独立的定时服务管理模块，支持为 Agent 配置周期任务（如每 2 小时巡检）。
- 将“计划定义”和“执行记录”拆分：`orchestration_schedule` 表示调度计划，`orchestration_task` 表示每次落地执行。
- 与现有编排执行链路兼容，避免重复实现任务执行逻辑。

### 1.2 数据结构

核心集合位于 `backend/src/shared/schemas/`：

| 集合 | Schema 文件 | 说明 |
|------|-------------|------|
| `orchestration_schedules` | `orchestration-schedule.schema.ts` | 定时计划定义（cron/interval、目标 agent、启停、最近执行状态） |
| `orchestration_tasks` | `orchestration-task.schema.ts` | 执行记录；新增 `mode=plan|schedule` 与 `scheduleId` |

#### OrchestrationSchedule 核心字段

- `name/description`: 计划基本信息
- `schedule`: 调度配置（`type=cron|interval`，`expression|intervalMs`，`timezone`）
- `target`: 执行目标（当前固定 `executorType=agent`）
- `input`: 执行输入（`prompt/payload`）
- `enabled/status`: 启停与运行态（`idle/running/paused/error`）
- `lastRun/nextRunAt/stats`: 最近执行、下次执行、统计信息

#### OrchestrationTask 模式字段

- `mode='plan'`: 传统编排任务，关联 `planId`
- `mode='schedule'`: 定时触发任务，关联 `scheduleId`

### 1.3 核心逻辑

1. 创建 schedule 后，Scheduler 服务按配置注册 cron/interval 定时器。
2. 触发时创建一条 `mode=schedule` 的 `orchestration_task`。
3. 执行复用 `OrchestrationService` 现有执行能力（Agent 调用、状态流转、结果落库）。
4. 回写 `schedule.lastRun/stats/nextRunAt`。
5. 支持手动触发、启停、删除与执行历史查询。

### 1.4 API 接口

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/orchestration/schedules` | 创建定时计划 |
| GET | `/orchestration/schedules` | 获取计划列表 |
| GET | `/orchestration/schedules/:id` | 获取计划详情 |
| PUT | `/orchestration/schedules/:id` | 更新计划 |
| DELETE | `/orchestration/schedules/:id` | 删除计划 |
| POST | `/orchestration/schedules/:id/enable` | 启用计划 |
| POST | `/orchestration/schedules/:id/disable` | 停用计划 |
| POST | `/orchestration/schedules/:id/trigger` | 手动触发 |
| GET | `/orchestration/schedules/:id/history` | 查询执行历史 |

---

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `ORCHESTRATION_SCHEDULER_MODULE_PLAN.md` | Scheduler 模块实施计划 |

### 技术文档 (docs/technical/)

| 文件 | 说明 |
|------|------|
| `ORCHESTRATION_SCHEDULER_TECHNICAL_DESIGN.md` | Scheduler 技术设计与时序说明 |

---

## 3. 相关代码文件

### 后端 (backend/src/)

| 文件 | 功能 |
|------|------|
| `modules/orchestration/scheduler/scheduler.module.ts` | Scheduler 模块装配 |
| `modules/orchestration/scheduler/scheduler.controller.ts` | Scheduler API 控制器 |
| `modules/orchestration/scheduler/scheduler.service.ts` | 调度注册、触发、执行回写 |
| `modules/orchestration/scheduler/dto/index.ts` | Scheduler DTO |
| `shared/schemas/orchestration-schedule.schema.ts` | 定时计划数据模型 |
| `shared/schemas/orchestration-task.schema.ts` | task 新增 `mode/scheduleId` 字段 |
| `modules/orchestration/orchestration.service.ts` | 暴露 standalone task 执行能力 |

### 前端 (frontend/src/)

| 文件 | 功能 |
|------|------|
| `pages/Scheduler.tsx` | 定时服务管理页面 |
| `services/schedulerService.ts` | Scheduler API 服务封装 |
| `App.tsx` | 路由注册 (`/scheduler`) |
| `components/Layout.tsx` | 侧边栏入口（定时服务） |

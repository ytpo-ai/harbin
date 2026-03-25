# [已弃用] ORCHESTRATION_SCHEDULER_TECHNICAL_DESIGN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Orchestration Scheduler 技术设计

## 1. 设计目标与边界

### 1.1 目标

- 提供独立的定时计划管理能力，支持 cron 与固定间隔触发。
- 保持执行链路复用：调度触发后仍落到 `orchestration_task` 执行体系。
- 支持可观测与可运维：启停、手动触发、最近执行结果、执行历史。
- 支持重启恢复与并发防重入，确保调度稳定性。

### 1.2 非目标

- 不在本阶段引入复杂工作流编排（多级 schedule 依赖、窗口期策略）。
- 不在本阶段引入跨实例分布式调度（先支持单实例语义）。

---

## 2. 数据模型设计

### 2.1 `orchestration_schedule`

建议新增 Schema：`backend/src/shared/schemas/orchestration-schedule.schema.ts`

```typescript
type ScheduleType = 'cron' | 'interval';
type ScheduleStatus = 'idle' | 'running' | 'paused' | 'error';

interface OrchestrationSchedule {
  name: string;
  description?: string;

  schedule: {
    type: ScheduleType;
    expression?: string;   // cron only
    intervalMs?: number;   // interval only
    timezone?: string;     // default: Asia/Shanghai
  };

  target: {
    executorType: 'agent';
    executorId: string;
    executorName?: string;
  };

  input: {
    prompt?: string;
    payload?: Record<string, unknown>;
  };

  enabled: boolean;
  status: ScheduleStatus;
  nextRunAt?: Date;

  lastRun?: {
    startedAt?: Date;
    completedAt?: Date;
    success?: boolean;
    result?: string;
    error?: string;
    taskId?: string;
    sessionId?: string;
  };

  stats?: {
    totalRuns: number;
    successRuns: number;
    failedRuns: number;
    skippedRuns: number;
  };

  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

索引建议：

- `{ enabled: 1, updatedAt: -1 }`
- `{ 'target.executorId': 1, enabled: 1 }`
- `{ nextRunAt: 1 }`

### 2.2 `orchestration_task` 增量字段

在 `backend/src/shared/schemas/orchestration-task.schema.ts` 新增：

```typescript
mode: 'plan' | 'schedule'; // default: 'plan'
scheduleId?: string;       // mode='schedule' 时必填
```

兼容策略：历史数据默认视为 `mode=plan`。

---

## 3. 模块与组件设计

## 3.1 目录建议

```
backend/src/modules/orchestration/scheduler/
├── scheduler.module.ts
├── scheduler.controller.ts
├── scheduler.service.ts
├── scheduler-dispatcher.service.ts
└── dto/
    ├── create-schedule.dto.ts
    ├── update-schedule.dto.ts
    ├── trigger-schedule.dto.ts
    └── index.ts
```

### 3.2 组件职责

- `SchedulerService`：schedule CRUD、启停、加载恢复、下次执行时间计算。
- `SchedulerDispatcherService`：调度触发执行、重入保护、执行结果回写。
- `SchedulerController`：提供 REST 接口，复用现有鉴权模式。

---

## 4. 执行时序

### 4.1 自动触发

1. 应用启动，`SchedulerService.onModuleInit()` 加载 `enabled=true` 的 schedule。
2. 为每个 schedule 注册 cron/interval handler。
3. 到达触发时间，`SchedulerDispatcherService.trigger(scheduleId)` 执行：
   - 原子检查是否可执行（防重入）
   - 写入 `schedule.status=running` 与 `lastRun.startedAt`
   - 创建 `orchestration_task`（`mode=schedule`, `scheduleId=...`）
   - 调用既有任务执行能力
   - 回写 `lastRun`、`stats`、`nextRunAt`，`status` 复原为 `idle|error`

### 4.2 手动触发

- `POST /orchestration/schedules/:id/trigger`
- 与自动触发共用 dispatcher 路径，保障行为一致。

---

## 5. API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/orchestration/schedules` | 创建定时计划 |
| GET | `/orchestration/schedules` | 计划列表 |
| GET | `/orchestration/schedules/:id` | 计划详情 |
| PUT | `/orchestration/schedules/:id` | 更新计划 |
| DELETE | `/orchestration/schedules/:id` | 删除计划 |
| POST | `/orchestration/schedules/:id/enable` | 启用计划 |
| POST | `/orchestration/schedules/:id/disable` | 停用计划 |
| POST | `/orchestration/schedules/:id/trigger` | 手动触发一次 |
| GET | `/orchestration/schedules/:id/history` | 查询执行历史（基于 task） |

DTO 约束建议：

- `schedule.type=cron` 时 `expression` 必填，`intervalMs` 禁填。
- `schedule.type=interval` 时 `intervalMs` 必填（最小建议 60s），`expression` 禁填。
- `target.executorType` 当前固定为 `agent`。

---

## 6. 并发与可靠性

### 6.1 防重入

- 使用原子更新条件防重入：仅当 `status in (idle,error)` 时切换到 `running`。
- 若已经 `running`，记录一次 `skippedRuns` 并返回。

### 6.2 重启恢复

- `enabled=true` 的计划在启动时全部重建本地定时器。
- 为避免重复注册，先清理同 id 的旧注册，再重建。

### 6.3 错误处理

- 执行异常时写入 `lastRun.error` 与 `status=error`。
- 下次触发前自动尝试恢复到 `running`，无需人工先重置。

---

## 7. 前端方案

### 7.1 页面结构

- 新页面：`frontend/src/pages/Scheduler.tsx`
- 功能区块：
  - 计划列表（状态、下次执行、最近执行）
  - 新建/编辑表单（cron/interval 切换）
  - 操作区（启停、手动触发、删除）
  - 历史区（最近 N 条 task 执行记录）

### 7.2 服务层

- 新增 `frontend/src/services/schedulerService.ts`，对接 scheduler API。
- 路由新增 `/scheduler`，并在 `Layout` 导航增加入口。

---

## 8. 可观测性与审计

- Schedule 维度：`enabled/status/nextRunAt/lastRun/stats`。
- Task 维度：通过 `mode=schedule + scheduleId` 可追溯每次执行明细。
- 日志建议字段：`scheduleId`, `triggerType(auto|manual)`, `taskId`, `durationMs`, `error`。

---

## 9. 迁移与兼容

1. 先上线 schema 增量字段（`orchestration_task.mode/scheduleId`），默认兼容旧数据。
2. 再上线 scheduler 模块与 API。
3. 最后上线前端页面入口。

回滚策略：

- 若 scheduler 模块异常，可仅下线路由与 controller，保留 task 扩展字段不影响旧流程。

---

## 10. 后续可优化项

1. 分布式锁：多副本部署时引入 Redis 锁，避免重复触发。
2. 失火补偿：记录 miss fire 并按策略补跑。
3. 任务模板化：支持 schedule 绑定固定执行模板，而非自由 prompt。
4. 告警集成：连续失败阈值告警（Webhook/消息中心）。

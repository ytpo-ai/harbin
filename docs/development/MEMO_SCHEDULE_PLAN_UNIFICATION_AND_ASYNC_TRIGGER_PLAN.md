# Memo 调度数据化与异步触发开发沉淀

## 1. 背景与目标

- 将系统默认 schedule/plan 从“启动副作用写库”调整为“seed 数据资产管理”。
- 将 memo 聚合触发从 scheduler 同步 HTTP 调用切换为异步消息触发。
- 移除进程内 memo 定时器，统一使用 orchestration schedule 承载定时任务。

## 2. 核心实现

### 2.1 启动阶段去写库副作用

- `SchedulerService.onModuleInit` 仅加载并注册数据库中 `enabled=true` 的 schedule。
- 启动时增加缺失系统 schedule 告警，不再自动创建数据。

### 2.2 系统 schedule seed 脚本化

- 新增 `backend/scripts/system-schedule-seed.ts`，统一幂等 upsert：
  - `system-meeting-monitor`
  - `system-engineering-statistics`
  - `system-memo-event-flush`
  - `system-memo-full-aggregation`
- `manual-seed` 改为直接调用脚本 seed，不再通过 scheduler runtime service 写库。

### 2.3 MemoSchedulerService 下线

- 删除 `memo-scheduler.service.ts`，移除 module/provider 注入与生命周期调用。
- memo 定时调度入口改为 system schedule seed 数据。

### 2.4 memo 异步消息触发

- legacy scheduler 触发 memo schedule 时不再同步调用 agents API，改为投递 Redis 命令队列。
- agents 侧新增命令消费器：
  - 消费 `flush_events` / `full_aggregation`
  - 执行后发布结果事件
  - 失败重试、超过阈值进入 dead-letter
  - 基于 `requestId` 做去重保护

## 3. 关键文件

- 后端调度：
  - `backend/src/modules/orchestration/scheduler/scheduler.service.ts`
  - `backend/src/modules/orchestration/scheduler/scheduler.module.ts`
- seed：
  - `backend/scripts/manual-seed.ts`
  - `backend/scripts/system-schedule-seed.ts`
- memo 异步触发：
  - `backend/src/modules/agents-client/agent-client.service.ts`
  - `backend/apps/agents/src/modules/memos/memo-aggregation-command-consumer.service.ts`
  - `backend/apps/agents/src/modules/memos/memo.module.ts`
- 公共与基础设施：
  - `backend/libs/common/src/memo-aggregation.constants.ts`
  - `backend/libs/common/src/index.ts`
  - `backend/libs/infra/src/redis.service.ts`

## 4. 验证结果

- `npm run build`（legacy）通过。
- `npm run build:agents` 通过。
- `npm run seed:manual -- --only=system-schedules --dry-run` 通过。

## 5. 运维说明

- 新环境或配置变更后，需显式执行：
  - `npm run seed:system-schedules`
- 系统 schedule 缺失时，服务会告警提示补种。

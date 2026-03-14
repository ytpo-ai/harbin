# Memo 调度数据化与异步触发统一改造计划

## 1. 需求理解

- 系统默认调度（meeting monitor、engineering statistics、memo 聚合）应视为数据库内的系统数据资产，而非服务启动副作用。
- `MemoSchedulerService` 当前仍通过进程内 `setInterval` 定时触发，不符合“schedule plan 统一管理”的目标。
- `SystemScheduleBootstrapService` 当前在启动阶段执行 ensure，会产生“启动即写库”的副作用；期望改为 seed 管理。
- `agentClientService.flushMemoEvents()` / `triggerMemoFullAggregation()` 当前为同步 HTTP 调用，期望改为异步消息触发，降低跨服务耦合与超时失败风险。

## 2. 目标

1. 系统 schedule/plan 统一由 seed 脚本幂等写入与维护。
2. 服务启动阶段仅注册数据库中 `enabled=true` 的 schedule，不再自动创建系统数据。
3. memo 定时聚合统一纳入 orchestration schedule/plan 数据模型，移除 `MemoSchedulerService` 的进程内 timer。
4. memo 聚合触发链路改为异步消息（命令消息 + 消费执行 + 结果事件），支持重试与死信治理。

## 3. 执行步骤

1. 盘点并固化系统 schedule 与 plan 的稳定标识
   - 统一约定 `plan.metadata.systemKey` 与 `schedule.name` 作为幂等主键。
   - 补齐 memo 两类系统计划：
     - `system-memo-event-flush`
     - `system-memo-full-aggregation`
2. 建设统一 seed 能力（脚本 + 服务）
   - 在 backend seed 脚本中新增系统调度 seed 条目，统一覆盖 meeting monitor / engineering statistics / memo flush / memo full。
   - seed 行为采用 upsert，重复执行不产生重复数据，仅更新配置漂移字段（cron/interval/timezone/target/input/enabled）。
3. 启动流程去副作用
   - `SchedulerService.onModuleInit` 改为仅加载并注册已有 schedule。
   - 移除启动时 `ensureSystemSchedules()` 的自动写库调用。
   - 保留缺失关键系统 schedule 的日志告警，提示运维执行 seed。
4. MemoSchedulerService 下线与调度统一
   - 移除 `MemoSchedulerService` 注入与 `start/stop` 生命周期调用。
   - 用系统 schedule 驱动 memo flush/full 两类任务。
5. memo 聚合触发改为异步消息
   - 生产端（legacy backend）发布消息：
     - `memo.flush.requested`
     - `memo.full_aggregation.requested`
   - 消费端（agents app）订阅并执行对应聚合逻辑。
   - 执行后发布结果事件：
     - `memo.flush.completed|failed`
     - `memo.full_aggregation.completed|failed`
   - 增加幂等字段 `requestId` 与最小失败治理（重试/死信/日志）。
6. 文档与运维流程同步
   - 更新功能文档：`AGENT_MEMO`、`ORCHETRATION_SCHEDULER`、`MEETING_CHAT`。
   - 更新 dailylog：记录“启动去副作用 + seed 数据化 + 异步消息触发”。
   - 在部署说明中明确：上线后必须执行系统 schedule seed。

## 4. 关键影响点

- 后端 legacy：`orchestration/scheduler`、`agents-client`、seed 脚本。
- agents app：`memos` 模块新增消息消费触发能力。
- 数据库：`orchestration_plans`、`orchestration_schedules` 新增/更新系统内置记录。
- 配置：memo 定时配置从进程开关迁移为 schedule 数据开关（`enabled`）。
- 文档：功能设计、运维步骤、当日日志。

## 5. 风险与依赖

- 风险：若部署漏跑 seed，系统默认调度会缺失。
  - 兜底：启动告警 + 手动 seed 指令。
- 风险：异步链路是最终一致性，触发后非即时完成。
  - 兜底：执行状态通过 schedule task + 结果事件可观测。
- 风险：消息消费异常可能导致任务堆积或丢失。
  - 兜底：幂等键、重试、死信与告警。
- 依赖：Redis 可用性与跨服务订阅通道稳定性。

## 6. 验证标准

- 空库执行 seed 后，四类系统 schedule/plan 创建完整。
- 重复执行 seed 不重复插入，且会修正配置漂移。
- 服务启动不再自动创建系统 schedule/plan，仅做注册。
- memo schedule 触发后通过异步消息完成聚合，主流程无同步等待。
- 消费失败场景可看到失败日志/死信记录，并支持后续补偿。

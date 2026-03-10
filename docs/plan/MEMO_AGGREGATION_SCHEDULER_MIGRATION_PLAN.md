# Memo 聚合调度迁移计划

## 背景

- 现有 `MemoAggregationService` 内部通过 `setInterval` 触发聚合。
- 需要将定时触发统一收敛到编排调度模块，避免多处定时职责分散。

## 目标

- 停止 memo 模块内部定时器。
- 由 `orchestration/scheduler` 模块承接 memo 事件聚合与全量聚合定时触发。
- 保持 identity/evaluation 聚合能力与手动触发能力可用。

## 执行步骤

1. 移除 `MemoAggregationService` 内部定时器初始化与清理逻辑，仅保留事件监听与聚合能力。
2. 在 agents memo 控制器新增全量聚合触发接口：`POST /api/memos/aggregation/full`。
3. 在 backend `AgentClientService` 新增 memo 聚合调用方法：
   - `flushMemoEvents()` -> `/api/memos/events/flush`
   - `triggerMemoFullAggregation()` -> `/api/memos/aggregation/full`
4. 在 `orchestration/scheduler` 模块新增 memo 定时任务启动逻辑：
   - 事件 flush 周期：`MEMO_AGGREGATION_INTERVAL_MS`
   - 全量聚合周期：`MEMO_FULL_AGGREGATION_INTERVAL_MS`
   - 开关：`MEMO_SCHEDULER_ENABLED`
5. 更新功能文档与日常进度记录，明确“定时职责迁移”后的边界。

## 影响点

- 后端/API：新增 memo 全量聚合接口。
- 调度模块：新增 memo 聚合定时触发。
- 配置：新增/启用 `MEMO_SCHEDULER_ENABLED`，并复用两个 memo 聚合周期配置。
- 文档：`docs/features/AGENT_MEMO.md`、`docs/daily_logs/`。

## 风险与回滚

- 风险：若调度模块未启动或开关关闭，memo 定时聚合将不会自动执行。
- 风险：跨服务调用失败会导致周期任务跳过，需要通过日志观察告警。
- 回滚：可恢复 `MemoAggregationService` 内部定时器逻辑，或手动调用聚合接口临时兜底。

## 当前状态

- [x] 方案确认
- [x] 代码改造完成
- [x] 文档更新完成

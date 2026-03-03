# Agent Runtime Hooks Guide

## 1. 事件消费幂等建议

- Runtime Hooks 为至少一次投递语义（at-least-once）。
- 外部消费者必须使用 `eventId` 做去重，推荐在消费侧保留短期去重表（例如 Redis set，TTL 24h）。
- 如果业务需要严格顺序，使用 `(runId, sequence)` 做顺序校验，遇到乱序时先缓存后补齐。

示例（伪代码）：

```ts
function onRuntimeEvent(event) {
  if (isProcessed(event.eventId)) return;
  markProcessed(event.eventId, 24 * 60 * 60);

  const lastSeq = getLastSequence(event.runId);
  if (event.sequence < lastSeq) return;

  applyEvent(event);
  setLastSequence(event.runId, event.sequence);
}
```

## 2. 事件重放建议

- 使用 `POST /agents/runtime/runs/:runId/replay` 按需重放。
- 优先按 `eventTypes` 和 `fromSequence` 控制范围，避免大批量无效重放。
- 外部修复场景推荐：
  - 先回放 `tool.*` 事件补齐工具状态
  - 再回放 `run.*` 事件对齐最终态

## 2.1 死信重投建议

- 查看死信：`GET /agents/runtime/outbox/dead-letter`
- 按范围重投：`POST /agents/runtime/outbox/dead-letter/requeue`
- 优先按 `runId` + `eventType` 小范围重投，避免全量重投导致消费峰值。

## 3. 可观测性指标

通过 `GET /agents/runtime/metrics` 关注：

- `hookDispatcher.published`: 正常发布计数
- `hookDispatcher.failed`: 正常发布失败计数
- `hookDispatcher.replayPublished`: 回放发布计数
- `hookDispatcher.replayFailed`: 回放发布失败计数
- `outbox.pending`: 待派发事件量
- `outbox.failed`: 待重试失败事件量

建议告警阈值：

- `outbox.pending > 1000` 持续 5 分钟
- `hookDispatcher.failed` 每分钟增长超过 50
- `outbox.failed` 连续增长且 `dispatched` 无增长

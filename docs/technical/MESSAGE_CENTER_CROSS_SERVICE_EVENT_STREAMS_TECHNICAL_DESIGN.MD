# Message Center Cross-Service Event Streams Technical Design

## 1. 目标

- 建立跨服务统一消息中心事件协议，替代服务间直连 Hook。
- 通过 Redis Streams + Consumer Group 提供可追踪消费与失败隔离能力。
- 保持前端消息读取与交互接口不变。

## 2. 事件契约

定义文件：`backend/libs/infra/src/message-center-events.ts`

### 2.1 Envelope（v1）

```json
{
  "eventId": "uuid",
  "eventType": "meeting.session.ended | engineering.tool.completed",
  "version": "v1",
  "occurredAt": "ISO8601",
  "source": "service-name",
  "traceId": "uuid",
  "data": {
    "receiverId": "employee_xxx",
    "messageType": "engineering_statistics | orchestration | system_alert",
    "title": "...",
    "content": "...",
    "bizKey": "...",
    "actionUrl": "...",
    "priority": "low | normal | high",
    "extra": {}
  }
}
```

### 2.2 校验策略

- 消费侧强制校验 `eventId/eventType/version/occurredAt/source/traceId/data.*`。
- `version` 当前仅允许 `v1`。
- 未通过校验事件写入 DLQ，不进入业务写库。

## 3. Redis Streams 设计

- 主 Stream：`streams:message-center:events`
- Consumer Group：`message-center-group`
- DLQ Stream：`streams:message-center:events:dlq`

`RedisService` 新增能力：

- `xadd`
- `xgroupCreate`
- `xreadgroup`
- `xack`

## 4. 消费者处理流程

实现：`backend/src/modules/message-center/message-center-event-consumer.service.ts`

1. `xgroupCreate` 确保消费组存在。
2. `xreadgroup` 拉取事件批次。
3. 解析 `event` 字段 JSON。
4. 契约校验。
5. 调用 `MessageCenterService.createSystemMessage` 写库。
6. 成功后 `xack`；失败写 DLQ 后 `xack`。

## 5. 幂等模型

模型：`backend/src/shared/schemas/system-message.schema.ts`

- 新增字段：`eventId`、`dedupKey`
- 唯一索引：
  - `{ eventId: 1 }`（sparse unique）
  - `{ receiverId: 1, type: 1, dedupKey: 1 }`（sparse unique）

服务：`backend/src/modules/message-center/message-center.service.ts`

- 插入冲突（`code=11000`）时回查既有记录并返回，避免重复写入/重复推送。

## 6. 生产者实现

### 6.1 EI

- 文件：`backend/apps/ei/src/services/statistics.service.ts`
- 事件：`engineering.tool.completed`
- 行为：快照终态后发布事件；发布失败仅记日志，不回写污染统计终态。

### 6.2 Meeting

- 文件：`backend/src/modules/meetings/services/meeting-message-center-event.service.ts`
- 事件：`meeting.session.ended`
- 行为：会议结束后按员工维度发布通知事件；发布失败非阻塞。

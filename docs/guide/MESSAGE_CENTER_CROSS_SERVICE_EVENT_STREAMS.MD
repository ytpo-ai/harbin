# MESSAGE_CENTER_CROSS_SERVICE_EVENT_STREAMS

## 1. 模块定位

- Message Center 跨服务系统通知统一改为 Redis Streams 事件消费写库。
- legacy `message-center` 模块仅负责消费、校验、幂等落库和 WS 推送。
- EI 与 Meeting 作为事件生产方，只负责发布标准事件，不直接写消息中心。

## 2. 关键链路

1. 业务服务发布事件到 `streams:message-center:events`。
2. legacy 消费组 `message-center-group` 拉取事件。
3. 事件契约校验通过后映射为 `createSystemMessage` 入参。
4. 写入 `system_messages` 后复用原有 WS 推送（`message-center.message.created`）。

## 3. 首批事件

- `engineering.tool.completed`
  - 生产方：`backend/apps/ei/src/services/ei.service.ts`
  - 语义：工程工具/统计任务完成（成功或失败）通知。
- `meeting.session.ended`
  - 生产方：`backend/src/modules/meetings/services/meeting-message-center-event.service.ts`
  - 语义：会议结束后向参会员工发送系统通知。

## 4. 幂等与一致性

- 事件幂等主键：`eventId`。
- 业务幂等键：`receiverId + type + dedupKey`。
- `system_messages` 新增唯一索引：
  - `{ eventId: 1 }`（sparse unique）
  - `{ receiverId: 1, type: 1, dedupKey: 1 }`（sparse unique）

## 5. 关键代码位置

- 统一契约：`backend/libs/infra/src/message-center-events.ts`
- Redis Streams 能力：`backend/libs/infra/src/redis.service.ts`
- 消费者：`backend/src/modules/message-center/message-center-event-consumer.service.ts`
- 消息写入幂等：`backend/src/modules/message-center/message-center.service.ts`
- 消息模型索引：`backend/src/shared/schemas/system-message.schema.ts`

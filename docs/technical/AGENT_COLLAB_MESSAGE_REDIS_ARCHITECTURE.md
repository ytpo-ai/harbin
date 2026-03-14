# Agent 协作消息 Redis 架构设计

## 1. 背景与目标

为支持 Agent 间协作，系统需要统一的消息机制，覆盖：

- 订阅模式（事件驱动）：事件发布后由分发服务匹配订阅者并投递。
- 直发模式（点对点）：Agent A 直接发送给 Agent B。

核心目标：

1. 统一消息生命周期管理（可追踪、可审计、可重试）。
2. 发送链路 Redis 化（异步解耦，降低业务模块耦合）。
3. 收到即回执，保证状态及时更新。

## 2. 总体架构

```text
Producer (orchestration / agent api)
  -> MongoDB (message status=sent)
  -> Redis Queue (agent:message:dispatch)
      -> MessageDispatcherConsumer
         -> SubscriptionMatcher (for publish mode)
         -> Redis Pub/Sub (agent:inbox:{agentId})
         -> Ack/Process API update Mongo status
```

说明：

- 所有消息都先落库，再入 Redis 队列，保证可补偿。
- 分发消费者为唯一分发入口，负责订阅匹配与投递。
- 订阅者收到消息后，立即调用 ACK 接口把消息置为 `delivered/processing`。

## 3. 数据模型

## 3.1 `agent_collaboration_messages`

核心字段：

- `messageId`：业务消息 ID（UUID）
- `mode`：`direct | subscription`
- `eventType`：例如 `task.created`、`task.status.changed`、`task.completed`、`task.exception`、`task.failed`
- `senderAgentId` / `receiverAgentId`
- `title` / `content` / `payload`
- `status`：`sent | delivered | processing | processed | failed`
- `sentAt` / `deliveredAt` / `processingAt` / `processedAt` / `failedAt`
- `attempt` / `maxAttempts`
- `dedupKey`：投递幂等键
- `source`：来源模块（如 `orchestration`）

建议索引：

1. `{ receiverAgentId: 1, status: 1, createdAt: -1 }`
2. `{ senderAgentId: 1, createdAt: -1 }`
3. `{ eventType: 1, createdAt: -1 }`
4. `{ dedupKey: 1 }` unique sparse
5. `{ messageId: 1 }` unique

## 3.2 `agent_message_subscriptions`

核心字段：

- `subscriptionId`（UUID）
- `subscriberAgentId`
- `eventType`
- `filters`（可选，JSON）
- `isActive`

建议索引：

1. `{ subscriberAgentId: 1, isActive: 1 }`
2. `{ eventType: 1, isActive: 1 }`
3. `{ subscriberAgentId: 1, eventType: 1 }` unique

## 4. Redis 设计

队列键：

- `agent:message:dispatch`：主分发队列
- `agent:message:dispatch:dead-letter`：死信队列

频道键：

- `agent:inbox:{agentId}`：Agent 实时收件频道

消息 envelope 建议：

```json
{
  "dispatchId": "uuid",
  "mode": "direct",
  "messageId": "uuid",
  "eventType": "task.created",
  "senderAgentId": "cto",
  "receiverAgentId": "coder-lzw",
  "attempt": 1,
  "maxAttempts": 3,
  "createdAt": "2026-03-15T00:00:00.000Z"
}
```

## 5. 核心流程

## 5.1 直发消息流程

1. A 调用 `POST /agent-messages/direct`。
2. 服务落库 `status=sent`。
3. 推送 dispatch envelope 到 Redis 队列。
4. 分发消费者读取后推送 `agent:inbox:B`。
5. B 收到后立即 ACK（`delivered/processing`）。
6. B 处理完成后调用 processed 接口，状态变更为 `processed`。

## 5.2 订阅消息流程

1. 发布方调用 `POST /agent-messages/publish`。
2. 分发服务查找 `eventType` 活跃订阅者。
3. 为每个订阅者生成消息记录并入队。
4. 分发消费者逐条投递到订阅者 inbox。
5. 订阅者 ACK 后更新状态。

## 6. 状态机

- `sent`：已落库并入队。
- `delivered`：订阅者已接收并回执。
- `processing`：订阅者开始处理。
- `processed`：订阅者处理完成。
- `failed`：投递或处理失败。

状态迁移约束：

- `sent -> delivered -> processing -> processed`
- 任意中间状态可到 `failed`
- 禁止终态回退（`processed/failed` 不可逆）

## 7. 可靠性与幂等

1. 先落库后入队，避免消息丢失。
2. 幂等键去重，避免重复消费导致重复投递。
3. 消费失败按 `attempt/maxAttempts` 重试。
4. 超过重试上限写入死信队列并更新消息 `failed`。

## 8. 编排场景接入

## 8.1 编排任务事件 -> CTO 订阅

- 编排侧发布任务生命周期事件：
  - `task.created`
  - `task.status.changed`
  - `task.completed`
  - `task.exception`
  - `task.failed`
- CTO Agent 通过订阅（可带 `planId` 过滤）接收上述 Hook + 消息。

## 8.2 Agent 协作消息（拟人协作）

- CTO 收到 `task.created` 后，可通过 `direct` 消息通知执行 Agent。
- 执行 Agent 收到后回 ACK（`delivered/processing`）。
- 执行完成后，执行 Agent 还可直发一条完成消息给 CTO（与任务事件订阅并存）。
- 当前落地包含自动协作编排器：监听 `orchestration:task-events`，在 `task.created` 自动触发 `cto -> executor` 直发与 `executor -> cto` 已收到回执；在 `task.completed` 自动触发 `executor -> cto` 完成汇报消息。

## 9. 可观测性

- 日志维度：`messageId/dispatchId/eventType/receiverAgentId/attempt`。
- 运营指标：
  - 队列堆积长度
  - 投递成功率
  - 平均投递延迟
  - 死信数量

## 10. 安全与边界

1. API 层限制 sender 身份伪造（服务端填充/校验）。
2. 禁止跨组织投递（后续可加 organizationId 维度）。
3. payload 需限制体积并脱敏敏感字段。

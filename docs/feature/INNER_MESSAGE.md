# Inner Message（Agent 内部协作消息）

## 1. 功能设计

### 1.1 目标

- 提供 Agent 内部协作消息机制，支持 Agent 间直发与事件订阅分发。
- 通过 Redis 异步分发降低业务模块耦合，提升消息投递吞吐与可扩展性。
- 建立消息状态闭环（发送、接收回执、处理完成），便于追踪协作执行。

### 1.2 数据结构

- `inner_messages`
  - 关键字段：`messageId`、`mode`、`eventType`、`senderAgentId`、`receiverAgentId`、`status`
  - 状态：`sent | delivered | processing | processed | failed`
- `inner_message_subscriptions`
  - 关键字段：`subscriptionId`、`subscriberAgentId`、`eventType`、`filters`、`isActive`

### 1.3 核心逻辑

- 直发模式（direct）
  - Agent A 发给 B：先落库 `sent`，再写入 Redis 分发队列。
  - 分发消费者投递到 `inner:inbox:{agentId}`。
  - 接收方收到后调用 ACK 接口更新为 `delivered/processing`，处理完成后标记 `processed`。
- 订阅模式（subscription）
  - 发布事件后由分发服务匹配 `eventType` 订阅者。
  - 为每个订阅者生成消息记录并投递。
- 任务事件解耦
  - 编排侧只发布任务领域事件（`task.created/task.status.changed/task.completed/task.exception/task.failed`）。
  - CTO/其他 Agent 通过订阅接收 Hook + 消息，不在编排服务内硬编码收件人。
- 自动协作编排器
  - 监听任务 Hook 事件。
  - `task.created` 后自动执行 `CTO -> 执行Agent` 任务沟通消息，并触发执行 Agent 回执“已收到”。
  - `task.completed` 后自动执行 `执行Agent -> CTO` 完成汇报消息。
- 可靠性
  - 消费失败重试（attempt/maxAttempts）
  - 超过重试次数进入死信队列
  - 支持 `dedupKey` 做幂等去重

### 1.4 编排集成

- Orchestration 发布任务生命周期事件，供订阅者消费。
- 协作直发（如 CTO -> coder-lzw、coder-lzw -> CTO）由 Agent 侧流程通过 `direct` 接口发起。
- Message Center 页面通过 `GET /message-center/inner-messages` 提供内部消息只读展示入口（按当前登录员工绑定 Agent 过滤）。

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `plan/AGENT_COLLAB_MESSAGE_REDIS_PLAN.md` | Agent 协作消息 Redis 化实施计划 |

### 技术文档 (docs/technical/)

| 文件 | 说明 |
|------|------|
| `technical/AGENT_COLLAB_MESSAGE_REDIS_ARCHITECTURE.md` | Agent 协作消息整体架构、状态机、Redis 队列设计 |

### API 文档 (docs/api/)

| 文件 | 说明 |
|------|------|
| `api/legacy-api.md` | Agent 消息与订阅管理接口清单 |

## 3. 相关代码文件

### 后端（legacy）

| 路径 | 功能 |
|------|------|
| `backend/src/modules/inner-message/inner-message.controller.ts` | 直发/发布/ACK/订阅接口 |
| `backend/src/modules/inner-message/inner-message.service.ts` | 消息落库、订阅匹配、状态流转、入队 |
| `backend/src/modules/inner-message/inner-message-dispatcher.service.ts` | Redis 分发消费者（重试/死信） |
| `backend/src/modules/inner-message/inner-message-collaboration-automation.service.ts` | 任务事件到拟人协作消息的自动编排 |
| `backend/src/modules/inner-message/inner-message.module.ts` | 模块装配 |
| `backend/src/shared/schemas/inner-message.schema.ts` | Inner Message 模型 |
| `backend/src/shared/schemas/inner-message-subscription.schema.ts` | 订阅模型 |
| `backend/src/modules/orchestration/orchestration.service.ts` | 分配/完成事件的消息联动 |
| `backend/src/modules/message-center/message-center.controller.ts` | 内部消息分页查询转发接口 |
| `frontend/src/pages/MessageCenter.tsx` | 内部消息 Tab 展示 |

# Agent 协作消息（Redis 分发）实施计划

## 1. 需求理解

- 目标：为系统新增 Agent 内部协作消息机制，支持两类通信路径：
  - 订阅模式：事件先进入消息分发服务，由分发服务匹配订阅并投递给订阅者。
  - 直发模式：Agent A 直接向 Agent B 发送消息。
- 关键约束：
  - 消息发送链路通过 Redis。
  - 订阅模式下，分发服务统一管理全部订阅关系。
  - 订阅者收到消息后应第一时间更新消息状态。
  - 直发消息需先落库为已发送，接收方收到后更新状态并处理。

## 2. 范围界定

### 2.1 In Scope

1. 新增 Agent 协作消息数据模型（消息主表 + 订阅表）。
2. 新增消息分发服务（Redis 队列消费 + 订阅匹配 + 投递）。
3. 新增消息发布 API（直发/发布事件）、订阅管理 API、消息状态回执 API。
4. 打通编排任务关键链路：
   - 任务分配后通知被分配 Agent。
   - 开发任务完成后通知 CTO Agent。
5. 增加幂等去重、失败重试与死信队列基础能力。
6. 更新功能文档与 API 文档。

### 2.2 Out of Scope

1. 不在本轮实现复杂规则引擎（如表达式订阅 DSL）。
2. 不在本轮实现多租户分区策略（预留字段）。
3. 不在本轮实现前端完整消息可视化页面（后续按需接入）。

## 3. 执行步骤

1. 数据层设计与落地
   - 新增 `agent_collaboration_messages`：记录消息生命周期与收发关系。
   - 新增 `agent_message_subscriptions`：记录事件订阅关系。
   - 增加必要索引（receiver/status/eventType/dedupKey）。
2. 消息分发服务实现
   - 定义 Redis 队列键：主队列、重试队列、死信队列。
   - 所有消息统一进入队列，由分发消费者处理。
   - 订阅模式：匹配订阅后为每个订阅者落库并投递。
   - 直发模式：读取已发送消息并投递给目标 Agent。
3. API 与服务边界
   - `POST /agent-messages/direct`
   - `POST /agent-messages/publish`
   - `POST /agent-message-subscriptions`
   - `GET /agent-message-subscriptions`
   - `PATCH /agent-messages/:messageId/ack`
   - `PATCH /agent-messages/:messageId/processed`
4. 编排集成
   - 任务创建/重分配时，若分配到 agent，发送 `task.assigned`。
   - 任务执行成功后，发送 `task.completed` 给 CTO Agent（可配置）。
5. 可靠性机制
   - 幂等键去重（消息投递维度）。
   - 消费失败重试（带 attempt/maxAttempts）。
   - 超限进入死信队列并落库错误信息。
6. 测试与文档
   - 增加服务级单测（订阅匹配、状态迁移、重试路径）。
   - 更新 `docs/feature` 与 `docs/api` 说明。
   - 记录 `docs/dailylog` 当日开发影响范围。

## 4. 关键影响点

- 后端
  - `backend/src/modules/orchestration`（任务分配/完成触发消息）
  - 新增 `backend/src/modules/agent-messages`（分发与状态管理）
  - 新增 `backend/src/shared/schemas` 消息与订阅模型
- Redis
  - 新增 Agent 消息分发队列与死信队列
- 文档
  - `docs/technical/` 架构文档
  - `docs/feature/` 功能文档
  - `docs/api/` 接口文档

## 5. 风险与依赖

1. Redis 不可用导致消息堆积或丢投
   - 缓解：先落库，再入队；失败可补偿重放。
2. 重复消费导致重复投递
   - 缓解：`dedupKey` + 唯一索引 + 幂等更新。
3. CTO 目标 Agent 标识不稳定
   - 缓解：支持环境变量 `ORCHESTRATION_CTO_AGENT_ID`，并提供兜底解析。
4. 高并发下消息状态竞争
   - 缓解：状态迁移使用条件更新（按当前状态 CAS）。

## 6. 验收标准

1. 直发消息可完成 `sent -> delivered -> processing -> processed` 状态流转。
2. 订阅模式下，发布事件可命中订阅并向订阅者生成消息记录。
3. 编排任务分配后，目标 Agent 可收到 `task.assigned` 消息。
4. 编排任务完成后，CTO Agent 可收到 `task.completed` 回执消息。
5. 重试与死信链路可观测（日志与数据库状态可追踪）。

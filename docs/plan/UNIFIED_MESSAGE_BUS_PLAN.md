# 统一消息总线（Unified Message Bus）设计与落地计划

> 状态：Phase 1-3 已完成，Phase 4-6 待执行  
> 创建时间：2026-04-07  
> Phase 1 完成时间：2026-04-07  
> Phase 2 完成时间：2026-04-07  
> Phase 3 完成时间：2026-04-07  
> 更新时间：2026-04-07（补充 agents → EI 解耦规划）

---

## 1. 背景与动机

### 1.1 现状问题

当前项目消息传递存在 **三种并行模式**，各自直接依赖 `RedisService` 底层方法，无统一抽象：

| 模式 | 使用方式 | 问题 |
|---|---|---|
| **Redis Pub/Sub** | `redisService.publish()` / `subscribe()` | 消费者离线丢消息，无 ack，无重试，无追踪 |
| **Redis List Queue** | `redisService.lpush()` / `brpop()` | 各服务自建 while 循环 + 手写重试/DLQ，代码重复 |
| **Redis Streams** | `redisService.xadd()` / `xreadgroup()` / `xack()` | 仅 message-center 和 channel 在用，模式最成熟但未推广 |

此外，`RuntimeEiSyncService` 使用 **HTTP 轮询推送** 将 runtime 事件同步到 EI 服务，存在 400 校验失败、重试不可控、与 outbox 分发链路割裂等问题。

### 1.2 目标

1. **统一接口**：定义 `MessageBus` port 接口，业务代码面向接口编程，不感知底层中间件。
2. **可插拔适配器**：首批实现 `RedisPubSubAdapter`、`RedisStreamAdapter`，后续可扩展 `RabbitMqAdapter`、`KafkaAdapter`。
3. **投递语义分级**：明确区分 `fire-and-forget`（实时通知）和 `reliable`（至少一次投递）两种模式。
4. **渐进式迁移**：先改造 runtime outbox + EI sync 链路，验证后逐步覆盖其他管道。
5. **Agents → EI 解耦**：删除 agents 对 EI 的 HTTP 推送依赖，runtime 数据同步统一走消息总线；MCP 工具的同步请求-响应调用暂保留 HTTP。

---

## 2. 现有消息管道盘点

### 2.1 Redis Pub/Sub（fire-and-forget）

| Channel 模式 | 生产方 | 消费方 | 用途 |
|---|---|---|---|
| `agent-runtime:{agentId}` | `HookDispatcherService` | 前端 SSE Gateway | runtime 实时事件推送 |
| `agent-task-events:{taskId}` | `AgentTaskService` | `RuntimeSseStreamService` | 任务 SSE 事件 |
| `meeting:{meetingId}` | `MeetingEventService` | `ChannelMeetingRelayService` | 会议实时事件 |
| `channel:outbound:feishu` | `InnerMsgAgentRuntimeBridgeSvc` | `ChannelOutboundWorkerService` | 飞书出站消息 |
| `orchestration:task-events` | `InnerMessageService` | `InnerMsgCollabAutomationSvc` | 编排任务生命周期 |
| `ws:system` / `ws:user:{id}` / `ws:feature:{f}:{e}` | `WsMessageService` | WS Gateway | WebSocket 推送 |
| `memo:write:result` / `memo:aggregation:result` | 各 Consumer | （结果监听） | 完成通知 |

### 2.2 Redis List Queue（lpush/brpop + 手写 DLQ）

| Queue Key | 生产方 | 消费方 | DLQ Key |
|---|---|---|---|
| `queue:memo:write:commands` | `MemoWriteQueueService` | `MemoWriteCommandConsumerSvc` | `queue:memo:write:dead-letter` |
| `queue:memo:aggregation:commands` | `AgentClientService` | `MemoAggregationCommandConsumerSvc` | `queue:memo:aggregation:dead-letter` |
| `queue:runtime:memo-snapshot:commands` | `RuntimeMemoSnapshotQueueSvc` | 同上 | `queue:runtime:memo-snapshot:dead-letter` |
| `inner:message:dispatch` | `InnerMessageService` | `InnerMessageDispatcherSvc` | `inner:message:dispatch:dead-letter` |
| `agent-task:queue` | `AgentTaskService` | `AgentTaskWorker` | — |
| `channel:inbound:queue` | `ChannelInboundService` | `ChannelInboundWorkerSvc` | — |

### 2.3 Redis Streams（xadd/xreadgroup/xack + Consumer Group）

| Stream Key | 生产方 | Consumer Group | 消费方 | DLQ Stream |
|---|---|---|---|---|
| `streams:message-center:events` | Scheduler / Orchestration / Meeting / EI / ActionLog | `message-center-group` | `MessageCenterEventConsumerSvc` | `streams:message-center:events:dlq` |
| `streams:channel:events` | `MessageCenterEventConsumerSvc` | `channel-group` | `ChannelDispatcherService` | `streams:channel:events:dlq` |

### 2.4 HTTP 推送（待迁移）

| 链路 | 生产方 | 消费方 | 问题 |
|---|---|---|---|
| `/ei/sync-batches` | `RuntimeEiSyncService`（agents app） | `EiOpencodeSyncService`（EI app） | 400 校验失败、重试重、与 outbox 割裂 |

### 2.5 Agents → EI 全部 HTTP 调用盘点

Agents 模块对 EI 的 HTTP 依赖共 **11 个端点**，分布在 3 个服务类中：

#### 2.5.1 `RuntimeEiSyncService`（异步推送，待迁移到消息总线）

| HTTP 方法 | EI 端点 | 用途 | 是否需要同步返回 | 迁移策略 |
|---|---|---|---|---|
| `POST` | `/ei/sync-batches` | Agent Run 事件同步 | 仅读 `duplicate` 标记 | **迁移到 `runtime.ei-sync` Stream** |

- 文件：`backend/apps/agents/src/modules/runtime/runtime-ei-sync.service.ts:69`
- 触发点：`agent-executor.service.ts:347/373/463/473`（run 终态后 `scheduleRunSync`）
- **所有 executionChannel（native + opencode）的 run 都走此链路**，并非仅 opencode

#### 2.5.2 `RdIntelligenceToolHandler`（MCP 工具，同步调用，暂保留 HTTP）

| HTTP 方法 | EI 端点 | 用途 | 是否需要同步返回 | 迁移策略 |
|---|---|---|---|---|
| `POST` | `/ei/statistics/snapshots` | 触发工作区统计快照 | **是**（返回快照数据给 agent） | 暂保留 HTTP |
| `POST` | `/ei/docs-heat/refresh` | 触发文档热度刷新 | **是**（返回热度排名给 agent） | 暂保留 HTTP |

- 文件：`backend/apps/agents/src/modules/tools/builtin/engineering-statistics-tool-handler.service.ts:25/44`
- 经由：`internal-api-client.service.ts:120/132`（独立 axios 调用，无重试）

#### 2.5.3 `RequirementToolHandler`（MCP 工具，同步调用，暂保留 HTTP）

| HTTP 方法 | EI 端点 | 用途 | 是否需要同步返回 | 迁移策略 |
|---|---|---|---|---|
| `GET` | `/ei/requirements/board` | 看板视图 | **是** | 暂保留 HTTP |
| `GET` | `/ei/requirements?params` | 需求列表 | **是** | 暂保留 HTTP |
| `GET` | `/ei/requirements/:id` | 需求详情 | **是** | 暂保留 HTTP |
| `POST` | `/ei/requirements` | 创建需求 | **是** | 暂保留 HTTP |
| `POST` | `/ei/requirements/:id/status` | 更新状态 | **是** | 暂保留 HTTP |
| `POST` | `/ei/requirements/:id/assign` | 分配需求 | **是** | 暂保留 HTTP |
| `POST` | `/ei/requirements/:id/comments` | 添加评论 | **是** | 暂保留 HTTP |
| `POST` | `/ei/requirements/:id/github/sync` | GitHub 同步 | **是** | 暂保留 HTTP |

- 文件：`backend/apps/agents/src/modules/tools/builtin/engineering-requirement-tool-handler.service.ts`
- 经由：`internal-api-client.service.ts:59`（`callEiApi()` 含 502/503/504 重试）

#### 2.5.4 解耦决策总结

| 类别 | 端点数 | 当前传输 | 迁移策略 | 原因 |
|---|---|---|---|---|
| Runtime 数据同步 | 1 | HTTP 轮询推送 | **→ Redis Stream** | 异步、无需返回值、可靠投递 |
| MCP 工具调用 | 10 | HTTP 同步 | **暂保留 HTTP** | 请求-响应模式，agent 需同步拿结果 |

> **后续评估**：MCP 工具如需进一步解耦（如 agents 不直接知道 EI 地址），可考虑走 Gateway 代理或引入 request-reply 消息模式，但优先级低于 runtime sync 链路改造。

---

## 3. 统一消息总线架构设计

### 3.1 分层架构

```
┌─────────────────────────────────────────────────────┐
│  业务层（Business Services）                         │
│  HookDispatcher / EiSync / MemoQueue / InnerMsg ... │
│        ↓ 面向接口调用                                │
├─────────────────────────────────────────────────────┤
│  MessageBus Port（统一接口）                          │
│  publish() / subscribe() / ack() / nack()           │
│  createProducer() / createConsumer()                │
│        ↓ 按 topic 路由到适配器                       │
├─────────────────────────────────────────────────────┤
│  Topic Router（路由层）                               │
│  topicName → { adapter, deliveryMode, options }     │
│        ↓                                            │
├──────────────┬──────────────┬───────────────────────┤
│ RedisPubSub  │ RedisStream  │ RabbitMQ (future)     │
│  Adapter     │  Adapter     │  Adapter              │
│ fire-forget  │ reliable     │ reliable + routing    │
└──────────────┴──────────────┴───────────────────────┘
         ↓              ↓               ↓
       Redis          Redis           RabbitMQ
      pub/sub        streams         exchanges
```

### 3.2 核心接口定义

文件位置：`backend/libs/infra/src/messaging/`

#### 3.2.1 统一消息信封（MessageEnvelope）

```typescript
// messaging/message-envelope.ts

interface MessageEnvelope<T = unknown> {
  /** 全局唯一消息 ID，用于幂等 */
  messageId: string;
  /** topic 名称，路由到对应适配器 */
  topic: string;
  /** 消息体 */
  payload: T;
  /** 追踪信息 */
  headers: MessageHeaders;
  /** 消息创建时间 ISO8601 */
  timestamp: string;
}

interface MessageHeaders {
  /** 分布式追踪 ID */
  traceId?: string;
  /** 消息分区键（用于保序） */
  partitionKey?: string;
  /** 来源服务标识 */
  source?: string;
  /** schema 版本号 */
  schemaVersion?: string;
  /** 重试计数（由框架自动管理） */
  retryCount?: number;
  /** 原始 messageId（重试时保留首次 ID） */
  correlationId?: string;
  /** 自定义扩展头 */
  [key: string]: unknown;
}
```

#### 3.2.2 MessageBus 接口（Port）

```typescript
// messaging/message-bus.port.ts

interface MessageBus {
  /**
   * 发布消息到指定 topic。
   * - fire-and-forget 模式：不等待消费确认，适合实时通知
   * - reliable 模式：保证至少一次投递，支持 ack/nack
   */
  publish<T>(topic: string, message: PublishInput<T>): Promise<PublishResult>;

  /**
   * 订阅指定 topic。
   * 返回 Subscription 对象用于取消订阅。
   */
  subscribe<T>(
    topic: string,
    handler: MessageHandler<T>,
    options?: SubscribeOptions,
  ): Promise<Subscription>;
}

interface PublishInput<T> {
  payload: T;
  headers?: Partial<MessageHeaders>;
  /** 覆盖默认分区键 */
  partitionKey?: string;
}

interface PublishResult {
  messageId: string;
  /** stream 模式下为 stream entry ID */
  sequenceId?: string;
  accepted: boolean;
}

interface MessageHandler<T> {
  (context: MessageContext<T>): Promise<void>;
}

interface MessageContext<T> {
  envelope: MessageEnvelope<T>;
  /** 确认消费成功（reliable 模式） */
  ack(): Promise<void>;
  /** 拒绝消费，触发重试或进入 DLQ（reliable 模式） */
  nack(reason?: string): Promise<void>;
}

interface SubscribeOptions {
  /** Consumer group 名称（reliable 模式必填） */
  group?: string;
  /** Consumer 实例名称 */
  consumer?: string;
  /** 批量拉取大小 */
  batchSize?: number;
  /** 阻塞等待超时 ms */
  blockMs?: number;
}

interface Subscription {
  unsubscribe(): Promise<void>;
}
```

#### 3.2.3 Topic 路由配置

```typescript
// messaging/topic-registry.ts

type DeliveryMode = 'fire-and-forget' | 'reliable';
type AdapterType = 'redis-pubsub' | 'redis-stream' | 'rabbitmq';

interface TopicConfig {
  /** topic 名称 */
  name: string;
  /** 投递语义 */
  deliveryMode: DeliveryMode;
  /** 首选适配器 */
  adapter: AdapterType;
  /** Stream/Queue 的底层 key（可选，默认基于 topic 名称生成） */
  backendKey?: string;
  /** Consumer group（reliable 模式） */
  consumerGroup?: string;
  /** DLQ stream/queue key */
  dlqKey?: string;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试退避基数 ms */
  retryBackoffMs?: number;
  /** Stream maxLen（防止无限增长） */
  maxLen?: number;
}
```

#### 3.2.4 适配器接口

```typescript
// messaging/message-adapter.port.ts

interface MessageAdapter {
  readonly type: AdapterType;

  publish(envelope: MessageEnvelope, config: TopicConfig): Promise<PublishResult>;

  subscribe(
    config: TopicConfig,
    handler: MessageHandler<unknown>,
    options?: SubscribeOptions,
  ): Promise<Subscription>;

  /** 健康探针 */
  healthCheck(): Promise<{ healthy: boolean; details?: string }>;
}
```

### 3.3 Topic 规划（首批）

| Topic 名称 | 模式 | 适配器 | 底层 Key | Consumer Group | DLQ | 现有链路 |
|---|---|---|---|---|---|---|
| `runtime.events` | fire-and-forget | redis-pubsub | `agent-runtime:{partitionKey}` | — | — | HookDispatcher → SSE |
| `runtime.ei-sync` | reliable | redis-stream | `streams:runtime:ei-sync` | `ei-sync-group` | `streams:runtime:ei-sync:dlq` | **新增**，替代 HTTP push |
| `message-center.events` | reliable | redis-stream | `streams:message-center:events` | `message-center-group` | `streams:message-center:events:dlq` | 已有，纳入总线管理 |
| `channel.events` | reliable | redis-stream | `streams:channel:events` | `channel-group` | `streams:channel:events:dlq` | 已有，纳入总线管理 |
| `task.events` | fire-and-forget | redis-pubsub | `agent-task-events:{partitionKey}` | — | — | AgentTask → SSE |
| `meeting.events` | fire-and-forget | redis-pubsub | `meeting:{partitionKey}` | — | — | MeetingEvent → Relay |

> **后续批次**（第二阶段再迁移）：memo-write-queue、memo-aggregation、inner-message-dispatch、channel-inbound 等 lpush/brpop 队列。

### 3.4 适配器实现要点

#### RedisPubSubAdapter

- `publish`：`redisService.publish(backendKey, JSON.stringify(envelope))`
- `subscribe`：`redisService.subscribe(backendKey, listener)`
- `ack/nack`：空操作（fire-and-forget 无确认语义）
- 向后兼容：保留与现有 `agent-runtime:{agentId}` 完全相同的 channel 名和 payload 格式，前端 SSE 无需改动

#### RedisStreamAdapter

- `publish`：`redisService.xadd(backendKey, fields, { maxLen })`
- `subscribe`：
  - `xgroupCreate` 确保 consumer group
  - `while(running)` 循环 `xreadgroup` 拉取
  - 成功 `handler()` 后 `xack`
  - 失败按 `maxRetries` 重试，超阈值 `xadd` 到 DLQ stream
- 幂等：消费方通过 `messageId`（= `envelope.messageId`）做幂等去重

#### RabbitMqAdapter（未来扩展预留）

- 接口已定义，实现推迟到实际引入 RabbitMQ 时
- 预期映射：topic → exchange（topic 类型），consumerGroup → queue binding
- 切换方式：仅改 topic 路由配置，不改业务代码

---

## 4. Runtime EI Sync 改造方案

### 4.1 改造前链路

```
AgentExecutor (run 完成)
  → RuntimeEiSyncService.scheduleRunSync() — 标记 AgentRun.sync.state = 'pending'
  → 定时器 flushPendingRuns() — 轮询 pending runs
    → buildRunSyncPayload() — 从 outbox 读 events（max 5000）
    → axios.post('/ei/sync-batches') — HTTP 推送到 EI
    → 成功标记 synced / 失败重试到 deadLettered
```

### 4.2 改造后链路

```
AgentExecutor (run 完成)
  → messageBus.publish('runtime.ei-sync', { run, events }) — 写入 Redis Stream
  → 完成（生产方职责结束）

EI App 消费组:
  → messageBus.subscribe('runtime.ei-sync', handler, { group: 'ei-sync-group' })
    → handler: 调用 EiOpencodeSyncService.syncOpenCodeRun() 入库
    → 成功 ack() / 失败 nack() → 重试或 DLQ
```

### 4.3 改造步骤

1. **保留 HTTP `/ei/sync-batches` 接口**作为回放/补偿入口，不删除
2. **新增 `runtime.ei-sync` topic 注册**和 RedisStreamAdapter 消费者
3. **HookDispatcherService 双写**：outbox flush 时同时 `publish('runtime.ei-sync', ...)`
4. **EI 侧新增 stream consumer**：复用已有 `syncOpenCodeRun()` 入库逻辑
5. **灰度观测**：双写阶段对比 HTTP 与 Stream 的成功率、延迟、一致性
6. **切主链路**：关闭 HTTP 轮询推送，Stream 成为唯一链路
7. **下线旧代码**：移除 `RuntimeEiSyncService` 的 HTTP 推送逻辑

### 4.4 消息信封格式（runtime.ei-sync）

```typescript
interface RuntimeEiSyncPayload {
  syncBatchId: string;
  envId: string;
  nodeId: string;
  run: {
    runId: string;
    agentId: string;
    roleCode?: string;
    status: string;
    startedAt?: string;   // ISO8601
    completedAt?: string;  // ISO8601
  };
  events: Array<{
    eventId: string;
    sequence: number;
    eventType: string;
    timestamp: string;     // ISO8601
    payloadDigest?: string;
  }>;
}
```

与现有 HTTP payload 完全一致，EI 侧消费逻辑零修改。

---

## 5. 落地步骤

### Phase 1：抽象层搭建（不改业务逻辑）

| 步骤 | 内容 | 影响模块 |
|---|---|---|
| 1.1 | 在 `backend/libs/infra/src/messaging/` 下创建接口定义（MessageEnvelope、MessageBus、MessageAdapter、TopicConfig） | infra |
| 1.2 | 实现 `RedisPubSubAdapter`，内部封装 `RedisService.publish/subscribe` | infra |
| 1.3 | 实现 `RedisStreamAdapter`，内部封装 `RedisService.xadd/xreadgroup/xack`，内建重试和 DLQ 逻辑 | infra |
| 1.4 | 实现 `TopicRouter`：读取 topic 注册表，按 topic 分发到对应 adapter | infra |
| 1.5 | 实现 `MessageBusService`（NestJS Injectable），作为 `MessageBus` 接口的唯一实现，注入 `TopicRouter` | infra |
| 1.6 | 在 `InfraModule` 中注册为全局 provider，export `MESSAGE_BUS` token | infra |
| 1.7 | 编写适配器单元测试（mock RedisService） | infra |

### Phase 2：Runtime + EI Sync 链路迁移（Agents → EI HTTP 推送解耦）

| 步骤 | 内容 | 影响模块 |
|---|---|---|
| 2.1 | 注册 `runtime.ei-sync` topic（reliable / redis-stream） | infra |
| 2.2 | 修改 `HookDispatcherService.dispatch()` → 追加 `messageBus.publish('runtime.ei-sync', ...)` 双写（开关控制） | agents runtime |
| 2.3 | EI app 新增 `EiRuntimeSyncConsumerService`：`messageBus.subscribe('runtime.ei-sync', handler, { group })` — EI 首个 Redis Stream 消费者 | EI app |
| 2.4 | 注册 `runtime.events` topic（fire-and-forget / redis-pubsub），`HookDispatcherService` 改为通过 `messageBus.publish('runtime.events', ...)` | agents runtime |
| 2.5 | 灰度验证：对比 HTTP 和 Stream 的数据一致性（eventCount、runId 覆盖率） | 运维 |
| 2.6 | 通过环境变量开关关闭 HTTP 轮询推送 | agents runtime |
| 2.7 | **注释 `RuntimeEiSyncService` 中 HTTP 推送代码**：注释（不删除）`syncRunNow()` 中的 axios 调用、`flushPendingRuns()` 定时器启动、`buildSignedHeaders()` 调用，保留代码以备回退 | agents runtime |
| 2.8 | MCP 工具调用（requirements / statistics / docs-heat）**不做任何改动**，保持现有 HTTP 请求方式 | — |
| 2.9 | **EI Schema 命名修正**（可选）：`EiOpenCodeRunSyncBatch` / `EiOpenCodeEventFact` / `EiOpenCodeRunAnalytics` 中的 `OpenCode` 前缀改为 `Runtime`，因为所有 channel（native + opencode）的 run 都走此链路 | EI app |
| 2.10 | 保留 HTTP `/ei/sync-batches` 接口作为手动回放/补偿入口，但不再作为主链路 | EI app |

### Phase 3：已有 Streams 纳入总线

| 步骤 | 内容 | 影响模块 |
|---|---|---|
| 3.1 | 注册 `message-center.events` 和 `channel.events` topic | infra |
| 3.2 | `MessageCenterEventConsumerService` 改为通过 `messageBus.subscribe()` 消费 | backend main |
| 3.3 | 所有 `xadd` 生产方（Scheduler、Meeting、EI 等）改为 `messageBus.publish('message-center.events', ...)` | 各 app |
| 3.4 | `ChannelDispatcherService` 改为通过 `messageBus.subscribe()` 消费 | channel app |

### Phase 4：观测与治理

| 步骤 | 内容 |
|---|---|
| 4.1 | 补齐 MessageBus 级别的 metrics（publish 成功/失败、consume lag、retry count、DLQ depth） |
| 4.2 | 暴露 `/api/messaging/health` 端点，返回各 adapter 和 topic 健康状态 |
| 4.3 | 建立告警规则：consumer lag > 阈值、DLQ depth > 阈值、adapter 不健康 |

### Phase 5：后续管道迁移（按需）

| 管道 | 当前模式 | 目标 Topic | 优先级 |
|---|---|---|---|
| memo-write-queue | lpush/brpop | `memo.write-commands` | 中 |
| memo-aggregation | lpush/brpop | `memo.aggregation-commands` | 中 |
| inner-message-dispatch | lpush/brpop | `inner-message.dispatch` | 中 |
| channel-inbound | lpush/brpop | `channel.inbound` | 低 |
| agent-task-queue | lpush/brpop | `agent.task-queue` | 低 |

### Phase 6：RabbitMQ 适配器（待引入时）

| 步骤 | 内容 |
|---|---|
| 6.1 | 实现 `RabbitMqAdapter`（amqplib / @golevelup/nestjs-rabbitmq） |
| 6.2 | 修改 topic 路由配置：将目标 topic 的 adapter 从 `redis-stream` 切为 `rabbitmq` |
| 6.3 | 业务代码零修改 |

---

## 6. 文件结构规划

```
backend/libs/infra/src/messaging/
├── index.ts                          // barrel export
├── message-envelope.ts               // MessageEnvelope + MessageHeaders 类型
├── message-bus.port.ts               // MessageBus 接口 + PublishInput/Result + MessageHandler/Context
├── message-adapter.port.ts           // MessageAdapter 接口
├── topic-registry.ts                 // TopicConfig + DeliveryMode + AdapterType 类型 + 默认 topic 注册表
├── topic-router.service.ts           // TopicRouter：按 topic 名称路由到 adapter 实例
├── message-bus.service.ts            // MessageBusService：MessageBus 接口实现（NestJS Injectable）
├── adapters/
│   ├── redis-pubsub.adapter.ts       // RedisPubSubAdapter
│   ├── redis-stream.adapter.ts       // RedisStreamAdapter（含 consumer loop、retry、DLQ）
│   └── rabbitmq.adapter.ts           // RabbitMqAdapter（占位，后续实现）
└── __tests__/
    ├── redis-pubsub.adapter.spec.ts
    ├── redis-stream.adapter.spec.ts
    ├── topic-router.spec.ts
    └── message-bus.service.spec.ts
```

---

## 7. 配置与开关

### 7.1 环境变量

```env
# 消息总线全局开关
MESSAGE_BUS_ENABLED=true

# EI Sync 链路双写开关（Phase 2 灰度期）
RUNTIME_EI_SYNC_STREAM_ENABLED=true
RUNTIME_EI_SYNC_HTTP_ENABLED=true    # 灰度期保留 HTTP，观测稳定后关闭

# RedisStreamAdapter 默认参数
MESSAGE_BUS_STREAM_BATCH_SIZE=10
MESSAGE_BUS_STREAM_BLOCK_MS=2000
MESSAGE_BUS_STREAM_MAX_RETRIES=5
MESSAGE_BUS_STREAM_RETRY_BACKOFF_MS=5000
MESSAGE_BUS_STREAM_DEFAULT_MAX_LEN=100000
```

### 7.2 回滚策略

- **Phase 2 回滚**：关闭 `RUNTIME_EI_SYNC_STREAM_ENABLED`，打开 `RUNTIME_EI_SYNC_HTTP_ENABLED`，立即回到 HTTP 推送模式
- **Phase 3 回滚**：各 consumer service 保留原始 `xreadgroup` 代码分支，通过开关切换
- **适配器级回滚**：TopicRouter 支持运行时切换 adapter（修改配置 + 重启即可）

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 双写期间 HTTP 和 Stream 数据不一致 | EI 侧可能收到重复数据 | 消费侧通过 `syncBatchId` 幂等去重（已有逻辑） |
| Stream consumer 消费延迟 | EI 数据同步滞后 | 监控 consumer lag + pending 长度，设置告警阈值 |
| Stream 与 RabbitMQ 语义差异（顺序、TTL、routing） | 后续切换 RabbitMQ 时可能不兼容 | 接口层定义"最小公共能力"，不暴露中间件特有语义 |
| 改造过程中引入 regression | 现有消息链路中断 | 每个 Phase 独立可测试、可回滚；灰度期双写对比 |
| 接口抽象过度导致性能开销 | 实时通知延迟增加 | fire-and-forget 模式薄封装，benchmarks 验证开销 < 1ms |

---

## 9. 验收标准

### Phase 1
- [x] `MessageBusService` 通过 DI 可注入（`@Inject(MESSAGE_BUS)` 或直接注入 `MessageBusService`）
- [x] RedisPubSubAdapter 和 RedisStreamAdapter 单元测试通过（13 tests passed）
- [x] topic 注册表可配置、可扩展（`TopicRegistry.register()` 支持运行时注册）

### Phase 2
- [x] EI 同步链路支持 Redis Stream（双写模式，开关控制：`RUNTIME_EI_SYNC_STREAM_ENABLED` / `RUNTIME_EI_SYNC_HTTP_ENABLED`）
- [ ] 灰度期 HTTP 与 Stream 数据一致性 100%（需运行时验证）
- [ ] consumer lag 监控就位（Phase 4 落地）
- [ ] DLQ 中无异常积压（需运行时验证）
- [x] 回滚开关已实现（`RUNTIME_EI_SYNC_HTTP_ENABLED=true` + `RUNTIME_EI_SYNC_STREAM_ENABLED=false` 即可回退）
- [x] HTTP 推送代码通过环境变量开关控制（`httpEnabled`），比注释代码更灵活可回退；定时器仅在 `httpEnabled=true` 时启动
- [x] MCP 工具调用（10 个端点）未做任何改动，保持原有 HTTP 请求方式
- [x] `HookDispatcherService` 已通过 `messageBus.publish('runtime.events')` 发布 pub/sub 事件
- [x] EI 侧新增 `EiRuntimeSyncConsumerService` 消费 `runtime.ei-sync` stream
- [x] HTTP `/ei/sync-batches` 接口保留作为手动回放/补偿入口

### Phase 3
- [x] message-center 和 channel 的 Streams 生产/消费全部通过 MessageBus 接口
  - 消费端：`MessageCenterEventConsumerService`、`ChannelDispatcherService` 改为 `messageBus.subscribe()`
  - 生产端（7 个 xadd 调用点）：`SchedulerService`(2)、`OrchestrationMessageCenterEventService`(1)、`MeetingMessageCenterEventService`(2)、`AgentActionLogService`(1)、`EiStatisticsService`(1) 全部改为 `messageBus.publish()`
  - 桥接：`MessageCenterEventConsumerService.forwardToChannelIfNeeded` 改为 `messageBus.publish('channel.events')`
- [ ] 无功能回归（需运行时验证）

### Phase 4
- [ ] `/api/messaging/health` 端点可用
- [ ] lag / DLQ 告警规则就位

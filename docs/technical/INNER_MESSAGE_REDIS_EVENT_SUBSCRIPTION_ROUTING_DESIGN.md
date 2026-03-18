# Inner Message Redis 事件订阅路由设计

## 1. 背景与目标

- 现有订阅匹配依赖 Mongo 查询 `inner_message_subscriptions`，在高频事件发布场景会增加查询开销。
- 目标是在不改变现有接口语义前提下，将“事件定义 + 订阅路由索引”写入 Redis，发布链路优先走 Redis 匹配。
- 保持 Mongo 为订阅真相源，Redis 为高性能路由层与事件定义缓存层。

## 2. Redis Key 结构

### 2.1 订阅主数据

- `inner:subscription:v1:data:{subscriptionId}`（Hash）
  - `subscriptionId`
  - `subscriberAgentId`
  - `eventType`
  - `filtersJson`
  - `isActive`（`1/0`）
  - `source`
  - `updatedAt`

### 2.2 订阅索引

- 精确匹配：`inner:subscription:v1:index:event:{eventType}`（Set）
- 域通配匹配：`inner:subscription:v1:index:domain:{domain}`（Set）
- 全局通配：`inner:subscription:v1:index:global`（Set）
- Agent 维度反查：`inner:subscription:v1:index:agent:{agentId}`（Set）
- 索引版本：`inner:subscription:v1:version`（String，自增）

### 2.3 事件定义注册表

- 事件定义：`inner:event:def:{eventType}`（Hash）
  - `eventType`
  - `domain`
  - `status`（默认 `active`）
  - `updatedAt`
- 域聚合：`inner:event:def:domain:{domain}`（Set）
- 全量有序集合：`inner:event:def:all`（ZSet，score=`updatedAt`）

## 3. 核心流程

### 3.1 订阅写入（createOrUpdate）

1. 先写 Mongo（`findOneAndUpdate` upsert）。
2. 将订阅记录同步到 Redis Hash。
3. 清理旧索引并重建新索引（按 `eventType` 映射到精确/域/全局索引）。
4. 注册或刷新事件定义（`inner:event:def:*`）。
5. `inner:subscription:v1:version` 自增。

### 3.2 发布匹配（publishMessage）

1. 事件发布时先写入事件定义注册表。
2. 通过 `SUNION` 合并三类索引候选：
   - 精确：`index:event:{eventType}`
   - 域通配：`index:domain:{domain}`
   - 全局：`index:global`
3. 批量读取候选订阅 Hash，过滤 `isActive` 与 `filtersJson`。
4. 命中订阅后写 `inner_messages`，并继续入 `inner:message:dispatch` 队列。

### 3.3 冷启动与回灌

- 服务启动后若 Redis 可用，执行一次“全量回灌”：
  - 清理旧版订阅索引与事件定义缓存
  - 从 Mongo 拉取全量订阅并重建索引
- 若 Redis 不可用，发布链路回退 Mongo 查询，保证功能可用性。

## 4. 一致性策略

- Mongo 仍为订阅真相源，Redis 为路由缓存与加速层。
- 订阅变更采用“Mongo 成功后同步 Redis”的顺序，避免 Redis 出现脏写主导。
- 回灌机制用于修复 Redis 丢失/漂移。

## 5. 风险与边界

- `KEYS` 清理仅用于冷启动回灌，不在热路径执行。
- `filtersJson` 仍在应用层做浅层匹配，复杂过滤建议后续做字段级索引。
- 当前设计不包含 `organizationId` 维度，保持现行约束一致。

# EI Message Center Redis Event Plan

## 1. 背景与目标

- 当前工程统计通知链路为 EI 服务通过 HTTP 回调 legacy Hook：`POST /api/message-center/hooks/engineering-statistics`。
- 现状存在服务间同步耦合：统计流程与通知发送在同一执行路径内，通知链路波动会放大主流程风险。
- 目标将“内部系统消息写入消息中心”统一改为 Redis 事件驱动，EI 不再直接调用 legacy API。

## 2. 范围与非目标

### 2.1 本次范围

- 将 EI 工程统计完成/失败通知从 HTTP Hook 改为 Redis 事件发布。
- 在 legacy 消息中心新增 Redis 事件消费能力，消费后落库 `system_messages`。
- 保持前端消息中心读取接口与交互不变（未读数、已读、跳转逻辑保持兼容）。

### 2.2 非目标

- 不改造消息中心前端页面结构。
- 不在本次引入跨业务的统一事件总线治理平台（仅先覆盖工程统计场景）。
- 不删除现有 Hook 接口对外契约（保留短期兼容窗口，最终是否下线另行评估）。

## 3. 目标链路（To-Be）

1. 调度/工具触发 EI 统计，EI 落库快照（`running -> success/failed`）。
2. EI 在快照终态后发布 Redis 事件 `ei.statistics.snapshot.completed`。
3. legacy Message Center 订阅该事件并校验字段。
4. legacy 调用既有 `createSystemMessage` 写入 `system_messages`。
5. 写库成功后沿用现有 WS 用户级推送（`message-center.message.created`），前端实时刷新未读。

## 4. 事件契约设计（v1）

### 4.1 Redis Channel 与事件名

- Channel（建议）：`events:message-center`
- EventType：`ei.statistics.snapshot.completed`

### 4.2 消息体

```json
{
  "eventId": "uuid",
  "eventType": "ei.statistics.snapshot.completed",
  "version": "v1",
  "occurredAt": "2026-03-24T17:10:00.000Z",
  "source": "engineering-intelligence",
  "data": {
    "receiverId": "employee_xxx",
    "snapshotId": "ei-stats-1742800000000",
    "status": "success",
    "summary": {},
    "error": ""
  },
  "meta": {
    "traceId": "trace_xxx",
    "triggeredBy": "agent-mcp"
  }
}
```

### 4.3 字段约束

- 必填：`eventId`、`eventType`、`version`、`occurredAt`、`source`、`data.receiverId`、`data.snapshotId`、`data.status`。
- `data.status` 仅允许：`success`、`failed`。
- `summary` 与 `error` 为可选，按状态补充。

## 5. 执行步骤（Plan）

1. 在 `backend/libs/infra` 增加消息中心领域事件发布/消费契约（类型定义、序列化、校验工具）。
2. EI 服务将 `emitStatisticsMessage` 从 axios Hook 调用改为 Redis 事件发布，并记录发布结果日志。
3. legacy `message-center` 模块新增事件订阅器，消费 `ei.statistics.snapshot.completed` 并映射为 `engineering_statistics` 系统消息。
4. 新增幂等保障：基于 `eventId` 或业务键（`type+receiverId+snapshotId+status`）防重写入。
5. 保持消息落库后的 WS 推送链路不变，回归验证未读角标、抽屉、详情跳转行为。
6. 增加灰度开关（可选双写：Redis + Hook），完成小流量验证后切换为 Redis 单通道。

## 6. 关键影响点

- 后端（EI）
  - `backend/apps/ei/src/services/statistics.service.ts`（拆分后承载统计消息发布）
- 后端（legacy）
  - `backend/src/modules/message-center/message-center.service.ts`
  - `backend/src/modules/message-center/message-center.module.ts`
  - 新增 message-center 事件消费者文件（模块内）
- 基础设施
  - `backend/libs/infra` Redis pub/sub 能力扩展
- 文档
  - `docs/feature/ENGINEERING_INTELLIGENCE.md`
  - `docs/feature/MESSAGE_CENTER.md`
  - `docs/api/legacy-api.md`

## 7. 风险与对策

- 风险 1：Redis 短暂不可用导致通知丢失。
  - 对策：发布失败告警 + 可重试机制（重试队列或 outbox，按阶段推进）。
- 风险 2：重复消费导致重复消息。
  - 对策：落库前幂等校验，建立去重索引/幂等记录。
- 风险 3：消费异常影响主流程可观测性。
  - 对策：消费者错误日志结构化（eventId/receiverId/snapshotId）并接入监控。
- 风险 4：迁移期间双通道行为不一致。
  - 对策：灰度期双写对账（数量、messageId 映射、未读数一致性），通过后再关停 Hook。

## 8. 验收标准

- EI 不再依赖调用 `POST /api/message-center/hooks/engineering-statistics` 即可完成通知写入。
- 统计成功与失败两类场景均能在消息中心生成系统消息，并可跳转到 `snapshotId` 上下文。
- 通知链路失败不应回写污染统计快照终态（统计结果与通知结果解耦）。
- 前端消息中心未读数/已读闭环行为无回归。

## 9. 回滚与兼容策略

- 保留 Hook 能力作为回滚兜底；通过配置开关切回 HTTP 通知路径。
- 事件消费者异常时，不影响消息中心既有读接口可用性。
- 回滚判定条件：事件消费失败率持续超阈值或出现批量漏通知。

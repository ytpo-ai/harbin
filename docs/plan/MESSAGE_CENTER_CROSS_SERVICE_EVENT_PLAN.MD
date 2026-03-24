# Message Center Cross-Service Event Plan

## 1. 背景与目标

- 当前消息中心跨服务通知主要通过分散的 HTTP Hook/业务侧直连方式写入，存在同步耦合、重试策略不一致、可观测性不足等问题。
- 目标是建立统一的“跨服务消息中心事件通道”，所有跨服务系统消息统一通过 Redis 事件进入 Message Center。
- 本次首批接入两类消息：
  1. 会议结束消息（`meeting.session.ended`）
  2. 工程工具完成消息（`engineering.tool.completed`）
- 前端消息中心读取与交互保持兼容（未读数、已读、跳转逻辑不变）。

## 2. 范围与非目标

### 2.1 本次范围

- 定义 Message Center 统一事件契约（Event Envelope + Message Payload）。
- 在 legacy Message Center 建立统一事件消费者与事件映射器。
- 会议结束、工程工具完成两条链路切换到统一事件通道。
- 增加幂等、重试、失败告警能力。

### 2.2 非目标

- 不改造消息中心前端页面结构与交互。
- 不在本次引入跨业务治理平台（如完整事件目录平台、Schema Registry UI）。
- 不在本次引入历史链路兼容层，统一按 Redis Streams 单通道实施。

## 3. 统一链路（To-Be）

1. 业务服务在关键业务终态后发布 Message Center 事件。
2. Redis 作为跨服务事件通道承载事件分发。
3. legacy Message Center 消费并校验事件契约。
4. 事件映射器将业务事件转换为 `createSystemMessage` 入参。
5. 消息写入 `system_messages` 后复用现有 WS 推送链路（`message-center.message.created`）。

## 4. 事件契约设计（Contract v1）

### 4.1 传输通道

- 标准通道：Redis Streams
  - Stream Key（建议）：`streams:message-center:events`
  - Consumer Group（建议）：`message-center-group`

### 4.2 Envelope（统一外层）

```json
{
  "eventId": "uuid",
  "eventType": "meeting.session.ended",
  "version": "v1",
  "occurredAt": "2026-03-24T17:10:00.000Z",
  "source": "meeting-service",
  "traceId": "trace_xxx",
  "data": {
    "receiverId": "employee_xxx",
    "messageType": "meeting_notice",
    "title": "会议已结束",
    "content": "《研发周会》已结束，可查看纪要与待办。",
    "actionUrl": "/meeting/sessions/ms_123",
    "bizKey": "meeting:ms_123:ended",
    "priority": "normal",
    "extra": {
      "sessionId": "ms_123"
    }
  }
}
```

### 4.3 字段约束

- 必填：`eventId`、`eventType`、`version`、`occurredAt`、`source`、`traceId`、`data.receiverId`、`data.messageType`、`data.title`、`data.content`、`data.bizKey`。
- `version` 当前固定 `v1`；后续升级采用“新增字段向后兼容、禁止破坏性改名”。
- `priority` 允许值：`low`、`normal`、`high`（默认 `normal`）。
- `extra` 为可扩展字段，禁止承载超大文本与敏感信息。

### 4.4 首批事件类型

- `meeting.session.ended`
  - 语义：会议结束后通知参会/关注人员。
  - `extra` 关键字段建议：`sessionId`、`organizerId`。
- `engineering.tool.completed`
  - 语义：工程工具任务完成（成功/失败）后通知触发人。
  - `extra` 关键字段建议：`toolRunId`、`status`、`snapshotId`、`error`。

## 5. 可靠性与一致性设计

### 5.1 幂等防重

- 一级幂等键：`eventId`。
- 二级业务幂等键：`messageType + receiverId + bizKey`。
- 落库侧建立唯一约束，冲突时按“已处理”返回，禁止重复写入。

### 5.2 重试与死信

- 消费失败执行指数退避重试（如 1s/5s/30s）。
- 超过最大重试次数进入死信队列（DLQ），并触发告警。
- 提供人工补偿脚本（按 `eventId` 或时间窗重放）。

### 5.3 可观测性

- 关键指标：发布成功率、消费成功率、消费延迟 P95、DLQ 堆积量、重复消费率。
- 结构化日志字段最少包含：`eventId`、`eventType`、`receiverId`、`bizKey`、`traceId`。
- 告警阈值建议：
  - 5 分钟消费失败率 > 1%
  - DLQ 新增速率持续 10 分钟上升

## 6. 执行步骤（Plan）

1. 定义并落地 Message Center 统一事件契约（DTO、校验、序列化），沉淀到 `backend/libs/infra`。
2. 在 legacy `message-center` 模块实现统一消费者（基于 Streams Consumer Group）与事件映射器机制。
3. 首批接入 `meeting.session.ended`：替换既有通知写入路径为统一事件发布，并完成端到端联调。
4. 接入 `engineering.tool.completed`：统一发布契约并接入同一消费者链路。
5. 建立幂等索引、重试与 DLQ 机制，补齐日志/指标/告警。
6. 完成文档与回归：功能文档、API 文档、故障应急手册。

## 7. 关键影响点

- 后端（消息生产方）
  - 会议服务相关模块（发布 `meeting.session.ended`）
  - 工程工具/EI 相关模块（发布 `engineering.tool.completed`）
- 后端（消息中心）
  - `backend/src/modules/message-center/message-center.module.ts`
  - `backend/src/modules/message-center/message-center.service.ts`
  - 新增统一消费者与事件映射器（模块内）
- 基础设施
  - `backend/libs/infra`（Redis Streams 抽象、契约校验、重试能力）
- 文档
  - `docs/feature/MESSAGE_CENTER.md`
  - `docs/feature/ENGINEERING_INTELLIGENCE.md`
  - 会议相关功能文档（若存在）
  - `docs/api/legacy-api.md`

## 8. 风险与对策

- 风险 1：Redis Streams 或消费者异常导致消息积压。
  - 对策：消费者扩缩容、消费延迟告警、DLQ 与补偿脚本。
- 风险 2：不同业务事件字段漂移造成消费失败。
  - 对策：统一契约校验 + 版本管理 + 生产侧 CI 契约测试。
- 风险 3：平台扩展时事件命名混乱。
  - 对策：建立命名规范（`domain.entity.action`）与事件清单文档。

## 9. 验收标准

- 首批两类事件（会议结束、工程工具完成）均可通过统一事件通道写入消息中心。
- 消息中心前端未读数、已读、跳转行为无回归。
- 重复消费不产生重复系统消息。
- 消费失败可重试、可观测、可补偿（含 DLQ 追踪）。

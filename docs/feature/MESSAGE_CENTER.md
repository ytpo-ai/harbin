# Message Center（消息中心）

## 1. 功能设计

### 1.1 目标

- 在主前端 Header 提供统一消息入口，集中承载系统通知与内部消息入口。
- 在 legacy 主 backend 提供消息中心存储与查询能力，支持已读管理与未读计数。
- 支撑跨服务业务通过 Redis Streams 事件写入通知，实现“业务事件生产，消息中心消费与展示”。

### 1.2 数据结构

- 集合：`system_messages`
- 核心字段：`messageId`、`receiverId`、`type`、`title`、`content`、`payload`、`isRead`、`readAt`、`source`、`status`、`createdAt`
- 关键索引：
  - `{ receiverId: 1, isRead: 1, createdAt: -1 }`
  - `{ type: 1, createdAt: -1 }`

### 1.3 核心逻辑

- 消息列表按 `receiverId` 查询，支持 `page/pageSize/isRead/type` 筛选。
- 消息中心完整页提供 Tab：`系统消息`（`system_messages`）、`内部消息`（`inner_messages`）与 `消息监听`（`inner_message_subscriptions`）。
- 内部消息列表按当前登录员工绑定的 Agent（`exclusiveAssistantAgentId/aiProxyAgentId`）作为 `receiverAgentId` 查询，支持 `page/pageSize/status/mode/eventType` 筛选。
- 内部消息列表发送方/接收方展示优先使用可读名称（Agent 名称或 payload 内 displayName），并保留 ID 作为补充，避免仅显示接收方 ID。
- 内部消息列表新增“查看原始消息”按钮，点击后打开右侧抽屉展示格式化 JSON，并支持一键复制消息 JSON 内容用于排障。
- 消息监听 Tab 支持页面内管理 `inner_message_subscriptions`（查询、启停、创建/更新），并提供事件模板快速注册。
- 消息监听 Tab 的 Agent 选择支持全量 Agent 下拉与名称/ID 搜索过滤。
- 消息监听事件目录由后端 `GET /inner-message-subscriptions/event-definitions` 动态提供，前端不再硬编码事件枚举。
- 监听事件目录覆盖计划编排/任务/会议状态变化：`orchestration.*`、`task.*`、`meeting.*`，支持精确匹配、域通配（如 `task.*`）和全局通配（`*`）。
- Header 右上角实时显示未读角标，页面聚焦时拉取刷新一致性。
- 已读操作（单条/全部）会广播 `message-center:updated` 事件，驱动 Header 未读角标即时同步。
- 已读后会附带最新未读数广播，Header 优先使用事件中的未读值更新，避免异步刷新延迟导致红点残留。
- 消息抽屉仅展示未读消息（打开即请求未读列表），完整消息页支持分页与筛选。
- 点击抽屉消息可触发“标记已读 + 跳转消息中心详情（`messageId` 高亮）”，并实时同步 Header 未读角标。
- 抽屉支持“全部已读”操作，批量设置当前用户所有未读消息为已读。
- 消息中心模块内置 Redis Streams 消费者（`streams:message-center:events` + `message-center-group`），统一消费跨服务消息事件。
- 首批事件类型：`meeting.session.ended`、`engineering.tool.completed`。
- 消费后统一映射到 `createSystemMessage` 落库，并复用既有 WS 推送链路。
- 系统消息落库新增幂等键：`eventId` 与 `receiverId+type+dedupKey`，重复消费不会生成重复消息。

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `plan/MESSAGE_CENTER_MODULE_PLAN.md` | 消息中心模块规划与本轮实现约束 |
| `plan/MESSAGE_CENTER_INNER_MESSAGES_TAB_PLAN.md` | 消息中心新增内部消息 Tab 计划 |

### API 文档 (docs/api/)

| 文件 | 说明 |
|------|------|
| `api/legacy-api.md` | legacy message-center 接口定义 |
| `api/engineering-intelligence-api.md` | EI 统计接口与消息联动参数 |

## 3. 相关代码文件

### 后端（legacy）

| 路径 | 功能 |
|------|------|
| `backend/src/modules/message-center/message-center.controller.ts` | 系统消息/内部消息查询与已读操作 |
| `backend/src/modules/message-center/message-center.service.ts` | 系统消息查询聚合、已读逻辑、幂等写入 |
| `backend/src/modules/message-center/message-center-event-consumer.service.ts` | Redis Streams 事件消费与消息入库 |
| `backend/src/modules/message-center/message-center.module.ts` | 模块装配 |
| `backend/src/shared/schemas/system-message.schema.ts` | `system_messages` 模型与索引 |
| `backend/src/shared/schemas/inner-message.schema.ts` | `inner_messages` 模型与索引 |

### 后端（EI）

| 路径 | 功能 |
|------|------|
| `backend/apps/ei/src/services/statistics.service.ts` | 工程工具完成后发布 `engineering.tool.completed` 事件 |

### 后端（Meeting）

| 路径 | 功能 |
|------|------|
| `backend/src/modules/meetings/services/meeting-message-center-event.service.ts` | 会议结束后发布 `meeting.session.ended` 事件 |

### 前端

| 路径 | 功能 |
|------|------|
| `frontend/src/components/Layout.tsx` | Header 消息入口、未读角标、消息抽屉、用户下拉 |
| `frontend/src/pages/MessageCenter.tsx` | 消息中心完整页（系统消息/内部消息/消息监听三 Tab） |
| `frontend/src/services/messageCenterService.ts` | 消息中心 API 服务（含内部消息查询与订阅管理） |
| `frontend/src/pages/EngineeringStatistics.tsx` | 统计触发时透传 `receiverId` |

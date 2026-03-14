# Message Center（消息中心）

## 1. 功能设计

### 1.1 目标

- 在主前端 Header 提供统一消息入口，集中承载系统通知。
- 在 legacy 主 backend 提供消息中心存储与查询能力，支持已读管理与未读计数。
- 支撑工程统计等业务通过 Hook 写入通知，实现“业务事件生产，消息中心消费与展示”。

### 1.2 数据结构

- 集合：`system_messages`
- 核心字段：`messageId`、`receiverId`、`type`、`title`、`content`、`payload`、`isRead`、`readAt`、`source`、`status`、`createdAt`
- 关键索引：
  - `{ receiverId: 1, isRead: 1, createdAt: -1 }`
  - `{ type: 1, createdAt: -1 }`

### 1.3 核心逻辑

- 消息列表按 `receiverId` 查询，支持 `page/pageSize/isRead/type` 筛选。
- Header 右上角实时显示未读角标，页面聚焦时拉取刷新一致性。
- 已读操作（单条/全部）会广播 `message-center:updated` 事件，驱动 Header 未读角标即时同步。
- 已读后会附带最新未读数广播，Header 优先使用事件中的未读值更新，避免异步刷新延迟导致红点残留。
- 消息抽屉仅展示未读消息（打开即请求未读列表），完整消息页支持分页与筛选。
- 点击抽屉消息可触发“标记已读 + 跳转消息中心详情（`messageId` 高亮）”，并实时同步 Header 未读角标。
- 抽屉支持“全部已读”操作，批量设置当前用户所有未读消息为已读。
- 工程统计创建快照时可传 `receiverId`，EI 完成后回调 legacy Hook 写入通知。

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `plan/MESSAGE_CENTER_MODULE_PLAN.md` | 消息中心模块规划与本轮实现约束 |

### API 文档 (docs/api/)

| 文件 | 说明 |
|------|------|
| `api/legacy-api.md` | legacy message-center 接口定义 |
| `api/engineering-intelligence-api.md` | EI 统计接口与消息联动参数 |

## 3. 相关代码文件

### 后端（legacy）

| 路径 | 功能 |
|------|------|
| `backend/src/modules/message-center/message-center.controller.ts` | 消息中心查询、已读操作与 Hook 接口 |
| `backend/src/modules/message-center/message-center.service.ts` | 消息中心业务逻辑与查询聚合 |
| `backend/src/modules/message-center/message-center.module.ts` | 模块装配 |
| `backend/src/shared/schemas/system-message.schema.ts` | `system_messages` 模型与索引 |

### 后端（EI）

| 路径 | 功能 |
|------|------|
| `backend/apps/engineering-intelligence/src/modules/engineering-intelligence/engineering-intelligence.service.ts` | 统计完成后调用 legacy Hook 写入消息 |

### 前端

| 路径 | 功能 |
|------|------|
| `frontend/src/components/Layout.tsx` | Header 消息入口、未读角标、消息抽屉、用户下拉 |
| `frontend/src/pages/MessageCenter.tsx` | 消息中心完整页 |
| `frontend/src/services/messageCenterService.ts` | 消息中心 API 服务 |
| `frontend/src/pages/EngineeringStatistics.tsx` | 统计触发时透传 `receiverId` |

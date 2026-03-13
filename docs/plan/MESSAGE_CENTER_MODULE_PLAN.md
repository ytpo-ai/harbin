# Message Center Module Plan

## 1. 背景

- 当前系统需要统一承载“工程统计完成提醒”等系统通知。
- 现有前端缺少统一消息入口，用户只能在各业务页面被动感知结果。
- 目标是在主前端提供 GitHub 风格 Header 右侧消息入口，并建设可扩展的消息中心模块。

## 2. 目标

- 前端新增全局 Header：右侧展示 `消息中心` 与 `用户` 区域。
- 建立消息中心页面/抽屉，支持查看全部提醒、未读数、已读状态管理。
- 后端提供消息存储与查询能力，并支持由系统 Hook 写入消息。
- 为后续业务（工程统计、计划编排、任务失败告警等）提供统一通知基础设施。

## 3. 范围

> 约束更新（本 Session 确认）：消息中心能力落在 legacy 主 backend（`backend/src`）实现，不放在 Engineering Intelligence 独立服务中。

### 3.1 前端

- 全局 Header（固定顶部）
  - 右侧：消息图标（未读角标）+ 用户头像下拉。
- 消息中心
  - 快速入口：Header 点击消息图标展开抽屉（最近消息）。
  - 完整页面：支持分页、筛选、已读/未读切换。
  - 操作：单条已读、全部已读、跳转业务详情。

### 3.2 后端

- 在 legacy 主 backend 新增消息中心模块（message-center）
  - 消息模型：`id/type/title/content/payload/readAt/createdAt/source/status`。
  - API：列表、未读数、单条已读、全部已读。
- Hook 集成
  - 计划/任务完成事件可写入消息中心。
  - 首批接入：工程统计计划执行完成/失败通知（事件来源于 EI，通知落库在 legacy）。

## 4. 数据模型建议

- 集合：`system_messages`
- 核心字段：
  - `messageId`（唯一）
  - `receiverId`（用户或角色范围）
  - `type`（如 `engineering_statistics`, `orchestration`, `system_alert`）
  - `title`
  - `content`
  - `payload`（业务扩展：如 `snapshotId`, `planId`, `taskId`）
  - `isRead`
  - `readAt`
  - `createdAt`
- 索引建议：
  - `{ receiverId: 1, isRead: 1, createdAt: -1 }`
  - `{ type: 1, createdAt: -1 }`

## 5. 交互与体验要求

- Header 样式参考 GitHub 导航：清晰、紧凑、操作路径短。
- 消息提醒采用“推送 + 拉取”双机制：
  - 推送用于实时提醒（WebSocket/SSE）。
  - 拉取用于恢复一致性（页面聚焦或重连后刷新）。
- 点击消息后的行为：
  - 标记已读。
  - 跳转到对应业务页面并附带上下文参数。

## 6. 与工程统计的关系

- “工程统计”不再直接依赖页面内提示。
- 统计计划完成后，通过 Hook 向消息中心写入通知。
- 用户在 Header 消息中心可统一查看统计结果提醒。

## 7. 开发任务拆解（下个 Session）

1. 设计并落库消息 Schema 与 API。
2. 实现 Hook -> 消息中心写入链路。
3. 前端改造全局 Layout，新增 Header 右侧消息与用户区。
4. 实现消息抽屉与消息列表页面。
5. 完成未读数全局状态与已读操作闭环。
6. 联调工程统计通知，验证跳转与已读逻辑。

## 8. 验收标准

- Header 右侧稳定展示消息中心入口和用户入口。
- 未读数准确，刷新后与后端一致。
- 可以查看全部消息、标记已读、批量已读。
- 工程统计执行完成后，消息中心能收到并展示对应提醒。
- 点击提醒能跳转到正确业务页并定位上下文。

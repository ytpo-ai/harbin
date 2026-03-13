# MESSAGE_CENTER_MODULE_PLAN 开发总结

## 1. 本次目标

- 按计划实现消息中心模块，并明确能力归属在 legacy 主 backend。
- 在主前端 Header 提供 GitHub 风格消息入口与用户区，支持未读角标和快速查看。
- 打通“工程统计完成/失败 -> 消息中心通知”链路，形成可扩展通知基础设施。

## 2. 实现范围

### 2.1 legacy 后端（消息中心主实现）

- 新增 `message-center` 模块：
  - `GET /message-center/messages`（分页 + 类型/已读筛选）
  - `GET /message-center/unread-count`
  - `PATCH /message-center/messages/:messageId/read`
  - `PATCH /message-center/messages/read-all`
- 新增 Hook：`POST /message-center/hooks/engineering-statistics`
  - 用于承接工程统计完成/失败通知写入。
- 新增 `system_messages` Schema 与索引：
  - `receiverId + isRead + createdAt`
  - `type + createdAt`

### 2.2 EI 后端（仅事件生产与回调）

- `POST /engineering-intelligence/statistics/snapshots` 增加可选 `receiverId`。
- 统计流程完成后调用 legacy Hook 进行消息落库。
- EI 不承担消息中心查询和展示接口，保持职责清晰。

### 2.3 前端（主应用）

- 全局 Header 右侧新增消息按钮（未读角标）与用户下拉区。
- 新增消息抽屉：展示最近消息，支持单条标记已读。
- 新增完整消息页 `/message-center`：支持分页、筛选、单条已读、全部已读。
- 支持点击消息执行“标记已读 + 跳转业务页”（`payload.redirectPath`）。
- 工程统计触发时传递当前用户 `receiverId`，用于通知归属。

## 3. 关键设计决策

- 消息中心能力统一放在 legacy 主 backend，避免把跨业务通知能力耦合进 EI 服务。
- EI 与消息中心通过 Hook 解耦集成，后续其他业务可按同模式接入。
- 前端采用“页面聚焦时拉取”机制做一致性刷新，后续可平滑扩展到 WS/SSE 推送。

## 4. 验证结果

- backend 构建通过：`npm run build`、`npm run build:ei`
- frontend 构建通过：`npm run build`
- 消息中心核心流程已打通：
  - 工程统计触发后可生成通知
  - Header 角标可见未读数
  - 消息页可读可跳转

## 5. 后续建议

- 增加消息权限与接收范围策略（用户/角色/组织）配置化。
- 接入实时推送（WS/SSE）优化时效。
- 增加消息保留策略（归档/清理）与运营可观测指标。

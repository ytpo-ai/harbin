# Message Center 内部消息监听注册管理计划

## 1. 需求目标

- 在前端消息中心「内部消息」Tab 中新增“监听注册管理”能力，支持页面内配置 Agent 的内部事件订阅。
- 事件范围覆盖三大域：计划编排、任务、会议，并支持状态变化事件的统一管理。
- 让业务方（如会议助手）可直接注册 `meeting.ended` 等事件监听，实现“事件发生 -> 内部消息分发 -> 页面可观测”闭环。

## 2. 执行步骤

1. 梳理并固化前端事件目录：按 `orchestration.*`、`task.*`、`meeting.*` 分组，内置状态变化事件与通配说明。
2. 扩展 `messageCenterService`：补齐内部订阅查询与创建/更新 API，统一前端类型定义（`eventType/filters/isActive/subscriberAgentId`）。
3. 改造 `MessageCenter` 页面：在内部消息 Tab 新增“监听注册管理”区块，支持查看、启停、创建/更新订阅。
4. 提供“快速模板 + 自定义”双通道：模板覆盖计划编排/任务/会议常见状态事件；自定义支持精确匹配、域通配、全局通配。
5. 打通订阅与列表联动：订阅项支持一键应用到内部消息 `eventType` 筛选，便于验证监听效果。
6. 完成回归验证并更新文档：执行前端 lint/build，更新功能文档与当日日志记录。

## 3. 关键影响点

- 前端页面：`frontend/src/pages/MessageCenter.tsx`
- 前端服务：`frontend/src/services/messageCenterService.ts`
- API 依赖：`GET /inner-message-subscriptions`、`POST /inner-message-subscriptions`
- 文档：`docs/feature/MESSAGE_CENTER.md`、`docs/dailylog/day/2026-03-18.md`

## 4. 风险与约束

- 当前用户未绑定可用 Agent 时需显示空态引导，避免误以为功能不可用。
- `filters` 为 JSON 字段，需前端做格式校验与错误提示，避免提交无效配置。
- 事件命名需与后端发布侧保持一致，首版按现有规范优先支持：
  - `orchestration.plan.created`
  - `orchestration.plan.updated`
  - `orchestration.plan.completed`
  - `orchestration.plan.failed`
  - `task.created`
  - `task.status.changed`
  - `task.completed`
  - `task.failed`
  - `task.exception`
  - `meeting.started`
  - `meeting.status.changed`
  - `meeting.ended`

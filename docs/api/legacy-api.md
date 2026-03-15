# Legacy Service API

## 基础信息

- 服务地址（直连）：`http://localhost:3001/api`
- 经 Gateway 访问：`http://localhost:3100/api`
- 负责域：会议、讨论、人力资源、操作日志、任务编排、统一消息、研发会话等未拆分模块

## Meetings（`/meetings`）

- `GET /meetings`：会议列表
- `GET /meetings/stats`：会议统计
- `POST /meetings`：创建会议
- `POST /meetings/:id/start`：开始会议
- `POST /meetings/:id/end`：结束会议
- `POST /meetings/:id/join`：加入会议
- `POST /meetings/:id/leave`：离开会议
- `POST /meetings/:id/messages`：发送会议消息
- `POST /meetings/:id/invite`：邀请参会
- `PUT /meetings/:id/title`：修改会议名称
- `POST /meetings/:id/participants`：添加参会人员
- `DELETE /meetings/:id/participants/:participantType/:participantId`：移除参会人员
- `GET /meetings/:id/agent-states`：获取 Agent 思考状态
- `DELETE /meetings/:id`：删除会议

## Roles（`/roles`）

- `GET /roles`：查询角色列表
- `GET /roles/:id`：查询角色详情
- `POST /roles`：创建角色
- `PUT /roles/:id`：更新角色
- `DELETE /roles/:id`：删除角色
- `POST /roles/sync-from-agent-types`：根据 `agent_type` 初始化角色并可选回填 Agent `roleId`

## HR（`/hr`）
- `GET /hr/performance/:agentId`：绩效报告
- `GET /hr/low-performers`：低绩效识别
- `GET /hr/hiring-recommendations`：招聘建议
- `GET /hr/team-health`：团队健康度

## Operation Logs（`/operation-logs`）

- `GET /operation-logs`：查询系统操作日志（筛选 + 分页）

## Orchestration（`/orchestration`）

- `POST /orchestration/plans/from-prompt`：通过提示词创建计划
- `PATCH /orchestration/plans/:id`：更新计划基础信息（标题/提示词/策略/元数据）
- `GET /orchestration/plans`：计划列表
- `GET /orchestration/plans/:id`：计划详情
- `POST /orchestration/plans/:id/run`：执行计划
- `DELETE /orchestration/plans/:id`：删除计划
- `POST /orchestration/tasks/:id/reassign`：任务改派
- `POST /orchestration/tasks/:id/complete-human`：人工任务完成回填
- `POST /orchestration/tasks/:id/retry`：失败任务重试
- `POST /orchestration/tasks/:id/draft`：更新任务草稿（标题/描述）
- `POST /orchestration/tasks/:id/debug-run`：单步调试执行指定任务
- `POST /orchestration/sessions`：创建会话
- `GET /orchestration/sessions`：查询会话
- `GET /orchestration/sessions/:id`：会话详情
- `POST /orchestration/sessions/:id/messages`：追加会话消息
- `POST /orchestration/sessions/:id/messages/batch`：批量追加会话消息
- `POST /orchestration/sessions/:id/archive`：归档会话
- `POST /orchestration/sessions/:id/resume`：恢复会话
- `GET /orchestration/schedules/by-plan/:planId`：查询计划关联的定时服务

会话详情/列表返回中新增可选字段：

- `memoSnapshot`：Agent 会话侧 memo 展示快照（包含 `identity` / `todo` / `topic` 的精简内容），可直接用于会话页渲染。

> 注：`/orchestration/*` 支持内部签名上下文头（`x-user-context` + `x-user-signature`）用于服务间调用。

## Messages（`/messages`）

- `GET /messages`：按 `sceneType + sceneId` 分页查询统一消息

## Message Center（`/message-center`）

- `GET /message-center/messages`：查询当前登录用户消息列表（支持 `page/pageSize/isRead/type`）
- `GET /message-center/unread-count`：查询当前登录用户未读数
- `PATCH /message-center/messages/:messageId/read`：单条消息标记已读
- `PATCH /message-center/messages/read-all`：全部消息标记已读
- `POST /message-center/hooks/engineering-statistics`：工程统计通知写入 Hook（EI 调用，通知落库在 legacy）

## Inner Messages（`/inner-messages`）

- `POST /inner-messages/direct`：内部协作直发消息（先落库 `sent`，再入 Redis 分发队列）
- `POST /inner-messages/publish`：发布事件消息（按订阅关系匹配后生成订阅消息并分发）
- `PATCH /inner-messages/:messageId/ack`：接收方 ACK（更新为 `delivered` 或 `processing`）
- `PATCH /inner-messages/:messageId/processed`：接收方处理完成（更新为 `processed`）

任务生命周期事件（建议）：`task.created`、`task.status.changed`、`task.completed`、`task.exception`、`task.failed`

> Hook 通道：任务事件会同步发布到 Redis 频道 `orchestration:task-events`，用于订阅方实时消费。

## Inner Message Subscriptions（`/inner-message-subscriptions`）

- `POST /inner-message-subscriptions`：创建或更新订阅（按 `subscriberAgentId + eventType` 幂等）
- `GET /inner-message-subscriptions`：查询订阅列表（支持 `subscriberAgentId/eventType/isActive`）

订阅 `eventType` 支持：

- 精确匹配：如 `task.completed`
- 域通配：如 `task.*`
- 全局通配：`*`

`filters` 为可选 JSON（浅层匹配），可用于按 `planId`、`taskId` 等字段筛选。

## EI 会话与项目管理（`/ei`）

> OpenCode Serve（`4098`）直连参数规范与 `directory` 约束见：`docs/api/opencode-api.md`
>
> 项目记录集合为 `ei_projects`，支持三类来源：`local` / `opencode` / `github`。
> 绑定约束：一个 local 项目可绑定多个 opencode 项目，但最多一个 github 仓库。
> GitHub token 通过 `githubApiKeyId` 引用 API Key，不通过项目接口返回明文。

- `GET /ei/opencode/current`
- `GET /ei/opencode/projects`
- `POST /ei/opencode/projects/import`
- `POST /ei/agents/:agentId/opencode/projects/sync`
- `POST /ei/projects/local`
- `POST /ei/projects/bind/opencode`
- `POST /ei/projects/bind/github`
- `POST /ei/projects/:id/unbind/opencode`
- `POST /ei/projects/:id/unbind/github`
- `GET /ei/opencode/sessions`
- `GET /ei/opencode/sessions/:id`
- `GET /ei/opencode/sessions/:id/messages`
- `POST /ei/opencode/sessions`
- `POST /ei/opencode/sessions` 请求体支持 `agentId` 与 `model`（`providerID/modelID`），用于新建 session 时对齐 Agent 模型。
- `POST /ei/opencode/sessions/:id/prompt`
- `POST /ei/opencode/sessions/:id/prompt` 当传入 `model` 且 OpenCode 未配置该模型时，返回 400 并给出明确错误提示。
- `GET /ei/opencode/events`
- `POST /ei/tasks/:id/opencode/sync-current`
- `POST /ei/projects/:id/opencode/sync-current`

`/rd-management/*` 已下线，不再保留兼容入口。

## 说明

- `organization` 与 `governance` 模块当前为下线状态，文档不再维护其接口明细。

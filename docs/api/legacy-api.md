# Legacy Service API

## 基础信息

- 服务地址（直连）：`http://localhost:3001/api`
- 经 Gateway 访问：`http://localhost:3100/api`
- 负责域：会议、讨论、人力资源、操作日志、任务编排、统一消息、研发管理等未拆分模块

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

## Discussions（`/discussions`）

- `POST /discussions`：创建讨论
- `POST /discussions/:id/messages`：发送消息
- `POST /discussions/:id/end`：结束讨论

## HR（`/hr`）

- `GET /hr/performance/:agentId`：绩效报告
- `GET /hr/low-performers`：低绩效识别
- `GET /hr/hiring-recommendations`：招聘建议
- `GET /hr/team-health`：团队健康度

## Operation Logs（`/operation-logs`）

- `GET /operation-logs`：查询系统操作日志（筛选 + 分页）

## Orchestration（`/orchestration`）

- `POST /orchestration/plans/from-prompt`：通过提示词创建计划
- `GET /orchestration/plans`：计划列表
- `GET /orchestration/plans/:id`：计划详情
- `POST /orchestration/plans/:id/run`：执行计划
- `DELETE /orchestration/plans/:id`：删除计划
- `POST /orchestration/tasks/:id/reassign`：任务改派
- `POST /orchestration/tasks/:id/complete-human`：人工任务完成回填
- `POST /orchestration/tasks/:id/retry`：失败任务重试
- `POST /orchestration/sessions`：创建会话
- `GET /orchestration/sessions`：查询会话
- `POST /orchestration/sessions/:id/messages`：追加会话消息
- `POST /orchestration/sessions/:id/archive`：归档会话
- `POST /orchestration/sessions/:id/resume`：恢复会话

## Messages（`/messages`）

- `GET /messages`：按 `sceneType + sceneId` 分页查询统一消息

## RD Management（`/rd-management`）

- `GET /rd-management/opencode/current`
- `GET /rd-management/opencode/projects`
- `POST /rd-management/opencode/projects/import`
- `GET /rd-management/opencode/sessions`
- `GET /rd-management/opencode/sessions/:id`
- `GET /rd-management/opencode/sessions/:id/messages`
- `POST /rd-management/opencode/sessions`
- `POST /rd-management/opencode/sessions/:id/prompt`
- `GET /rd-management/opencode/events`
- `POST /rd-management/tasks/:id/opencode/sync-current`
- `POST /rd-management/projects/:id/opencode/sync-current`

## 说明

- `organization` 与 `governance` 模块当前为下线状态，文档不再维护其接口明细。

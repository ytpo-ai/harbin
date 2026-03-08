# Agents Service API

## 基础信息

- 服务地址（直连）：`http://localhost:3002/api`
- 经 Gateway 访问：`http://localhost:3100/api`
- 负责域：Agent、Tools、Skills、Models、Model Management

## Agent（`/agents`）

- `GET /agents`：获取 Agent 列表
- `POST /agents`：创建 Agent
- `PUT /agents/:id`：更新 Agent（支持 `type`、`role`）
- `DELETE /agents/:id`：删除 Agent
- `POST /agents/:id/execute`：执行 Agent 任务（返回 `response` + `runId` + `sessionId`）
- `POST /agents/:id/test`：测试 Agent 连接

工具白名单约束：

- `Agent.tools` 必须满足：`Agent.tools ⊆ MCPProfile.tools(agent.type)`。
- 若创建/更新时提交超出白名单的工具，后端返回 `400 Bad Request`。

## Agent MCP（`/agents/mcp`）

- `GET /agents/mcp/map`：获取 MCP map（数据库驱动）
- `GET /agents/mcp`：获取可见 MCP Agent 列表
- `GET /agents/mcp/:id`：获取单个 MCP Agent 详情
- `GET /agents/mcp/profiles`：获取 MCP Profiles
- `GET /agents/mcp/profiles/:agentType`：获取单个 Profile
- `PUT /agents/mcp/profiles/:agentType`：创建/更新 Profile

Profile 字段说明：

- `role`: MCP 角色标识
- `tools`: 允许调用的工具 ID 列表
- `capabilities`: 能力标签列表
- `exposed`: 是否在 MCP 可见列表中展示
- `description`: 描述信息

## Skills（`/skills`）

- `GET /skills`：获取技能库（支持筛选）
- `POST /skills`：创建技能
- `PUT /skills/:id`：更新技能
- `DELETE /skills/:id`：删除技能
- `POST /skills/assign`：为 Agent 绑定技能
- `GET /skills/agents/:agentId`：查询 Agent 技能清单
- `POST /skills/manager/discover`：联网检索并入库技能
- `POST /skills/manager/suggest/:agentId`：生成技能建议
- `GET /skills/suggestions/agents/:agentId`：查询建议记录
- `PUT /skills/suggestions/:id`：审核建议
- `POST /skills/docs/rebuild`：重建技能文档（默认 `docs/skills`，配置 `AGENT_DATA_ROOT` 后写入 `$AGENT_DATA_ROOT/skills`）

## Tools（`/tools`）

- `GET /tools`：获取工具列表
- `POST /tools/:id/execute`：执行工具
- `GET /tools/executions/history`：执行历史
- `GET /tools/executions/stats`：执行统计

常用 MCP 工具执行端点（均为 `POST /tools/:id/execute`）：

- `model_mcp_list_models`
- `model_mcp_search_latest`
- `model_mcp_add_model`
- `human_operation_log_mcp_list`
- `code-docs-mcp`
- `code-updates-mcp`
- `orchestration_create_plan`
- `orchestration_run_plan`
- `orchestration_get_plan`
- `orchestration_list_plans`
- `orchestration_reassign_task`
- `orchestration_complete_human_task`

会议编排 MCP 说明：

- 上述 `orchestration_*` 工具设计为会议场景调用（需存在 meeting 上下文）。
- 高风险动作需显式确认参数：
  - `orchestration_run_plan` 需要 `confirm: true`
  - `orchestration_reassign_task` 需要 `confirm: true`
  - `orchestration_complete_human_task` 需要 `confirm: true`

## Models（`/models`）

- `GET /models`：获取模型列表
- `POST /models/:id/chat`：模型聊天
- `POST /models/:id/test`：模型连通性测试
- `GET /models/debug/status`：模型调试状态

## Model Management（`/model-management`）

- `GET /model-management/available`：可用模型
- `GET /model-management/recommended`：推荐模型
- `GET /model-management/by-provider/:provider`：按提供商筛选
- `POST /model-management/select-for-founder/:founderType`：为核心角色设置模型
- `GET /model-management/founder-models`：获取核心角色模型

## 备注

- Agent 类型规范：`docs/agent_type.md`
- 当前类型配置来源：`frontend/src/config/agentType.json`

## Runtime Hooks（内部能力）

- Agents Runtime 已引入结构化生命周期事件（Hook Contract），用于模块外部感知执行状态。
- 事件类型包含：
  - `run.started`
  - `run.step.started`
  - `llm.delta`
  - `tool.pending`
  - `tool.running`
  - `tool.completed`
  - `tool.failed`
  - `run.completed`
  - `run.failed`
- 当前默认通过 Redis Pub/Sub 分发：
  - 组织级：`agent-runtime:{organizationId}`
  - Agent 级：`agent-runtime:{agentId}`
- 事件持久化使用 outbox 设计，集合：`agent_events_outbox`（状态：`pending/dispatched/failed`）。

## Runtime Run Control（内部能力）

- 所有 Runtime Run Control 接口要求内部上下文角色为：`system/admin/owner`
- 组织隔离：非 `system` 角色仅可操作与其 `organizationId` 相同的 run
- `GET /agents/runtime/runs/:runId`：查询 run 状态
- `GET /agents/runtime/metrics`：查询 runtime hooks/outbox 指标（发布量、失败量、队列状态、死信摘要）
- `GET /agents/runtime/sessions?ownerType=&ownerId=&status=&sessionType=&keyword=&page=&pageSize=`：分页查询 session（支持按 Agent 过滤）
- `GET /agents/runtime/sessions/:id`：查询单个 session 详情（含消息轨迹）
- `GET /agents/runtime/outbox/dead-letter?limit=200&organizationId=&runId=&eventType=`：导出失败事件（死信视图，支持筛选；返回 `total/returned/hasMore`）
- `POST /agents/runtime/outbox/dead-letter/requeue`：批量重投死信（支持 `eventIds` 或筛选条件 + `limit`，可 `dryRun`）
- `GET /agents/runtime/maintenance/audits?limit=&action=&organizationId=&batchId=`：查询运行维护审计日志
- `POST /agents/runtime/maintenance/purge-legacy`：清理 legacy runtime 数据（仅 `system` 角色，需 `confirm=DELETE_LEGACY_RUNTIME_DATA`，可 `dryRun`）
- `POST /agents/runtime/runs/:runId/pause`：暂停 run（支持 body: `reason`、`actorId`、`actorType`）
- `POST /agents/runtime/runs/:runId/resume`：恢复 run（支持 body: `reason`、`actorId`、`actorType`）
- `POST /agents/runtime/runs/:runId/cancel`：取消 run（支持 body: `reason`、`actorId`、`actorType`）
- `POST /agents/runtime/runs/:runId/replay`：重放 run 事件到 hook 通道（支持 body: `eventTypes`、`fromSequence`、`toSequence`、`channel`、`limit`）

## Orchestration Scheduler（Legacy Backend）

- 以下接口由 legacy backend 提供（非 agents service），用于管理定时调度任务：
- `POST /orchestration/schedules`：创建定时计划
- `GET /orchestration/schedules`：获取计划列表
- `GET /orchestration/schedules/:id`：获取计划详情
- `PUT /orchestration/schedules/:id`：更新计划
- `DELETE /orchestration/schedules/:id`：删除计划
- `POST /orchestration/schedules/:id/enable`：启用计划
- `POST /orchestration/schedules/:id/disable`：停用计划
- `POST /orchestration/schedules/:id/trigger`：手动触发计划
- `GET /orchestration/schedules/:id/history?limit=20`：查看执行历史（底层来源：`orchestration_tasks`，`mode=schedule`）

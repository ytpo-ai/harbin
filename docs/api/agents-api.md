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
- `POST /agents/:id/execute`：执行 Agent 任务
- `POST /agents/:id/test`：测试 Agent 连接

## Agent MCP（`/agents/mcp`）

- `GET /agents/mcp/map`：获取 MCP map（数据库驱动）
- `GET /agents/mcp`：获取可见 MCP Agent 列表
- `GET /agents/mcp/:id`：获取单个 MCP Agent 详情
- `GET /agents/mcp/profiles`：获取 MCP Profiles
- `GET /agents/mcp/profiles/:agentType`：获取单个 Profile
- `PUT /agents/mcp/profiles/:agentType`：创建/更新 Profile

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
- `POST /skills/docs/rebuild`：重建 `docs/skills` 文档

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

- `GET /agents/runtime/runs/:runId`：查询 run 状态
- `POST /agents/runtime/runs/:runId/pause`：暂停 run（支持 body: `reason`、`actorId`、`actorType`）
- `POST /agents/runtime/runs/:runId/resume`：恢复 run（支持 body: `reason`、`actorId`、`actorType`）
- `POST /agents/runtime/runs/:runId/cancel`：取消 run（支持 body: `reason`、`actorId`、`actorType`）
- `POST /agents/runtime/runs/:runId/replay`：重放 run 事件到 hook 通道（支持 body: `eventTypes`、`fromSequence`、`toSequence`、`channel`、`limit`）

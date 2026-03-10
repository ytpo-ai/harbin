# Agents Service API

## 基础信息

- 服务地址（直连）：`http://localhost:3002/api`
- 经 Gateway 访问：`http://localhost:3100/api`
- 负责域：Agent、Tools、Skills、Models、Model Management

## Agent（`/agents`）

- `GET /agents`：获取 Agent 列表
- `POST /agents`：创建 Agent
- `PUT /agents/:id`：更新 Agent（支持 `type`、`roleId`）
- `DELETE /agents/:id`：删除 Agent
- `POST /agents/:id/execute`：执行 Agent 任务（返回 `response` + `runId` + `sessionId`）
- `POST /agents/:id/test`：测试 Agent 连接

硬切换约束：

- `roleId` 为必填字段（创建与更新均需满足）。
- 角色主数据来源为 legacy Roles 模块（`/roles`），agents service 仅保存引用。

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
- `POST /agents/mcp/migrate-tool-ids`：批量将 Agent/AgentProfile 中 legacy tool id 迁移为 canonical toolId

Profile 字段说明：

- `role`: MCP 角色标识
- `tools`: 允许调用的工具 ID 列表
- `capabilities`: 能力标签列表
- `exposed`: 是否在 MCP 可见列表中展示
- `description`: 描述信息

兼容说明：

- MCP profile 的 `tools` 读写统一使用 canonical toolId；若传入 legacy id，服务端会自动归一化。

## 工具权限集（按系统角色）

- `GET /agents/tool-permission-sets`：按 HR 系统角色查询工具权限集
- `PUT /agents/tool-permission-sets/:roleCode`：更新指定角色的工具权限集
- `POST /agents/tool-permission-sets/reset-system-roles`：按系统角色默认种子重置权限集

说明：

- 工具白名单校验优先按 `agent.roleId -> role.code` 读取权限集。
- 若角色权限集不存在，服务端回退到历史 `agent.type` profile 读取（兼容旧数据）。

## Agent Roles Proxy（`/agents/roles`）

- `GET /agents/roles?status=active|inactive`：查询 HR 角色列表（跨服务代理）
- `GET /agents/roles/:id`：查询单个 HR 角色（跨服务代理）

说明：

- 此接口不持有角色主数据，仅代理 legacy HR 角色查询能力。

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
- `GET /skills/:id/content`：按需读取技能正文（渐进式加载）

Skill 渐进式加载（DB + Redis）契约：

- 目标：列表链路仅返回元数据，正文按需加载。
- `GET /skills`
  - 默认不返回 `content` 大字段。
  - 可选参数：`includeMetadata=true` 返回完整元数据。
- `GET /skills/:id`
  - 默认不返回 `content`。
  - 可选参数：`includeContent=true` 时返回正文。
- 可选扩展端点：`GET /skills/:id/content`
  - 仅返回技能正文与正文相关元信息（`contentType/contentHash/contentUpdatedAt`）。

说明：

- 以上契约用于支持“Skill 索引元数据常驻 + 技能正文按命中加载”的运行模式。

## Tools（`/tools`）

- `GET /tools`：获取工具列表
- `GET /tools/registry`：按统一工具模型查询（支持 `provider/executionChannel/toolkitId/namespace/resource/action/category/capability/enabled` 过滤）
- `GET /tools/toolkits`：查询 Toolkit 实体列表（支持 `provider/executionChannel/namespace/status` 过滤）
- `GET /tools/toolkits/:id`：查询单个 Toolkit 实体
- `GET /tools/router/topk`：工具路由 Top-K（支持 `provider/domain/namespace/resource/action/capability/limit`）

分类说明：

- `provider`：工具来源平台，仅支持 `composio`（外部集成）和 `builtin`（内置能力）
- `executionChannel`：工具执行时所走的调用链路，支持 `mcp`（通过 MCP 协议调用）和 `internal`（本服务直接处理）

兼容说明：

- 当前接口仅接受 canonical toolId，不再支持 legacy tool id 映射。
- `POST /tools/:id/execute`：执行工具
- `GET /tools/executions/history`：执行历史
- `GET /tools/executions/stats`：执行统计

执行兼容说明：

- `GET /tools` 与 `GET /tools/:id` 响应包含统一字段：`toolId`、`legacyToolId`、`provider`、`executionChannel`、`namespace`、`capabilitySet`。
- `POST /tools/:id/execute` 仅面向 canonical tool id；执行链路内统一记录 `requestedToolId/resolvedToolId/traceId`。
- 响应新增：`requestedToolId`、`resolvedToolId`、`resolvedLegacyToolId`、`traceId`、`executionChannel`。
- `GET /tools/executions/history` 统一返回 `toolId`（canonical）与 `legacyToolId`，并包含 `executionChannel`。
- `GET /tools/executions/stats` 统一使用 `toolId` 字段（不再依赖 `_id`），并返回 `failureReasons` 与 `healthScore`。

搜索工具说明：

- `builtin.internal.web.search.exa`：显式 Exa 搜索工具（`type=auto` + `highlights` 紧凑内容）。
- `composio.mcp.web.search.serp`：显式 Composio SERP 搜索工具。
- 兼容映射：`internal.web.search` 与 `builtin.internal.web.search` 会迁移到 `composio.mcp.web.search.serp`。
- 搜索执行结果中的 `data.provider` 标识实际命中的后端（如 `exa/auto`、`composio/serpapi`）。

常用 MCP 工具执行端点（均为 `POST /tools/:id/execute`）：

- `model_mcp_list_models`
- `model_mcp_search_latest`
- `model_mcp_add_model`
- `human_operation_log_mcp_list`
- `gh-repo-docs-reader-mcp`
- `gh-repo-updates-mcp`
- `orchestration_create_plan`
- `orchestration_update_plan`
- `orchestration_run_plan`
- `orchestration_get_plan`
- `orchestration_list_plans`
- `orchestration_reassign_task`
- `orchestration_complete_human_task`
- `orchestration_create_schedule`
- `orchestration_update_schedule`
- `orchestration_debug_task`
- `builtin.sys-mg.internal.agent-master.list-agents`
- `builtin.sys-mg.internal.agent-master.create-agent`
- `builtin.sys-mg.mcp.skill-master.list-skills`
- `builtin.sys-mg.mcp.skill-master.create-skill`

`builtin.sys-mg.internal.agent-master.list-agents` 响应说明：

- 顶层字段：`total`、`visible`、`includeHidden`、`agents`、`fetchedAt`
- `agents[]` 字段：`id`、`name`、`role`、`capabilitySet`、`exposed`、`isActive`、`identify`
- `identify` 来源于 `agentId + memoKind(identity)` 的第一条 memo 内容，缺失时返回空字符串。

`builtin.sys-mg.internal.agent-master.create-agent` 参数约定：

- 必填：`name`、`roleId`、`model.id`（或 `modelId`）
- 可选：`type`、`description`、`systemPrompt`、`model.*`、`capabilities`、`tools`、`permissions`、`learningAbility`、`isActive`、`apiKeyId`
- `provider` 为 API Key 选择策略参数：默认 `default`（回退到模型 provider）
- 未显式传入 `apiKeyId` 时，系统会按 provider 选择 `isDefault=true && isActive=true` 的 key；若不存在则回退系统默认 key 策略

Skill Master MCP 参数约定：

- `builtin.sys-mg.mcp.skill-master.list-skills`
  - 支持 `title` 模糊检索（映射到 skill name search）
  - 可选参数：`status`、`category`、`includeMetadata`、`limit`、`page`
- `builtin.sys-mg.mcp.skill-master.create-skill`
  - 必填：`title`（或 `name`）、`description`
  - 可选：`category`、`tags`、`sourceType`、`sourceUrl`、`provider`、`version`、`status`、`confidenceScore`、`metadata`、`content`、`contentType`

会议编排 MCP 说明：

- 上述 `orchestration_*` 工具设计为会议场景调用（需存在 meeting 上下文）。
- 高风险动作需显式确认参数：
  - `orchestration_run_plan` 需要 `confirm: true`
  - `orchestration_reassign_task` 需要 `confirm: true`
  - `orchestration_complete_human_task` 需要 `confirm: true`
- 计划更新 MCP：
  - `orchestration_update_plan` -> `PATCH /orchestration/plans/:id`
  - 参数语义：`planId` 必填；支持按需更新 `title`、`prompt`（映射 `sourcePrompt`）、`mode`、`plannerAgentId`、`metadata`
- 定时计划相关 MCP（创建/更新）通过 Scheduler 接口落地：
  - `orchestration_create_schedule` -> `POST /orchestration/schedules`
  - `orchestration_update_schedule` -> `PUT /orchestration/schedules/:id`
  - 参数语义：
    - `orchestration_create_schedule`：必须传 `planId` + `scheduleType(cron|interval)` + 调度表达式参数（`expression` 或 `intervalMs`）
    - `orchestration_update_schedule`：用于更新 schedule 调度信息（如 `enabled`、cron/interval 配置），不再要求传执行 target/input
- 任务调试 MCP：
  - `orchestration_debug_task` -> `POST /orchestration/tasks/:id/debug-run`
  - 参数语义：`taskId` 必填；支持可选 `title`、`description`、`resetResult`
  - 返回语义：包含 `task` 与 `execution`，并附加调试摘要字段（状态、错误、最近日志、建议动作）供 Agent 连续决策

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

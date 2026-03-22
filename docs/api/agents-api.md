# Agents Service API

## 基础信息

- 服务地址（直连）：`http://localhost:3002/api`
- 经 Gateway 访问：`http://localhost:3100/api`
- 负责域：Agent、Tools、Skills、Models、Model Management

## Agent（`/agents`）

- `GET /agents`：获取 Agent 列表
- `POST /agents`：创建 Agent（支持 `tier`）
- `PUT /agents/:id`：更新 Agent（支持 `roleId`、`tier`）
- `DELETE /agents/:id`：删除 Agent
- `POST /agents/:id/execute`：执行 Agent 任务（返回 `response` + `runId` + `sessionId`）
- `POST /agents/:id/test`：测试 Agent 连接

### Agent Task SSE（`/agents/tasks`）

- `POST /agents/tasks`：创建异步 Agent 任务，快速返回 `taskId`
  - 请求示例：

```json
{
  "agentId": "agent_xxx",
  "task": "请分析并修复构建失败",
  "sessionContext": {},
  "idempotencyKey": "task-20260316-001"
}
```

  - 响应示例：

```json
{
  "taskId": "task_xxx",
  "status": "queued"
}
```

- `GET /agents/tasks/:taskId`：查询任务状态与摘要（`status/progress/currentStep/error/resultSummary/lastEventAt`）
  - 额外返回重试与超时治理字段：`attempt/maxAttempts/nextRetryAt/lastAttemptAt/stepTimeoutMs/taskTimeoutMs`
- `GET /agents/tasks/:taskId/events`：SSE 订阅任务事件（支持 `Last-Event-ID` 或 query `lastEventId`）
  - 关键响应头：
    - `Content-Type: text/event-stream`
    - `Cache-Control: no-cache, no-transform`
    - `Connection: keep-alive`
- `POST /agents/tasks/:taskId/cancel`：请求取消任务

说明：Orchestration 执行 agent 类型任务时已切换到该异步任务通道（提交任务 + 查询终态回写），不再在编排服务内同步等待 `POST /agents/:id/execute` 的完整返回。

补充：编排侧终态感知优先消费 `GET /agents/tasks/:taskId/events`（SSE 事件驱动），若 SSE 订阅异常则自动降级为 `GET /agents/tasks/:taskId` 轮询。

SSE 事件 envelope：

```json
{
  "id": "evt_000123",
  "type": "status|progress|token|tool|result|error|heartbeat",
  "taskId": "task_xxx",
  "runId": "run_xxx",
  "sequence": 123,
  "timestamp": "2026-03-16T10:00:01.000Z",
  "payload": {}
}
```

重试与超时策略：

- `stepTimeoutMs`：单次执行步骤超时（超时后触发 `STEP_TIMEOUT_EXCEEDED`）。
- `taskTimeoutMs`：任务总时长上限（超限后触发 `TASK_TIMEOUT_EXCEEDED` 并终止重试）。
- `maxAttempts`：最大尝试次数（含首次执行）。
- 对可重试错误采用指数退避 + jitter（基于 `retryBaseDelayMs/retryMaxDelayMs`）。
- SSE payload 中补充 `retry_scheduled/retry_started` 语义用于前端观测。

Multi-Serve 路由配置（agents service）：

- 环境变量 `OPENCODE_SERVE_REGISTRY` 支持配置多 OpenCode serve 节点（JSON array）。
- 每项字段：`serveId/baseUrl/authEnable/maxConcurrency/weight`。
- 未配置时 fallback 到 `OPENCODE_SERVER_URL`（`serveId=default`）。

OpenCode endpoint 解析优先级（强约束）：

- `agent.config.execution.endpoint`
- `agent.config.execution.endpointRef`
- `context.opencodeRuntime.endpoint`
- `context.opencodeRuntime.endpointRef`
- `OPENCODE_SERVER_URL`

故障排查（Token 输出为空但任务成功）：

- 先看事件流是否仅有 `result` 而无 `token`；若是，优先检查 OpenCode 返回是否位于 `parts/info.parts`。
- 服务端已兼容 `info.content/content/parts/info.parts/payload.parts/message/output` 多种返回结构。
- 若 `result.response` 为空但 OpenCode 实际有输出，服务端会按会话事件重建 response，并通过 `token` 事件实时透传。

取消任务与 OpenCode 会话中断：

- Agent Task 取消会触发 OpenCode 会话中断请求：`POST /session/:sessionId/abort`。
- 取消请求使用与本次执行相同的 resolved endpoint（遵循上方优先级），不应回退到 env 默认 endpoint。
- 推荐观察日志关键字：`[task_cancel] ... sessionId=... endpoint=...`、`OpenCode abort request start/success/failed`。

OpenCode 相关（规划中）：

- Agent 实体增加 `config` JSON 字段（创建/更新/查询可读写，历史默认 `{}`）。
- `POST /agents/:id/execute-with-opencode`：以 OpenCode 通道执行任务。
  - 入参关键字段：`task`、`serveEndpoint`、`mode`、`context`、`approvalPolicy`。
  - 执行前门禁：角色准入、模型匹配、`agent + period` 配额检测。
  - 超限行为：触发 `permission.asked` 并暂停 run；带 `context.approval.approved=true` 重试时写入 `permission.replied` 并恢复执行。

`Agent.config` 建议结构（当前实现支持 JSON 对象透传）：

- `execution.provider`: `opencode` 时启用 OpenCode 通道。
- `execution.modelPolicy.bound`: 绑定模型（`provider/model`）匹配校验。
- `budget`: `period + limit + unit(runCount)` 配额策略。

硬切换约束：

- `roleId` 为必填字段（创建与更新均需满足）。
- `tier` 枚举：`leadership | operations | temporary`。
- 未显式传入 `tier` 时按 `role.code -> tier` 映射自动回填。
- 若显式传入 `tier` 与角色映射不一致，后端返回 `400 Bad Request`。
- 角色主数据来源为 agents 服务内 `agent_roles` 集合（`/agents/roles*`）。

工具白名单约束：

- `Agent.tools` 必须满足：`Agent.tools ⊆ MCPProfile.tools(role.code)`。
- 若创建/更新时提交超出白名单的工具，后端返回 `400 Bad Request`。

## Inner Messages（`/inner-messages`）

- `POST /inner-messages/direct`：内部协作直发消息（先落库 `sent`，再入 Redis 分发队列）
- `POST /inner-messages/publish`：发布事件消息（按订阅关系匹配后生成订阅消息并分发）
- `PATCH /inner-messages/:messageId/ack`：接收方 ACK（更新为 `delivered` 或 `processing`）
- `PATCH /inner-messages/:messageId/processed`：接收方处理完成（更新为 `processed`）

## Inner Message Subscriptions（`/inner-message-subscriptions`）

- `POST /inner-message-subscriptions`：创建或更新订阅（按 `subscriberAgentId + eventType` 幂等）
- `GET /inner-message-subscriptions`：查询订阅列表（支持 `subscriberAgentId/eventType/isActive`）
- `GET /inner-message-subscriptions/event-definitions`：查询事件定义（优先来自 Redis 事件注册表，支持 `domain/keyword/limit`）
- `POST /inner-message-subscriptions/rebuild-index`：重建订阅 Redis 路由索引（运维/排障）

说明：Inner Message 主实现已迁移到 agents 服务；legacy 侧编排/会议通过 `AgentClientService` 转发任务与会议事件到该路由。

## Message Center（`/message-center`）

- `GET /message-center/inner-messages`：内部消息只读分页查询（支持 `page/pageSize/mode/status/eventType`）

## Agent MCP（`/agents/mcp`）

- `GET /agents/mcp/map`：获取 MCP map（数据库驱动）
- `GET /agents/mcp`：获取可见 MCP Agent 列表
- `GET /agents/mcp/:id`：获取单个 MCP Agent 详情
- `GET /agents/mcp/profiles`：获取 MCP Profiles
- `GET /agents/mcp/profiles/:roleCode`：获取单个 Profile
- `PUT /agents/mcp/profiles/:roleCode`：创建/更新 Profile
- `POST /agents/mcp/migrate-tool-ids`：批量将 Agent/AgentProfile 中 legacy tool id 迁移为 canonical toolId

Profile 字段说明：

- `role`: MCP 角色标识
- `tools`: 允许调用的工具 ID 列表
- `permissions`: Profile 有效权限集合（`permissionsManual ∪ permissionsDerived`）
- `permissionsManual`: 手工维护权限集合
- `permissionsDerived`: 基于 `tools.requiredPermissions` 自动推导的权限集合
- `capabilities`: 兼容字段（deprecated，迁移期镜像 `permissions`）
- `exposed`: 是否在 MCP 可见列表中展示
- `description`: 描述信息

兼容说明：

- MCP profile 的 `tools` 读写统一使用 canonical toolId；若传入 legacy id，服务端会自动归一化。
- `PUT /agents/mcp/profiles/:roleCode` 与 `PUT /agents/tool-permission-sets/:roleCode` 迁移期仍兼容传入 `capabilities`，服务端会映射为 `permissions`。

## 工具权限集（按系统角色）

- `GET /agents/tool-permission-sets`：按 HR 系统角色查询工具权限集
- `PUT /agents/tool-permission-sets/:roleCode`：更新指定角色的工具权限集

说明：

- 工具白名单校验优先按 `agent.roleId -> role.code` 读取权限集。
- 若角色权限集不存在，服务端使用默认 profile（`exposed=false`）。
- 更新 profile 工具集合时，服务端会自动重算并回填 `permissionsDerived`。

## Agent Roles（`/agents/roles`）

- `GET /agents/roles?status=active|inactive`：查询角色列表
- `GET /agents/roles/:id`：查询单个角色
- `POST /agents/roles`：创建角色
- `PUT /agents/roles/:id`：更新角色
- `DELETE /agents/roles/:id`：删除角色

说明：

- 此接口由 agents 服务直接持有与管理角色主数据（不再依赖 legacy `/roles` 代理）。
- 返回结构中包含 `tier` 字段（`leadership | operations | temporary`）。

## Skills（`/skills`）

- `GET /skills`：获取技能库（支持筛选）
- `POST /skills`：创建技能
- `PUT /skills/:id`：更新技能
- `DELETE /skills/:id`：删除技能
- `POST /skills/assign`：为 Agent 绑定/解绑技能（写入 `Agent.skills`）
- `GET /skills/agents/:agentId`：查询 Agent 技能清单
- `POST /skills/manager/discover`：联网检索并入库技能
- `POST /skills/docs/sync`：同步技能文档到 DB（默认扫描 `docs/skill`，可通过 `SKILL_DOCS_DIR` 覆盖）
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
- `GET /tools/:id`：获取单个工具
- `GET /tools/registry`：按统一工具模型查询（支持 `provider/executionChannel/toolkitId/namespace/resource/action/category/capability/enabled` 过滤）
- `GET /tools/toolkits`：查询 Toolkit 实体列表（支持 `provider/executionChannel/namespace/status` 过滤）
- `GET /tools/toolkits/:id`：查询单个 Toolkit 实体
- `GET /tools/router/topk`：工具路由 Top-K（支持 `provider/domain/namespace/resource/action/capability/limit`）
- `PUT /tools/:id`：更新工具元数据（如 `name/description/category/type/enabled/status/prompt`）
- `DELETE /tools/:id`：删除工具

分类说明：

- `provider`：工具来源平台，仅支持 `composio`（外部集成）和 `builtin`（内置能力）
- `executionChannel`：工具执行时所走的调用链路，支持 `mcp`（通过 MCP 协议调用）和 `internal`（本服务直接处理）

兼容说明：

- 当前接口仅接受 canonical toolId，不再支持 legacy tool id 映射。
- `POST /tools/:id/execute`：执行工具
- `GET /tools/executions/history`：执行历史
- `GET /tools/executions/stats`：执行统计
- `POST /tools/auth/credentials`：创建 Agent 工具调用凭证（返回一次性 `agentSecret`）
- `POST /tools/auth/credentials/revoke`：吊销 Agent 工具调用凭证
- `POST /tools/auth/credentials/rotate`：轮换 Agent 工具调用凭证（旧凭证自动吊销）
- `POST /tools/auth/agent-token`：使用 `agentKeyId + agentSecret` 交换短期 Bearer token
- `POST /tools/auth/tokens/revoke`：按 `token` 或 `jti` 吊销已签发 token

执行兼容说明：

- `GET /tools` 与 `GET /tools/:id` 响应包含统一字段：`toolId`、`legacyToolId`、`provider`、`executionChannel`、`namespace`、`capabilitySet`。
- `GET /tools` 与 `GET /tools/:id` 额外返回 `prompt`（可选），用于 Agent 运行时按已授权工具注入 system 策略提示。
- `POST /tools/:id/execute` 仅面向 canonical tool id；执行链路内统一记录 `requestedToolId/resolvedToolId/traceId`。
- `POST /tools/:id/execute` 支持 Bearer token（`TOOLS_AUTH_MODE=hybrid|jwt-strict`）与内部签名上下文混合模式。
- 响应新增：`requestedToolId`、`resolvedToolId`、`resolvedLegacyToolId`、`traceId`、`executionChannel`。
- 当执行 Agent 的 `tier=temporary` 且调用系统管理类工具时，返回错误码 `TEMPORARY_WORKER_TOOL_VIOLATION`。
- 执行审计字段：`authMode`、`tokenJti`、`originSessionId`（用于跨链路追踪 JWT 主体与会话）。
- `GET /tools/executions/history` 统一返回 `toolId`（canonical）与 `legacyToolId`，并包含 `executionChannel`。
- `GET /tools/executions/stats` 统一使用 `toolId` 字段（不再依赖 `_id`），并返回 `failureReasons` 与 `healthScore`。
- 管理端“弃用工具”推荐通过 `PUT /tools/:id` 设置 `status=deprecated` 且 `enabled=false`，以保留工具记录并阻止继续执行。

Tools 鉴权模式（新增）：

- `legacy`：沿用内部签名上下文（`x-user-context` + `x-user-signature`）。
- `hybrid`：同时支持内部签名与 Bearer token。
- `jwt-strict`：仅允许 Bearer token 调用工具执行接口。

Agent token exchange（新增）示例：

- `POST /tools/auth/agent-token`
  - request

```json
{
  "agentKeyId": "ak_live_xxx",
  "agentSecret": "as_live_xxx",
  "requestedScopes": ["tool:execute:builtin.sys-mg.internal.agent-master.list-agents"],
  "originSessionId": "session-123"
}
```

  - response

```json
{
  "accessToken": "<jwt>",
  "tokenType": "Bearer",
  "expiresIn": 600,
  "scope": "tool:execute:builtin.sys-mg.internal.agent-master.list-agents"
}
```

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
- `builtin.sys-mg.internal.rd-related.docs-write`
- `builtin.sys-mg.mcp.skill-master.list-skills`
- `builtin.sys-mg.mcp.skill-master.create-skill`
- `builtin.sys-mg.mcp.inner-message.send-internal-message`

`builtin.sys-mg.internal.agent-master.list-agents` 响应说明：

- 顶层字段：`total`、`visible`、`includeHidden`、`agents`、`fetchedAt`
- `agents[]` 字段：`id`、`name`、`role`、`capabilitySet`、`exposed`、`isActive`、`identify`
- `identify` 来源于 `agentId + memoKind(identity)` 的第一条 memo 内容，缺失时返回空字符串。

`builtin.sys-mg.internal.agent-master.create-agent` 参数约定：

- 必填：`name`、`roleId`、`model.id`（或 `modelId`）
- `roleId` 兼容传 role `id` 或 role `code`（推荐传 `id`，传 `code` 时会在创建前自动解析）
- 可选：`description`、`systemPrompt`、`model.*`、`capabilities`、`tools`、`permissions`、`learningAbility`、`isActive`、`apiKeyId`
- `provider` 为 API Key 选择策略参数：默认 `default`（回退到模型 provider）
- 未显式传入 `apiKeyId` 时，系统会按 provider 选择 `isDefault=true && isActive=true` 的 key；若不存在则回退系统默认 key 策略

`builtin.sys-mg.internal.rd-related.docs-write` 参数约定：

- 必填：`filePath`、`content`
- 可选：`mode`（`create|update|append`，默认 `create`）、`overwrite`（默认 `false`）
- 安全约束：仅允许写入 `docs/**` 下 `.md` 文件；禁止绝对路径与 `..` 路径穿越
- 行为约束：
  - `create`：目标文件已存在且未显式 `overwrite=true` 时拒绝写入
  - `update`：目标文件不存在时拒绝写入
  - `append`：目标文件不存在时拒绝写入

Skill Master MCP 参数约定：

- `builtin.sys-mg.mcp.skill-master.list-skills`
  - 支持 `title` 模糊检索（映射到 skill name search）
  - 可选参数：`status`、`category`、`includeMetadata`、`limit`、`page`
- `builtin.sys-mg.mcp.skill-master.create-skill`
  - 必填：`title`（或 `name`）、`description`
  - 可选：`category`、`tags`、`sourceType`、`sourceUrl`、`provider`、`version`、`status`、`confidenceScore`、`metadata`、`content`、`contentType`

Internal Message MCP 参数约定：

- `builtin.sys-mg.mcp.inner-message.send-internal-message`
  - 必填：`receiverAgentId`、`title`、`content`
  - 可选：`eventType`（默认 `inner.direct`）、`payload`、`dedupKey`、`maxAttempts`
  - 执行约束：`senderAgentId` 由运行时执行 Agent 自动注入，不接受外部透传
  - 返回关键字段：`messageId`、`status`、`sentAt`

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
- 任务改派 tier 守卫：
  - `orchestration_reassign_task` 会透传 `sourceAgentId`（运行时注入）用于分派方向校验。
  - 非法分派方向返回 `delegation_direction_forbidden`。
  - 源/目标层级无法解析返回 `tier_resolution_required`。

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

## Usage Billing（`/usage`）

- `GET /usage/overview?period=week|month`：费用、Token、请求数、活跃模型总览（含上一周期对比）
- `GET /usage/daily-trend?from=&to=`：按日返回费用趋势
- `GET /usage/by-agent?from=&to=&limit=10`：按 Agent 聚合排行
- `GET /usage/by-model?from=&to=&limit=10`：按模型聚合排行
- `GET /usage/pricing/status`：定价缓存状态（最后刷新时间、模型条数、覆盖条数）
- `POST /usage/pricing/refresh`：手动刷新 models.dev 定价缓存

## 备注

- Agent 权限与可见性以角色为准：`agent.roleId -> role.code -> MCP profile`。

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
  - 返回扩展字段：`roleCode`、`executionChannel`、`executionData`、`sync`。
- `GET /agents/runtime/metrics`：查询 runtime hooks/outbox 指标（发布量、失败量、队列状态、死信摘要）
- `GET /agents/runtime/sessions?ownerType=&ownerId=&status=&sessionType=&keyword=&page=&pageSize=`：分页查询 session（支持按 Agent 过滤）
- `GET /agents/runtime/sessions/:id`：查询单个 session 详情（含消息轨迹）
- `GET /agents/runtime/sessions/:sessionId/messages`：按 session 查询消息列表（基于 `messageIds` 引用反查）
- `GET /agents/runtime/messages/:messageId/parts`：查询单条 message 的 parts 轨迹
- `GET /agents/runtime/runs/:runId/messages`：查询 run 下全部消息及其 parts
- `GET /agents/runtime/outbox/dead-letter?limit=200&organizationId=&runId=&eventType=`：导出失败事件（死信视图，支持筛选；返回 `total/returned/hasMore`）
- `POST /agents/runtime/outbox/dead-letter/requeue`：批量重投死信（支持 `eventIds` 或筛选条件 + `limit`，可 `dryRun`）
- `GET /agents/runtime/maintenance/audits?limit=&action=&organizationId=&batchId=`：查询运行维护审计日志
- `POST /agents/runtime/maintenance/purge-legacy`：清理 legacy runtime 数据（仅 `system` 角色，需 `confirm=DELETE_LEGACY_RUNTIME_DATA`，可 `dryRun`）
- `POST /agents/runtime/runs/:runId/pause`：暂停 run（支持 body: `reason`、`actorId`、`actorType`）
- `POST /agents/runtime/runs/:runId/resume`：恢复 run（支持 body: `reason`、`actorId`、`actorType`）
- `POST /agents/runtime/runs/:runId/cancel`：取消 run（支持 body: `reason`、`actorId`、`actorType`）
- `POST /agents/runtime/runs/:runId/replay`：重放 run 事件到 hook 通道（支持 body: `eventTypes`、`fromSequence`、`toSequence`、`channel`、`limit`）

OpenCode 运行态查询（规划中）：

- `GET /agents/runtime/runs/:runId/opencode-status`
  - 返回建议字段：`phase/progress/currentStep/blockingReason/approvalState/lastEventAt`。

OpenCode 审批接口（规划中）：

- `GET /agents/runtime/permissions?status=&runId=`
- `POST /agents/runtime/permissions/:id/approve`
- `POST /agents/runtime/permissions/:id/reject`

OpenCode EI 同步补偿（已实现骨架）：

- `POST /agents/runtime/runs/:runId/sync-ei-replay`
  - 作用：按 run 触发一次 EI 同步重放。
- `GET /agents/runtime/sync-ei/dead-letter?limit=`
  - 作用：查询 EI 同步死信 run 列表。
- `POST /agents/runtime/sync-ei/dead-letter/requeue`
  - 入参：`runIds?`、`limit?`、`dryRun?`
  - 作用：将死信 run 重新入队，交由后台重试任务处理。

`agent_runs.sync` 对象字段：

- `state`: `pending|synced|failed`
- `lastSyncAt`
- `retryCount`
- `nextRetryAt`
- `lastError`
- `deadLettered`

## Orchestration Scheduler（Legacy Backend）

- 以下接口由 legacy backend 提供（非 agents service），用于管理定时调度任务：
- 计划创建已升级为“秒回 + 异步编排”：
  - `POST /orchestration/plans/from-prompt` 仅创建占位计划并返回（`status=drafting`）。
  - 后台异步生成任务，前端可通过 `GET /orchestration/plans/:id/events` 订阅事件流，接收 `plan.status.changed` / `plan.task.generated` / `plan.completed` / `plan.failed`。
- `POST /orchestration/schedules`：创建定时计划
- `GET /orchestration/schedules`：获取计划列表
- `GET /orchestration/schedules/:id`：获取计划详情
- `PUT /orchestration/schedules/:id`：更新计划
- `DELETE /orchestration/schedules/:id`：删除计划
- `POST /orchestration/schedules/:id/enable`：启用计划
- `POST /orchestration/schedules/:id/disable`：停用计划
- `POST /orchestration/schedules/:id/trigger`：手动触发计划
- `GET /orchestration/schedules/:id/history?limit=20`：查看执行历史（底层来源：`orchestration_tasks`，`mode=schedule`）

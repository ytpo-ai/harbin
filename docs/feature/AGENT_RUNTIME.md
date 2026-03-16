# Agent Runtime（运行时）

## 1. 功能设计

### 1.1 目标

- 将 Agent 执行链路升级为可持久化、可恢复、可观测、可控制的运行时平台。
- 统一 run 生命周期事件，支持模块外通过 Hook 感知执行状态。
- 建立 outbox + 重试 + 死信 + 审计闭环，降低事件投递失败带来的运行风险。
- 提供 run 控制面与运维接口，支持 pause/resume/cancel/replay、死信重投与 legacy 清理。

### 1.2 数据结构

核心集合位于 `backend/apps/agents/src/schemas/`：

| 集合 | Schema 文件 | 说明 |
|------|-------------|------|
| `agent_runs` | `agent-run.schema.ts` | 运行实例（run），包含 `status/currentStep/task/session` 等状态 |
| `agent_messages` | `agent-message.schema.ts` | run 下消息层（system/user/assistant/tool） |
| `agent_parts` | `agent-part.schema.ts` | 消息分片/步骤层，承载 LLM 增量与工具调用状态 |
| `agent_events_outbox` | `agent-event-outbox.schema.ts` | Hook 外发 outbox（`pending/dispatched/failed`） |
| `agent_runtime_maintenance_audits` | `agent-runtime-maintenance-audit.schema.ts` | 维护操作审计（requeue/purge） |
| `agent_sessions` | `agent-session.schema.ts` | 会话聚合视图（messages/runIds/planContext/meetingContext/memoSnapshot） |

### 1.3 生命周期与状态模型

#### Runtime 事件契约

- 契约定义：`modules/runtime/contracts/runtime-event.contract.ts`
- 统一字段：`eventId/eventType/organizationId/agentId/sessionId/runId/taskId/messageId/partId/toolCallId/sequence/timestamp/traceId/payload`
- 事件类型：
  - `run.started`
  - `run.step.started`
  - `llm.delta`
  - `tool.pending`
  - `tool.running`
  - `tool.completed`
  - `tool.failed`
  - `run.compacted`
  - `run.paused`
  - `run.resumed`
  - `run.completed`
  - `run.failed`
  - `run.cancelled`
  - `permission.asked`
  - `permission.replied`
  - `permission.denied`

#### Run 生命周期

- 启动：`startRun` 创建或恢复 run，并写入 `run.started` 或 `run.resumed`。
- 过程：按 step 递增写入 `run.step.started`；流式输出写入 `llm.delta`。
- 结束：成功写入 `run.completed`；异常写入 `run.failed`；控制面打断写入 `run.paused/run.resumed/run.cancelled`。
- 可执行性守卫：`assertRunnable` 在执行过程中阻断 `paused/cancelled/failed/completed` run 继续运行。

#### OpenCode 执行门禁与扩展字段（已实现：第一阶段）

- 执行前门禁：
- 角色准入仅允许 `devops-engineer`、`fullstack-engineer`、`technical-architect`。
  - 模型绑定匹配：请求模型需命中 Agent 绑定模型或显式 fallback 白名单（受环境变量 `OPENCODE_MODEL_BINDING_CHECK_ENABLED` 控制，默认关闭）。
  - 配额检测：按 `agent + period` 检测，超限触发 `permission.asked` 审批流并暂停 run。
- 执行通道一致性：当 `agent.config.execution.provider=opencode` 时，非流式与流式路径均强制走 OpenCode 执行桥接，不允许回落 native 模型通道。
- `config` 解析入口：从 `agent.config.execution` 与 `agent.config.budget` 读取执行与预算策略。
- OpenCode 项目目录：支持 `agent.config.execution.projectDirectory`，用于创建 OpenCode session 时绑定目录上下文。
- OpenCode Endpoint 解析优先级：`agent.config.execution.endpoint` > `agent.config.execution.endpointRef` > `context.opencodeRuntime.endpoint` > `context.opencodeRuntime.endpointRef` > `OPENCODE_SERVER_URL`。
- OpenCode 认证开关：支持 `agent.config.execution.auth_enable`（boolean，默认 `false`）；仅当为 `true` 时读取 `OPENCODE_SERVER_PASSWORD` 并携带 Basic Auth（username=`opencode`）。
- OpenCode 调用通道：Runtime 侧已移除 SDK 依赖，统一通过 OpenCode HTTP API（含 SSE）直连执行与事件读取。
- OpenCode session 创建时会显式透传当前执行模型（`providerID/modelID`），保证 session 模型与 Agent 绑定模型对齐。
- 当 `OPENCODE_MODEL_BINDING_CHECK_ENABLED=false` 时，创建 session 与发送 message 仅透传执行模型，不再因为绑定不一致直接阻断；后续可在 OpenCode 可用模型列表稳定后再开启严格校验。
- 优先级约束说明见：`docs/TIP.MD`（用于排查 endpoint 错配、默认 env 误命中）。

#### OpenCode 任务流故障记录（2026-03-16）

- 现象：`/agents/tasks/:taskId/events` 可收到 `result(status=succeeded)`，但 `token` 事件为空，`result.response` 也为空。
- 根因：
  - endpoint 选择链路存在优先级偏差，部分分支会误回退到环境默认地址。
  - OpenCode `POST /session/:id/message` 在部分版本下返回文本位于 `parts/info.parts`，而非仅 `info.content/content`，导致响应解析为空。
  - 执行桥接只在尾部回填 response，未稳定把事件增量回调到 Task SSE `token` 事件。
- 修复：
  - 统一 endpoint 解析优先级（见上方规则与 `docs/TIP.MD`）。
  - 扩展消息响应解析：支持 `parts/info.parts/payload.parts/message/output` 多路径提取。
  - OpenCode 执行桥接增加 `onDelta`，每个 delta 实时透传为 Task SSE `token` 事件；若 message response 为空则按事件重建最终 response。
- `agent_runs` 扩展字段：
  - `executionChannel`（`native|opencode`）
  - `roleCode`
  - `executionData`（含模型快照、OpenCode 开关、同步诊断信息）
  - `sync`（对象）：`state/lastSyncAt/retryCount/nextRetryAt/lastError/deadLettered`
- 同步策略：run 终态后触发 EI 异步同步，失败进入自动重试，超限进入死信，可通过 run 级 replay 与 dead-letter requeue 补齐。

#### Agent Task SSE 重试与超时治理（已实现：第二阶段）

- Agent Task 增加 `stepTimeoutMs/taskTimeoutMs/maxAttempts/retryBaseDelayMs/retryMaxDelayMs` 字段。
- Worker 对单次执行启用 step timeout 守卫；对任务全生命周期启用 task timeout 守卫。
- 错误分类支持 `retryable/fatal/cancelled`：仅 retryable 错误进入指数退避 + jitter 重试。
- SSE 事件流增加 `retry_scheduled/retry_started` 语义（通过 progress payload 承载），并在任务查询接口返回 `attempt/nextRetryAt` 等字段。

#### 工具调用状态机（part 级）

- 迁移规则：`pending -> running -> completed`，失败允许 `pending|running -> error`。
- 实现位置：`runtime-orchestrator.service.ts` + `runtime-persistence.service.ts#transitionPartStatus`。
- 非法迁移会抛错，防止工具状态污染。
- 工具事件载荷统一包含 `toolId/toolName/params`（兼容保留 `input` 别名），其中 `params` 会对敏感键（如 `password/token/secret`）做脱敏后写入日志。

### 1.4 Hook 外发与恢复机制

- Dispatcher：`hook-dispatcher.service.ts`
- 默认通道：
  - Agent 级：`agent-runtime:{agentId}`
- 分发语义：at-least-once；消费者侧需按 `eventId` 去重，必要时结合 `(runId, sequence)` 做顺序校验。
- outbox 流程：
  - 事件先写 `agent_events_outbox`
  - 发布成功标记 `dispatched`
  - 发布失败标记 `failed`，并按指数退避设置 `nextRetryAt`
  - 定时 flush 自动重试
- replay：支持按 `eventTypes/fromSequence/toSequence/channel/limit` 重放 run 事件。
- 状态钩子同步日志：`HookDispatcher` 在分发成功链路内同步调用 legacy `agent-action-logs` 内部接口，写入 `agent_action_logs`，并以 `sourceEventId=eventId` 做幂等。
- 同步写入的工具事件会在 `details` 顶层透出 `toolId/toolName/params`，便于系统进程日志与任务维度日志直接检索。
- 大 payload 防护：同步 legacy 前会对超大 `payload`（尤其 `tool.completed.payload.output`）做截断摘要，写入 `outputPreview/outputSize/outputTruncated`，避免请求体过大导致 `413`。

### 1.5 控制面与运行维护

内部 API 前缀：`/agents/runtime`

- run 控制：`GET runs/:runId`、`POST runs/:runId/pause|resume|cancel|replay`
- EI 同步补偿：`POST runs/:runId/sync-ei-replay`、`GET sync-ei/dead-letter`、`POST sync-ei/dead-letter/requeue`
- 运行观测：`GET metrics`
- session 查询：`GET sessions`、`GET sessions/:id`
- 死信治理：`GET outbox/dead-letter`、`POST outbox/dead-letter/requeue`
- 维护审计：`GET maintenance/audits`
- legacy 清理：`POST maintenance/purge-legacy`

控制约束（当前实现）：

- 角色要求：`system/admin/owner`
- `purge-legacy` 仅 `system` 角色可执行，且必须携带 `confirm=DELETE_LEGACY_RUNTIME_DATA`

### 1.6 Session 与上下文协同

- 会话模型支持 `meeting/task` 两类，并可按 `meetingId` 或 `taskId` 复用会话。
- system 消息写入时进行内容归一化与上下文键去重，避免重复注入提示词。
- Agent 运行前会按“已授权工具”读取工具配置中的 `prompt` 字段并注入 system 消息，实现工具级策略约束。
- runtime 启动时可刷新 `memoSnapshot`（identity/todo/topic），将备忘录摘要挂载到 session 侧缓存。
- Agent 主执行链路（`modules/agents/agent.service.ts`）已接入 runtime 的 run 生命周期与工具状态事件。
- Agent 主执行链路已按职责拆分协作：
  - `modules/agents/agent-execution.service.ts`（runtime 生命周期模板与收尾）
  - `modules/agents/agent-opencode-policy.service.ts`（OpenCode gate/budget 策略）
  - `modules/agents/agent-orchestration-intent.service.ts`（会议编排意图与强制工具映射）
  - `modules/agents/agent-mcp-profile.service.ts`（MCP profile 映射与权限集逻辑）
- 当 `agent.config.execution.provider=opencode` 时，非流式与流式执行均强制走 OpenCode 通道；流式路径不再回落到 native `streamingChat`。
- 模型调用默认优先走统一 provider 路由；`alibaba/qwen-*` 已在 `AIV2Provider` 中通过 OpenAI 兼容端点接入，避免落入 generic provider 提示分支。
- 会议场景编排意图触发已收敛：移除“执行/继续/开始”单词级触发，新增“否定编排”阻断分支，减少误判。
- 工具 ID 在运行时统一归一化到 canonical（如 `builtin.sys-mg.mcp.orchestration.*`），并兼容 legacy 别名映射，避免“已分配却被判定未分配”。

---

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `AGENT_RUNTIME_OVERHAUL_PLAN.md` | Runtime 重构规划入口（已合并到开发沉淀） |
| `AGENT_RUNTIME_FEATURE_DOC_PLAN.md` | Runtime 功能文档沉淀计划（本次） |
| `OPENCODE_SERVE_INTERACTION_MASTER_PLAN.md` | OpenCode 交互主计划与角色/预算约束 |
| `OPENCODE_AGENT_TASK_SSE_WORKER_PLAN.md` | OpenCode 长任务抗超时改造计划（Worker + SSE） |
| `AGENT_TASK_SSE_MULTI_SERVE_PLAN.md` | Agent Task SSE 化与 Multi-Serve OpenCode 接入计划 |
| `AGENT_CONFIG_JSON_EXTENSION_PLAN.md` | Agent `config` 字段扩展与运行时解析计划 |
| `OPENCODE_SDK_REMOVAL_API_DIRECT_CALL_PLAN.md` | OpenCode SDK 移除与 API 直连改造计划 |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| `AGENT_RUNTIME_OVERHAUL_PLAN.md` | Runtime 重构落地说明、能力边界与 commit 映射 |
| `AGENT_MESSAGE_CONTENT_VALIDATION_PLAN.md` | AgentMessage content 必填校验修复与写入链路一致性说明 |
| `OPENCODE_TODO_ROUND1_EXECUTION_PLAN.md` | OpenCode Round1（config/门禁/同步/补偿）开发总结 |
| `OPENCODE_SDK_REMOVAL_API_DIRECT_CALL_PLAN.md` | OpenCode SDK 移除与 API 直连实现总结 |
| `AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_C_AGENTS_REFACTOR_PHASE1.md` | Agent 执行链路公共能力提取（AgentExecutionService）开发沉淀 |

### 技术/架构文档 (docs/technical/, docs/api/)

| 文件 | 说明 |
|------|------|
| `technical/AGENT_RUNTIME_HOOKS_GUIDE.md` | Hook 消费幂等、重放与可观测性实践 |
| `technical/AGENT_RUNTIME_WORKFLOW_TECHNICAL_DESIGN.md` | Runtime 工作流技术设计 |
| `technical/OPENCODE_AGENT_TASK_SSE_WORKER_TECHNICAL_DESIGN.md` | OpenCode 长任务抗超时技术设计（Worker + SSE） |
| `technical/AGENT_TASK_SSE_MULTI_SERVE_TECHNICAL_DESIGN.md` | Agent Task SSE 化与 Multi-Serve OpenCode 技术设计 |
| `technical/OPENCODE_EI_DATA_LAYER_TECHNICAL_DESIGN.md` | OpenCode 执行事实层与 EI 分析层分层设计 |
| `technical/OPENCODE_MULTI_ENV_COLLAB_TECHNICAL_DESIGN.md` | local/ecds 多环境协同与 ingest 同步设计 |
| `api/agents-api.md` | Runtime Hooks 与 Run Control API 清单 |

---

## 3. 相关代码文件

### 后端 Runtime 模块 (backend/apps/agents/src/modules/runtime/)

| 文件 | 功能 |
|------|------|
| `runtime.module.ts` | Runtime 模块装配与依赖注入 |
| `runtime.controller.ts` | Runtime 控制面与运维 API |
| `runtime-orchestrator.service.ts` | run 生命周期编排、事件写入、工具状态迁移 |
| `runtime-persistence.service.ts` | run/message/part/outbox/session/审计持久化实现 |
| `hook-dispatcher.service.ts` | Hook 事件分发、重试、flush 与指标 |
| `runtime-action-log-sync.service.ts` | Runtime 状态钩子同步写入 Agent Action Logs |
| `contracts/runtime-event.contract.ts` | 运行时事件契约（zod） |
| `contracts/runtime-run.contract.ts` | run 与工具事件输入契约 |
| `contracts/runtime-control.contract.ts` | 控制面与运维接口入参契约 |

### 后端 Schema (backend/apps/agents/src/schemas/)

| 文件 | 功能 |
|------|------|
| `agent-run.schema.ts` | run 主状态模型 |
| `agent-message.schema.ts` | message 模型 |
| `agent-part.schema.ts` | part 模型（含工具状态） |
| `agent-event-outbox.schema.ts` | 事件外发 outbox 模型 |
| `agent-runtime-maintenance-audit.schema.ts` | 运行维护审计模型 |
| `agent-session.schema.ts` | 会话模型（含 `memoSnapshot`） |

### 集成接入

| 文件 | 功能 |
|------|------|
| `modules/agents/agent.service.ts` | Agent 执行链路接入 runtime（start/assert/complete/fail/tool events） |
| `modules/agents/agent-execution.service.ts` | Agent 执行链公共模板（start/complete/fail/release） |
| `modules/agents/agent-opencode-policy.service.ts` | OpenCode 执行门禁与预算审批策略 |
| `modules/agents/agent-orchestration-intent.service.ts` | 会议编排意图识别与强制工具调用映射 |
| `modules/agents/agent-mcp-profile.service.ts` | MCP profile 读写、映射与权限集下沉服务 |
| `modules/agent-tasks/agent-task.controller.ts` | Agent Task 异步任务 API（create/get/cancel/SSE） |
| `modules/agent-tasks/agent-task.service.ts` | Agent Task 状态管理、幂等、事件续传与权限校验 |
| `modules/agent-tasks/agent-task.worker.ts` | 异步 Worker 消费队列并驱动 runtime + OpenCode 执行 |
| `modules/agent-tasks/runtime-sse-stream.service.ts` | SSE 实时流 + 心跳 + Redis 订阅桥接 |
| `modules/agent-tasks/opencode-serve-router.service.ts` | Multi-Serve 路由与会话粘性所需 serve 选择能力 |
| `schemas/agent-task.schema.ts` | Agent Task 状态持久化模型（queued/running/succeeded/failed/cancelled） |
| `backend/apps/gateway/src/gateway-proxy.service.ts` | Runtime 控制类路径网关侧审计日志 |
| `backend/src/modules/agent-action-logs/agent-action-log.controller.ts` | Runtime hook 内部写入入口与查询接口 |

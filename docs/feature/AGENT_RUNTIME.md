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
  - 模型绑定匹配：请求模型需命中 Agent 绑定模型或显式 fallback 白名单。
  - 配额检测：按 `agent + period` 检测，超限触发 `permission.asked` 审批流并暂停 run。
- 执行通道一致性：当 `agent.config.execution.provider=opencode` 时，非流式与流式路径均强制走 OpenCode 执行桥接，不允许回落 native 模型通道。
- `config` 解析入口：从 `agent.config.execution` 与 `agent.config.budget` 读取执行与预算策略。
- OpenCode 项目目录：支持 `agent.config.execution.projectDirectory`，用于创建 OpenCode session 时绑定目录上下文。
- `agent_runs` 扩展字段：
  - `executionChannel`（`native|opencode`）
  - `roleCode`
  - `executionData`（含模型快照、OpenCode 开关、同步诊断信息）
  - `sync`（对象）：`state/lastSyncAt/retryCount/nextRetryAt/lastError/deadLettered`
- 同步策略：run 终态后触发 EI 异步同步，失败进入自动重试，超限进入死信，可通过 run 级 replay 与 dead-letter requeue 补齐。

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
| `AGENT_CONFIG_JSON_EXTENSION_PLAN.md` | Agent `config` 字段扩展与运行时解析计划 |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| `AGENT_RUNTIME_OVERHAUL_PLAN.md` | Runtime 重构落地说明、能力边界与 commit 映射 |
| `AGENT_MESSAGE_CONTENT_VALIDATION_PLAN.md` | AgentMessage content 必填校验修复与写入链路一致性说明 |
| `OPENCODE_TODO_ROUND1_EXECUTION_PLAN.md` | OpenCode Round1（config/门禁/同步/补偿）开发总结 |

### 技术/架构文档 (docs/technical/, docs/api/)

| 文件 | 说明 |
|------|------|
| `technical/AGENT_RUNTIME_HOOKS_GUIDE.md` | Hook 消费幂等、重放与可观测性实践 |
| `technical/AGENT_RUNTIME_WORKFLOW_TECHNICAL_DESIGN.md` | Runtime 工作流技术设计 |
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
| `backend/apps/gateway/src/gateway-proxy.service.ts` | Runtime 控制类路径网关侧审计日志 |
| `backend/src/modules/agent-action-logs/agent-action-log.controller.ts` | Runtime hook 内部写入入口与查询接口 |

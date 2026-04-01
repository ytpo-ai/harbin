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
| `agent_messages` | `agent-message.schema.ts` | run 下消息层（system/user/assistant/tool），assistant step 级持久化（含 `parentMessageId/stepIndex/finish/tokens/cost`） |
| `agent_parts` | `agent-part.schema.ts` | 消息分片/步骤层，承载 LLM 增量与工具调用状态（含 `step_start/step_finish`） |
| `agent_events_outbox` | `agent-event-outbox.schema.ts` | Hook 外发 outbox（`pending/dispatched/failed`） |
| `agent_runtime_maintenance_audits` | `agent-runtime-maintenance-audit.schema.ts` | 维护操作审计（requeue/purge） |
| `agent_sessions` | `agent-session.schema.ts` | 会话聚合视图（`messageIds` 引用、runIds/planContext/meetingContext/memoSnapshot） |

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
- 执行通道一致性：当 `agent.config.execution.provider=opencode` 时，执行能力为“可路由双通道”；具体 run 按任务类型判定走 `opencode` 或 `native`，命中 `opencode` 后非流式与流式路径均强制走 OpenCode 执行桥接。
- `config` 解析入口：从 `agent.config.execution` 与 `agent.config.budget` 读取执行与预算策略。
- OpenCode 项目目录：支持 `agent.config.execution.projectDirectory`，用于创建 OpenCode session 时绑定目录上下文。
- OpenCode Endpoint 解析优先级：`agent.config.execution.endpoint` > `agent.config.execution.endpointRef` > `context.opencodeRuntime.endpoint` > `context.opencodeRuntime.endpointRef` > `OPENCODE_SERVER_URL`。
- OpenCode 认证开关：支持 `agent.config.execution.auth_enable`（boolean，默认 `false`）；仅当为 `true` 时读取 `OPENCODE_SERVER_PASSWORD` 并携带 Basic Auth（username=`opencode`）。
- OpenCode 调用通道：Runtime 侧已移除 SDK 依赖，统一通过 OpenCode HTTP API（含 SSE）直连执行与事件读取。
- OpenCode 消息持久化：执行桥接会按 step 聚合事件并写入 `agent_messages + agent_parts`（`step_start/step_finish` + tool/reasoning/text parts）。
- Model usage 对齐：`ModelService.chat` 返回结构化 usage，并统一归一化到 Runtime message tokens（含 cacheRead/cacheWrite 口径修正）。
- OpenCode session 创建时会显式透传当前执行模型（`providerID/modelID`），保证 session 模型与 Agent 绑定模型对齐。
- 当 `OPENCODE_MODEL_BINDING_CHECK_ENABLED=false` 时，创建 session 与发送 message 仅透传执行模型，不再因为绑定不一致直接阻断；后续可在 OpenCode 可用模型列表稳定后再开启严格校验。
- 优先级约束说明见：`docs/TIP.MD`（用于排查 endpoint 错配、默认 env 误命中）。
- 任务类型路由优先级：`context.runtimeRouting.preferredChannel` > `agent.config.execution.taskRouting` > 内置默认映射（编码类任务走 OpenCode，其他默认 native）。
- `agent.config.execution.taskRouting` 支持 `opencodeTaskTypes[]`、`nativeTaskTypes[]`、`defaultChannel(native|opencode)`，用于按业务任务类型自定义路由。

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
  - OpenCode 取消链路统一为 `POST /session/:id/abort`，并复用执行时解析的 runtime endpoint，避免取消阶段误回退到环境默认地址。
  - 取消链路增加可观测日志：`session captured`、`abort start/success/failed`（含 endpoint）。
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
- OpenCode streaming 执行改为“先订阅事件再发送 prompt”：`executeWithRuntimeBridge` 在 `promptSession` 阻塞期间实时消费 `/event`，将 delta 立即透传到 Task SSE（方案 A 主路径）。
- Worker 对 OpenCode 通道启用活动感知超时：周期查询 `GET /session/:id` 判断活跃状态，按“无活动超时 + 绝对上限”触发取消（方案 B 兜底）。

#### 工具调用状态机（part 级）

- 迁移规则：`pending -> running -> completed`，失败允许 `pending|running -> error`。
- 实现位置：`runtime-orchestrator.service.ts` + `runtime-persistence.service.ts#transitionPartStatus`。
- 非法迁移会抛错，防止工具状态污染。
- 工具事件载荷统一包含 `toolId/toolName/params`（兼容保留 `input` 别名），其中 `params` 会对敏感键（如 `password/token/secret`）做脱敏后写入日志。

### 1.4 Lifecycle Hook 标准化体系

#### 1.4.1 统一 Hook 协议

所有生命周期 hooks 统一实现 `LifecycleHook` 接口，覆盖四个维度：

| 维度 | 阶段（Phase） | 接入点 |
|------|--------------|--------|
| Task | `task.created` / `task.running` / `task.completed` / `task.failed` / `task.cancelled` | `AgentTaskService` + `AgentTaskWorker` |
| Step | `step.before` / `step.after` | `AgentExecutorService` |
| ToolCall | `toolcall.pending` / `toolcall.running` / `toolcall.completed` / `toolcall.failed` | `RuntimeOrchestratorService` |
| Permission | `permission.asked` / `permission.replied` / `permission.denied` | `RuntimeOrchestratorService` |

- 协议定义：`modules/runtime/hooks/lifecycle-hook.types.ts`
- 每个 hook 具有 `id`（唯一标识）、`phases`（适用阶段）、`priority`（优先级，越小越先执行）、`enabled`（运行时开关）
- 执行结果 `LifecycleHookResult` 支持 `action: continue|skip|abort` + `appendMessages` + `mutatedPayload` + `metadata`

#### 1.4.2 HookRegistry 动态注册中心

- 实现位置：`modules/runtime/hooks/hook-registry.service.ts`
- 支持 `register(hook)` / `unregister(hookId)` 动态管理
- 通过 `LIFECYCLE_HOOKS_TOKEN` multi provider 自动发现已注册 hooks
- `provideLifecycleHook(HookClass)` 辅助函数简化注册
- `listAll()` 提供运维可观测性

#### 1.4.3 HookPipeline 调度器

- 实现位置：`modules/runtime/hooks/hook-pipeline.service.ts`
- 按优先级串行执行该阶段所有匹配 hooks
- 单个 hook 异常不阻塞 pipeline（记录到 metadata 后继续）
- `mutatedPayload` 在 hooks 间累积传递
- `abort` 可中止后续执行
- 内置耗时日志与执行轨迹

#### 1.4.4 现有 Step Hooks 迁移

- `AgentBeforeStepOptimizationHook` 和 `AgentAfterStepEvaluationHook` 已同时实现 `LifecycleHook` 接口
- `AgentExecutorService` 中原有的 `agentBeforeStepHooks[]` / `agentAfterStepHooks[]` 硬编码数组已替换为 `HookPipelineService.run()` 调用
- 旧的 `AgentBeforeStepHook` / `AgentAfterStepHook` 接口保留，用于向后兼容

#### 1.4.5 插件化扩展

新增 hook 只需：
1. 创建 `@Injectable()` 类实现 `LifecycleHook` 接口
2. 在对应 Module 的 `providers` 中添加 `provideLifecycleHook(MyHook)`
3. 无需修改任何核心服务代码

### 1.5 Hook 外发与恢复机制（Dispatcher）

- Dispatcher：`hook-dispatcher.service.ts`（与 Lifecycle Hook Pipeline 独立，负责异步通知）
- 默认通道：
  - Agent 级：`agent-runtime:{agentId}`
- 分发语义：at-least-once；消费者侧需按 `eventId` 去重，必要时结合 `(runId, sequence)` 做顺序校验。
- outbox 流程：
  - 事件先写 `agent_events_outbox`
  - 发布成功标记 `dispatched`
  - 发布失败标记 `failed`，并按指数退避设置 `nextRetryAt`
  - 定时 flush 自动重试
- replay：支持按 `eventTypes/fromSequence/toSequence/channel/limit` 重放 run 事件。
- 状态钩子同步日志：`HookDispatcher` 在分发成功链路内同步调用 agents 应用内 `AgentActionLogService`，写入 `agent_action_logs`，并以 `sourceEventId=eventId` 做幂等。
- 同步写入的工具事件会在 `details` 顶层透出 `toolId/toolName/params`，便于系统进程日志与任务维度日志直接检索。
- 大 payload 防护：同步 legacy 前会对超大 `payload`（尤其 `tool.completed.payload.output`）做截断摘要，写入 `outputPreview/outputSize/outputTruncated`，避免请求体过大导致 `413`。
- 日志查询阶段会按 `runId` 回查 `agent_runs` 元数据，补全 `taskTitle/meetingTitle/planId/planTitle/environmentType`，用于前端任务卡片“环境说明”展示。

**Pipeline vs Dispatcher 职责区分**：
- `HookPipelineService`：**同步拦截层**，在状态变更前执行，可修改行为（abort/inject/mutate）
- `HookDispatcherService`：**异步通知层**，在状态变更后执行，负责 RuntimeEvent pub/sub 外发

### 1.6 控制面与运行维护

内部 API 前缀：`/agents/runtime`

- run 控制：`GET runs/:runId`、`POST runs/:runId/pause|resume|cancel|replay`
- run 列表：`GET runs?agentId=...`（支持 `status/from/to/page/pageSize` 分页筛选，按 `startedAt desc`）
- EI 同步补偿：`POST runs/:runId/sync-ei-replay`、`GET sync-ei/dead-letter`、`POST sync-ei/dead-letter/requeue`
- 运行观测：`GET metrics`
- session 查询：`GET sessions`、`GET sessions/:id`
- 死信治理：`GET outbox/dead-letter`、`POST outbox/dead-letter/requeue`
- 维护审计：`GET maintenance/audits`
- legacy 清理：`POST maintenance/purge-legacy`
- 数据清理脚本：`npm run cleanup:agents-runtime`（默认 dry-run；执行删除需 `--execute --confirm=DELETE_RUNTIME_DATA`）

控制约束（当前实现）：

- 角色要求：`system/admin/owner`
- `purge-legacy` 仅 `system` 角色可执行，且必须携带 `confirm=DELETE_LEGACY_RUNTIME_DATA`

### 1.7 Session 与上下文协同

- 会话模型支持 `meeting/task` 两类，并可按 `meetingId` 或 `taskId` 复用会话。
- system context 仍由 ContextAssembler 动态组装；`run.metadata.initialSystemMessages` 继续保留初始 system 快照。
- 历史描述“system 不写入 `agent_messages`（已弃用）”：当前实现在部分 tool-calling 分支会持久化中间 system 消息（如 tool denied / input preflight failed / retry instruction）。
- Agent 运行前会按“已授权工具”读取工具配置中的 `prompt` 字段并注入 system 消息，实现工具级策略约束。
- runtime 启动时可刷新 `memoSnapshot`（identity/todo/topic），并改为通过 Redis 队列异步写入 session 缓存，避免主链路同步落库阻塞。
- Agent 详情页 Session 抽屉支持“按角色默认展开策略”（`system` 默认折叠，其他角色默认展开）；消息正文折叠态不再展示前置片段，需手动展开查看完整内容。
- Session 消息卡片默认隐藏 `runId/taskId/messageId` 等标识字段，新增“查看原始信息”面板按需展开，并支持一键复制原始 message JSON。
- Session 抽屉头部提供刷新图标按钮，可手动重载当前 Session 详情与列表数据。
- Session 详情查询会补齐 run 级 `user/system` 消息：除 `session.messageIds` 外，额外按 `runId` 回查缺失的 `user/system` 记录。
- Agent 详情页日志列表按 `runId` 精简为“每个任务一条最终摘要”；展开后改为「执行流程 / 原始信息 / 扣分记录」三 Tab，并在展开时懒加载 `GET /agents/runtime/runs/:runId/score` 扣分详情。
- 历史描述“注入 `run.metadata.initialSystemMessages` 虚拟 system message 返回”（已弃用）：当前实现不再注入 `virtual-system-*` 消息。
- Agent 主执行链路（`modules/agents/agent.service.ts`）已接入 runtime 的 run 生命周期与工具状态事件。
- legacy `inner-message` 分发链路支持 Runtime Bridge：内部消息可统一桥接到 Agent `executeTask` 执行入口，由 Agent 按角色能力自主处理。
- Agent 主执行链路已按职责拆分协作：
  - `backend/libs/common/src/debug-timing.provider.ts`（`debugTiming` 统一 Provider，集中开关读取与耗时日志格式，供执行链路复用）
  - `modules/agents/agent-executor-runtime.service.ts`（runtime 生命周期模板与收尾）
  - `modules/agents/agent-opencode-policy.service.ts`（OpenCode gate/budget 策略）
  - `modules/agents/agent-before-step-optimization.hook.ts`（step 进入前语义优化 Hook，实现 `LifecycleHook` 接口，phase=`step.before`）
  - `modules/agents/agent-after-step-evaluation.hook.ts`（step 完成后语义评估 Hook，实现 `LifecycleHook` 接口，phase=`step.after`）
  - `modules/agents/agent-executor-step-hooks.types.ts`（旧 before/after Hook 协议类型，保留向后兼容）
  - `modules/runtime/hooks/lifecycle-hook.types.ts`（统一 Lifecycle Hook 协议定义，覆盖 Task/Step/ToolCall/Permission 四维度）
  - `modules/runtime/hooks/hook-registry.service.ts`（Hook 动态注册中心）
  - `modules/runtime/hooks/hook-pipeline.service.ts`（Hook 调度器，串行执行 + 容错 + 可观测）
  - `agent-executor.service.ts` 通过 `HookPipelineService.run()` 统一调度 step hooks，不再维护硬编码数组。
  - `modules/agents/agent-orchestration-intent.service.ts`（历史项，文件已于 2026-03-19 删除）
  - `modules/agents/agent-mcp-profile.service.ts`（MCP profile 映射与权限集逻辑）
- Agent Prompt 文案已集中到 `modules/prompt-registry/agent-prompt-catalog.ts`，按 `symbol/slug/scene/role/defaultContent` 管理；执行时仅在 Redis 存在已发布模板缓存时才触发 resolver 读取，Redis 未命中统一回退 `code_default`（不再依赖 DB 兜底）。
- Agent/Skill 已支持 `promptTemplateRef: { scene, role }` 绑定：Identity Layer 在 `systemPrompt` 后追加 Agent 绑定模板；Toolset Layer 在技能激活时优先解析 Skill 绑定模板并替换 `skill.content`，失败回退原技能正文。
- Identity Layer 注入门槛：`systemPrompt` 在 `trim` 后长度 `< 5` 时不注入 session 上下文（同时不参与 identity base 内容拼装）。
- Agent Task Worker 会透传 `sessionContext.runtimeTaskType/runtimeChannelHint` 到 `context.runtimeRouting`，用于异步任务执行时的 runtime 通道路由。
- Agent Task Tool 级状态会写入 Redis（`pending/running/completed/failed`），任务终态（成功/失败/取消/超时）统一回写 `idle`，供 MCP `list-agents` 实时查询。
- 当路由命中 `opencode` 时，非流式与流式执行均强制走 OpenCode 通道；流式路径不再回落到 native `streamingChat`。
- 模型调用默认优先走统一 provider 路由；`alibaba/qwen-*` 已在 `AIV2Provider` 中通过 OpenAI 兼容端点接入，避免落入 generic provider 提示分支。
- 会议场景编排意图触发已收敛：移除“执行/继续/开始”单词级触发，新增“否定编排”阻断分支，减少误判。
- 工具 ID 在运行时统一归一化到 canonical（如 `builtin.sys-mg.mcp.orchestration.*`），并兼容 legacy 别名映射，避免“已分配却被判定未分配”。
- Agent 执行入口（`POST /api/agents/:id/execute`）支持 `_id` 与业务 `id` 双标识查询；非 ObjectId 标识（如 `executive-lead`）不再触发 `_id` CastError。

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
| `AGENT_EXECUTE_IDENTIFIER_COMPAT_PLAN.md` | Agent 执行入口 `id/_id` 双标识兼容修复计划 |
| `AGENT_EXECUTOR_ENGINE_ROUTING_PLAN.md` | Agent Executor Engine 路由重构计划（按 mode/channel 分发执行实例） |
| `OPENCODE_SDK_REMOVAL_API_DIRECT_CALL_PLAN.md` | OpenCode SDK 移除与 API 直连改造计划 |
| `AGENT_PROMPT_RESOLVER_REFACTOR_PLAN.md` | Agent Prompt 文案集中化与模板渲染接入计划 |
| `PROMPT_RESOLVE_REDIS_GUARD_PLAN.md` | Prompt 发布写 Redis 与执行阶段 Redis 门禁回退计划 |
| `AGENT_LIFECYCLE_HOOK_STANDARDIZATION_PLAN.md` | Agent Lifecycle Hook 标准化设计计划 |
| `AGENT_PROMPT_OPTIONAL_MIN_LENGTH_INJECTION_PLAN.md` | Agent Prompt 可选化与最小注入长度优化计划 |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| `AGENT_RUNTIME_OVERHAUL_PLAN.md` | Runtime 重构落地说明、能力边界与 commit 映射 |
| `AGENT_MESSAGE_CONTENT_VALIDATION_PLAN.md` | AgentMessage content 必填校验修复与写入链路一致性说明 |
| `OPENCODE_TODO_ROUND1_EXECUTION_PLAN.md` | OpenCode Round1（config/门禁/同步/补偿）开发总结 |
| `OPENCODE_SDK_REMOVAL_API_DIRECT_CALL_PLAN.md` | OpenCode SDK 移除与 API 直连实现总结 |
| `AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_C_AGENTS_REFACTOR_PHASE1.md` | Agent 执行链路公共能力提取（AgentExecutorRuntimeService）开发沉淀 |
| `AGENT_UNIFIED_INNER_MESSAGE_RUNTIME_PLAN.md` | inner-message 统一桥接 Agent Runtime 执行链开发总结 |
| `RD_CONVERSATION_CHAT_EVENTS_UI_OPTIMIZATION_DEVELOPMENT_SUMMARY.md` | 研发会话页新增「测试 Opencode SSE」联调入口与任务流观测配套改造沉淀 |

### 技术/架构文档 (docs/technical/, docs/api/)

| 文件 | 说明 |
|------|------|
| `technical/AGENT_RUNTIME_HOOKS_GUIDE.md` | Hook 消费幂等、重放与可观测性实践 |
| `technical/AGENT_LIFECYCLE_HOOK_TECHNICAL_DESIGN.md` | Lifecycle Hook 标准化体系技术设计（Registry + Pipeline） |
| `technical/AGENT_RUNTIME_WORKFLOW_TECHNICAL_DESIGN.md` | Runtime 工作流技术设计 |
| `technical/OPENCODE_AGENT_TASK_SSE_WORKER_TECHNICAL_DESIGN.md` | OpenCode 长任务抗超时技术设计（Worker + SSE） |
| `technical/AGENT_TASK_SSE_MULTI_SERVE_TECHNICAL_DESIGN.md` | Agent Task SSE 化与 Multi-Serve OpenCode 技术设计 |
| `technical/AGENT_EXECUTOR_ENGINE_ROUTING_TECHNICAL_DESIGN.md` | Agent Executor Engine 路由分层与扩展机制技术设计 |
| `technical/OPENCODE_EI_DATA_LAYER_TECHNICAL_DESIGN.md` | OpenCode 执行事实层与 EI 分析层分层设计 |
| `technical/OPENCODE_MULTI_ENV_COLLAB_TECHNICAL_DESIGN.md` | local/ecds 多环境协同与 ingest 同步设计 |
| `api/agents-api.md` | Runtime Hooks 与 Run Control API 清单 |
| `plan/MEMO_ASYNC_WRITE_QUEUE_PLAN.md` | memo 写入异步化改造方案 |

---

## 3. 相关代码文件

### 后端 Runtime 模块 (backend/apps/agents/src/modules/runtime/)

| 文件 | 功能 |
|------|------|
| `runtime.module.ts` | Runtime 模块装配与依赖注入 |
| `runtime.controller.ts` | Runtime 控制面与运维 API |
| `runtime-orchestrator.service.ts` | run 生命周期编排、事件写入、工具状态迁移 |
| `runtime-persistence.service.ts` | run/message/part/outbox/session/审计持久化实现 |
| `hook-dispatcher.service.ts` | Hook 事件异步分发（Redis pub/sub）、重试、flush 与指标 |
| `hooks/lifecycle-hook.types.ts` | 统一 Lifecycle Hook 协议定义（LifecycleHook 接口、Phase 枚举、Payload 类型） |
| `hooks/hook-registry.service.ts` | Hook 动态注册中心（register/unregister/自动发现） |
| `hooks/hook-pipeline.service.ts` | Hook 调度器（串行执行、优先级排序、容错降级、可观测） |
| `hooks/lifecycle-hook.helpers.ts` | Hook 辅助工具（provideLifecycleHook 注册函数） |
| `hooks/index.ts` | hooks 模块统一导出 |
| `runtime-action-log-sync.service.ts` | Runtime 状态钩子同步写入 Agent Action Logs |
| `runtime-memo-snapshot-queue.service.ts` | Session memoSnapshot 异步写入队列消费服务 |
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
| `modules/prompt-registry/agent-prompt-catalog.ts` | Agent Prompt 清单（symbol/slug/scene/role/defaultContent）与默认模板构造 |
| `modules/agents/agent-executor-runtime.service.ts` | Agent 执行链公共模板（start/complete/fail/release） |
| `modules/agents/agent-opencode-policy.service.ts` | OpenCode 执行门禁与预算审批策略 |
| `modules/agents/agent-before-step-optimization.hook.ts` | step 进入前语义优化 Hook（LLM 判断） |
| `modules/agents/agent-after-step-evaluation.hook.ts` | step 完成后语义评估 Hook（LLM 评审） |
| `modules/agents/agent-executor-step-hooks.types.ts` | step Hook 协议类型定义 |
| `modules/agents/agent-orchestration-intent.service.ts` | 历史项：会议编排意图识别与强制工具调用映射（文件已于 2026-03-19 删除） |
| `modules/agents/agent-mcp-profile.service.ts` | MCP profile 读写、映射与权限集下沉服务 |
| `modules/agents/executor-engines/agent-executor-engine.interface.ts` | Agent Executor Engine 协议定义 |
| `modules/agents/executor-engines/agent-executor-engine.types.ts` | Engine 执行上下文与路由类型定义 |
| `modules/agents/executor-engines/agent-executor-engine.router.ts` | 按 mode/channel 路由执行引擎 |
| `modules/agents/executor-engines/native-agent-executor.engine.ts` | native + detailed 执行引擎 |
| `modules/agents/executor-engines/native-streaming-agent-executor.engine.ts` | native + streaming 执行引擎 |
| `modules/agents/executor-engines/opencode-agent-executor.engine.ts` | opencode + detailed 执行引擎 |
| `modules/agents/executor-engines/opencode-streaming-agent-executor.engine.ts` | opencode + streaming 执行引擎 |
| `modules/agent-tasks/agent-task.controller.ts` | Agent Task 异步任务 API（create/get/cancel/SSE） |
| `modules/agent-tasks/agent-task.service.ts` | Agent Task 状态管理、幂等、事件续传与权限校验 |
| `modules/agent-tasks/agent-task.worker.ts` | 异步 Worker 消费队列并驱动 runtime + OpenCode 执行 |
| `modules/agent-tasks/runtime-sse-stream.service.ts` | SSE 实时流 + 心跳 + Redis 订阅桥接 |
| `modules/agent-tasks/opencode-serve-router.service.ts` | Multi-Serve 路由与会话粘性所需 serve 选择能力 |
| `schemas/agent-task.schema.ts` | Agent Task 状态持久化模型（queued/running/succeeded/failed/cancelled） |
| `backend/apps/gateway/src/gateway-proxy.service.ts` | Runtime 控制类路径网关侧审计日志 |
| `backend/src/modules/agent-action-logs/agent-action-log.controller.ts` | Runtime hook 内部写入入口与查询接口 |
| `backend/src/modules/agents-client/agent-client.service.ts` | legacy 后端对 Agents Runtime/Task/Session/Memo 的统一客户端封装（已合并 models/tools client 能力） |
| `backend/src/modules/inner-message/inner-message-agent-runtime-bridge.service.ts` | inner-message 到 Agent Runtime 的统一桥接执行 |
| `frontend/src/pages/AgentDetail.tsx` | Agent Session 抽屉消息轨迹展示（正文折叠、parts 展开、手动刷新） |

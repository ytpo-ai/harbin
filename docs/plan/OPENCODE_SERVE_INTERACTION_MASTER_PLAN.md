# OpenCode Serve 交互能力主计划

## 需求理解

- 目标是在现有平台中，让 Agent 可以像人类开发者一样直接与某个 `opencode serve` 交互，完成研发任务。
- Agent 需要具备 3 类核心能力：
  - 执行能力：发起任务、接收中间输出、持续推进任务。
  - 状态感知：实时知道 OpenCode 在做什么、当前阶段、是否阻塞。
  - 授权闭环：遇到高风险动作能发起授权请求，拿到批准后继续执行。
- 规划需优先复用现有能力，避免重复造轮子（Runtime 事件、Outbox、Run Control、Gateway 签名上下文、WS 推送）。

## 范围与边界

### In Scope（本期范围）

1. 新增 OpenCode 适配层（Adapter），支持与指定 `opencode serve` 会话化交互。
2. 将 OpenCode 执行过程映射为 Runtime 标准事件并写入现有可观测链路。
3. 增加授权请求/审批/结果回写闭环（含审计）。
4. 提供前端实时状态视图与审批操作入口。
5. 提供断线恢复、死信重投、事件回放等运维保障。

### Out of Scope（本期不做）

1. 不改造为分布式 Run 锁（继续沿用当前进程内 single-flight）。
2. 不引入独立前端工程（遵守“前端保留在主应用”约束）。
3. 不覆盖所有外部编程代理，仅先支持 OpenCode Serve。

## 现状对齐（基于已有文档能力）

- Runtime 事件契约与生命周期已可用：`run.*`、`llm.delta`、`tool.*`、`permission.*`。
- Runtime 可靠投递链路已可用：`agent_events_outbox` + flush + dead-letter + requeue + replay。
- Gateway 已具备签名上下文透传：`x-user-context` + `x-user-signature`。
- WS 服务已支持订阅模式，可承载前端实时状态推送。
- 编排侧（Orchestration）与执行侧（Agents Runtime）已解耦，便于插入 OpenCode 执行通道。

## 总体方案

### 一、架构分层

1. `OpenCodeAdapter`（新增）
   - 负责连接目标 `opencode serve`，管理会话、命令请求、流式事件、断线重连。
2. `OpenCodeExecutionService`（新增）
   - 将业务任务转换为 OpenCode 请求，驱动执行节奏。
   - 将 OpenCode 输出标准化后写入 Runtime（run/message/part/event）。
3. `OpenCodePermissionBridge`（新增）
   - 处理 OpenCode 提示的授权动作，发起审批并等待回执。
4. `Runtime + WS + Frontend`（复用并增强）
   - Runtime 提供统一状态源；WS 推送；前端展示和审批操作。

### 二、关键流程

1. Agent 发起任务 -> Runtime `run.started`。
2. OpenCode Adapter 建立会话并发送任务上下文。
3. OpenCode 流式返回阶段信息/日志/工具动作 -> 统一映射到 Runtime 事件。
4. 若出现需要授权的动作 -> 触发 `permission.asked`，进入 `waiting_approval`。
5. 人类审批通过/拒绝 -> 写入 `permission.replied/permission.denied`。
6. 批准后恢复执行，拒绝则中止并记录失败原因。
7. 任务完成 -> `run.completed`；异常 -> `run.failed`。

### 三、数据分层策略（已定方向）

为支持后续“研发成本、效率、惊喜度评估”，采用 **Agents 运行事实层 + Engineering Intelligence 分析层** 的双层架构。

1. Agents 模块（运行事实层，OLTP）仅保存最小运行必需数据：
   - run/session 状态与控制字段（`status/phase/progress/blockingReason`）
   - 授权链路审计必需字段（`permission.*` 事件）
   - OpenCode 外部关联键（`opencodeSessionId/opencodeTaskId`）
2. Engineering Intelligence 模块（分析层，OLAP/分析明细）保存研发分析数据：
   - step 时间线、工具调用明细、token 与模型消耗、错误与重试、授权耗时
   - 任务结果质量信号（测试/构建/人工接管等）
   - 成本、效率、惊喜度指标计算结果与可追溯明细
3. 同步策略采用“最小运行态 + 异步归档同步”：
   - 执行中：Agents 继续维持 Runtime 事件与可观测性
   - 完成后：触发 EI 汇总同步任务（成功/失败/取消均同步）
   - 补偿：通过 outbox/replay/requeue 做失败重试与补齐

### 三.1 明细同步决策（已确认）

- 决策：EI 同步采用 **A 方案（事件明细）**，不采用“仅汇总快照 + 可选明细”作为主模式。
- 执行要求：
  1. run 终态后默认同步全量事件明细（脱敏后）到 EI。
  2. EI 基于明细计算成本/效率/惊喜度，支持后续重算与口径演进。
  3. Agents 侧继续仅保存运行必需最小事实，不承载分析口径逻辑。

### 四、模块职责边界（定稿原则）

1. `apps/agents` 负责：执行控制、授权门禁、运行可观测、恢复治理。
2. `apps/engineering-intelligence` 负责：研发过程数据沉淀、成本效率评估、报表与分析查询。
3. 禁止将分析口径逻辑散落在 agents；分析指标统一在 EI 计算。
4. 前端入口保持主应用 `frontend/`，通过页面路由访问 EI 能力。

### 六、多环境协同策略（Local + ECDS）

为解决“本地开发环境 + ECDS 开发环境”数据隔离问题，采用 **中心控制面 + 边缘执行面**：

1. 中心控制面（建议部署在 ECDS）
   - 统一管理：需求、计划、任务、审批、配额、分析结果。
   - 作为跨环境唯一事实源（System of Record）。
2. 边缘执行面（Local/ECDS 节点）
   - 各环境独立执行 OpenCode 任务与本地临时缓存。
   - 不直连/不写入中心核心表。
3. 同步汇聚层（Ingest API）
   - 边缘节点按统一事件契约批量上报（A 方案事件明细）。
   - 中心侧做幂等去重、顺序校验、脱敏校验、审计落库。
4. 统一标识
   - 所有 run/event 增加 `envId`（如 `local`/`ecds`）与 `nodeId`。
   - 统一幂等键：`runId + eventId`；顺序键：`runId + sequence`。

### 七、数据库连接策略（定稿）

1. 不采用“所有环境直连同一套数据库”的默认方案。
2. 禁止边缘节点直接写中心分析核心集合（仅通过 Ingest API）。
3. 若极端场景需要同库，仅允许使用隔离命名空间与最小权限账号，不作为主路径。

### 五、角色与预算控制（本方案约束）

1. 允许使用 OpenCode 的角色：
   - `devops-engineer`（运维工程师）
   - `fullstack-engineer`（全栈工程师）
   - `technical-architect`（技术专家）
2. 系统按 **`agent + 周期` 配额控制**预算与限额。
3. 配额超限后不直接拒绝，进入审批流（`permission.asked`），审批通过可继续执行。
4. 执行前模型绑定匹配检测采用可配置开关：
   - 通过 `OPENCODE_MODEL_BINDING_CHECK_ENABLED` 控制是否严格校验 Agent 绑定模型与本次 OpenCode 执行模型一致（默认 `false`）。
   - 开关关闭时不因 mismatch 阻断；开关开启后恢复严格校验与可读错误。

## 详细执行计划（分阶段）

### 阶段 1：协议与状态模型落地

1. 定义 OpenCode 标准事件协议（内部 contract）：
   - `session.opened`
   - `step.started`
   - `step.progress`
   - `step.completed`
   - `approval.required`
   - `task.completed`
   - `task.failed`
2. 设计 OpenCode -> Runtime 事件映射表。
3. 设计任务状态机：
   - `idle -> planning -> executing -> waiting_approval -> blocked -> completed|failed|cancelled`
4. 定义阻塞原因标准字段：
   - `blockingReason.code`（network_timeout/approval_pending/tool_error/context_error）
   - `blockingReason.detail`
   - `nextAction`

交付物：

- 技术设计文档（事件映射 + 状态机 + 字段契约）
- DTO/Schema 草案

### 阶段 2：后端执行适配层

1. 新建 `OpenCodeAdapter`：
   - 支持指定 `serveEndpoint`、`sessionId`、`taskId`。
   - 支持流式接收与 reconnect。
2. 新建 `OpenCodeExecutionService`：
   - 封装任务提交、取消、超时、重试策略。
3. 与 RuntimeOrchestrator 对接：
   - 开始/步骤/完成/失败统一落库与事件外发。
4. 为每次交互写入 trace 信息：
   - `opencodeSessionId`
   - `opencodeTaskId`
    - `runtimeRunId`
    - `traceId`
5. 补充 EI 同步触发上下文：
   - `syncState`（pending/synced/failed）
   - `lastSyncAt`
   - `syncRetryCount`
6. 增加执行前校验：
   - 角色准入校验（仅 `devops-engineer` / `fullstack-engineer` / `technical-architect`）。
   - Agent 绑定模型匹配检测（provider/model/apiKeyRef，受 `OPENCODE_MODEL_BINDING_CHECK_ENABLED` 控制，默认关闭）。
   - `agent + 周期` 配额检测，超限转审批。
7. 增加 OpenCode Endpoint 与认证策略：
   - 执行地址优先读取 `agent.config.execution.endpoint`，其次读取 `agent.config.execution.endpointRef`，最后回退 `OPENCODE_SERVER_URL`。
   - 新增 `agent.config.execution.auth_enable`（boolean，默认 `false`）。
   - 仅当 `auth_enable=true` 时读取 `OPENCODE_SERVER_PASSWORD` 并携带 Basic Auth（username=`opencode`）；否则不带用户名/密码。

交付物：

- 后端适配层服务代码
- 与 Runtime 集成测试（最小链路）

### 阶段 3：授权系统闭环

1. 新增授权请求模型（建议新集合 `agent_permission_requests`）：
   - `id/runId/agentId/requestType/resource/action/riskLevel/status/requestedBy/approvedBy/expiresAt`
2. 增加审批 API：
   - `POST /agents/runtime/permissions/:id/approve`
   - `POST /agents/runtime/permissions/:id/reject`
   - `GET /agents/runtime/permissions?status=&runId=`
3. 风险分级策略：
   - low：自动批准（记录审计）
   - medium：策略可配（默认人工）
   - high：强制人工
4. 审批结果回桥接到 OpenCode 会话，驱动继续/终止。

交付物：

- 授权策略与审批 API
- 授权审计链路（审批前后事件）

### 阶段 4：实时状态与前端交互

1. 定义运行状态聚合查询接口：
   - `GET /agents/runtime/runs/:runId/opencode-status`
   - 返回：`phase/progress/currentStep/blockingReason/approvalState/lastEventAt`
2. 增加 WS 推送 channel 约定：
   - `agent-runtime:{agentId}`（已存在，复用）
   - `opencode-run:{runId}`（可选，便于前端精确订阅）
3. 前端页面改造：
   - 运行状态卡片（阶段 + 进度 + 当前动作）
   - 阻塞提示（等待授权/执行失败/网络异常）
   - 审批弹层（批准/拒绝 + 理由）

交付物：

- 前端状态面板与审批 UI
- WS 到 UI 的端到端联调

### 阶段 5：可恢复性与运维治理

1. 接入 outbox 指标与告警建议（复用 runtime metrics）。
2. 失败恢复流程：
   - 会话断连自动重试
   - 事件失败走 dead-letter/requeue
   - 必要时 run 级 replay 补齐外部状态
3. 增加运维排障手册：
    - “状态不一致”排查路径
    - “授权卡死”排查路径
    - “事件积压”排查路径
4. 增加 EI 同步补偿手册：
   - “完成事件已写入但 EI 未落库”补偿路径
   - “EI 指标口径重算”回放路径
5. 增加多环境数据一致性手册：
   - “local 与 ecds 同 run 冲突”处置流程
   - “边缘离线积压事件”回放流程

交付物：

- 运维文档
- 故障演练记录

## API 与契约草案（v1）

### 后端 API 草案

1. `POST /agents/:id/execute-with-opencode`
   - 入参：`task`, `serveEndpoint`, `mode`, `context`, `approvalPolicy`
   - 出参：`runId`, `sessionId`, `opencodeSessionId`
2. `GET /agents/runtime/runs/:runId/opencode-status`
3. `GET /agents/runtime/permissions`
4. `POST /agents/runtime/permissions/:id/approve`
5. `POST /agents/runtime/permissions/:id/reject`

### Engineering Intelligence API 草案

1. `POST /engineering-intelligence/opencode/runs/sync`
   - 作用：接收 Agents 归档同步请求（可批量）
   - 契约要点：`runId + syncBatchId` 幂等；事件按 `sequence` 连续升序；超限拆批（单批 <= 1000 事件、<= 2MB）
2. `POST /engineering-intelligence/opencode/runs/:runId/recompute-metrics`
   - 作用：按 run 重算成本/效率/惊喜度
3. `GET /engineering-intelligence/opencode/runs/:runId/analysis`
   - 作用：查询单 run 研发分析视图
4. `GET /engineering-intelligence/opencode/metrics/overview`
   - 作用：查询聚合指标看板
5. `POST /engineering-intelligence/opencode/ingest/events`
   - 作用：边缘节点（local/ecds）批量上报事件明细到中心
6. `GET /engineering-intelligence/opencode/ingest/nodes`
   - 作用：查询节点注册与健康状态

### 同步契约定稿项（当前）

1. 同步主键：`runId`，批次幂等键：`syncBatchId`。
2. 事件主键：`eventId`（run 内唯一），顺序键：`sequence`（连续升序）。
3. 同步对象：全量事件明细 + run 基础信息 + costRaw + stats。
4. 失败处理：EI 返回 `retryable` 标记；Agents 按标记执行重试或人工介入。
5. 多环境字段：`envId` 与 `nodeId` 为同步请求必填字段。
6. 写入策略：边缘仅上报，不直接写中心核心库。

### 配额与审批策略定稿项（当前）

1. 配额维度：`agentId + period`（如 day/week/month），不依赖 organization 维度。
2. 配额指标：可按 `estimatedTotalCost`、`tokenIn+tokenOut`、`runCount` 任一或组合配置。
3. 配额超限动作：触发审批请求，审批通过后写入本周期“超额批准”审计。

### 事件映射草案

- OpenCode `step.started` -> Runtime `run.step.started`
- OpenCode `step.progress` -> Runtime `llm.delta`（或 `run.step.progress` 扩展事件）
- OpenCode `approval.required` -> Runtime `permission.asked`
- 审批通过 -> Runtime `permission.replied`
- 审批拒绝 -> Runtime `permission.denied`
- OpenCode `task.completed` -> Runtime `run.completed`
- OpenCode `task.failed` -> Runtime `run.failed`

## 数据模型草案

### 新增集合（建议）

`agent_permission_requests`

- `runId`
- `agentId`
- `sessionId`
- `requestType`（command/resource/credential）
- `action`
- `resource`
- `riskLevel`（low/medium/high）
- `status`（pending/approved/rejected/expired/cancelled）
- `reason`
- `approvedBy`
- `approvedAt`
- `expiresAt`
- `audit`（requestPayload, decisionPayload）

### 扩展字段（建议）

`agent_runs` 扩展：

- `executionChannel`（native|opencode）
- `roleCode`（agent 当前角色代码，如 devops-engineer/fullstack-engineer/technical-architect）
- `externalSessionId`（opencode session）
- `currentPhase`
- `progress`
- `blockingReason`
- `executionData`（执行详情对象，见技术设计文档）

### Engineering Intelligence 分析模型（建议）

`ei_opencode_run_analytics`（run 级分析主表）

- `agentId/runId/sessionId`
- `opencodeSessionId/opencodeTaskId`
- `startedAt/completedAt/durationMs`
- `cost`（tokenIn/tokenOut/model/toolCost/estimatedTotalCost）
- `efficiency`（leadTime/cycleTime/waitMs/reworkCount/retryCount/firstPassSuccess）
- `qualitySignals`（testPass/buildPass/lintPass/humanTakeover）
- `surpriseScore`（及计算快照）
- `syncMeta`（sourceVersion/syncedAt/syncBatchId）

`ei_opencode_event_facts`（事件明细表）

- `runId/eventId/sequence/eventType/timestamp`
- `stepId/toolCallId/approvalId`
- `payloadDigest`（脱敏摘要）
- `ingestedAt`

## 验收标准（MVP）

1. Agent 可成功发起 OpenCode 任务并持续接收中间状态。
2. 任务状态在 Runtime 与前端 UI 一致（误差不超过 3 秒）。
3. 高风险动作能触发人工审批，审批后任务可继续或终止。
4. OpenCode 服务短暂中断后，任务状态可恢复且审计链完整。
5. 出现事件投递失败时，可通过 dead-letter/requeue 恢复。
6. run 完成后可在 EI 查询到对应分析结果，且支持重算。

## 风险与缓解

1. OpenCode 协议变更风险
   - 缓解：Adapter 层做版本化与能力协商。
2. 双状态源不一致风险（OpenCode vs Runtime）
   - 缓解：以 Runtime 为系统事实源，定期 reconcile。
3. 授权绕过风险
   - 缓解：执行器层强制二次鉴权，不依赖前端判断。
4. 事件积压风险
   - 缓解：outbox 指标告警 + requeue 批处理节流。
5. “仅完成后同步”导致数据丢失风险
   - 缓解：保留 Agents 最小运行事实 + EI 异步补偿同步 + 失败重放。

## 里程碑建议

- M1（第 1 周）：契约与状态机定稿 + Adapter skeleton。
- M2（第 2 周）：端到端执行链路跑通（无审批）。
- M3（第 3 周）：授权闭环上线（审批 API + UI）。
- M4（第 4 周）：稳定性演练与运维文档完成。

## 关键影响点

- 后端/API：`apps/agents` runtime、controller、schema、tools。
- 后端/API：`apps/engineering-intelligence` 新增同步/分析接口与分析模型。
- 网关：身份上下文透传复用（必要时补充路由审计字段）。
- 前端：运行状态展示、审批交互、错误引导。
- 数据库：审批请求集合与 run 扩展字段。
- 数据库：EI 分析主表与事件明细表。
- 测试：集成链路、授权分支、恢复链路、回放/重投。
- 文档：feature/technical/api/development/dailylog 需同步更新。

## 设计文档落盘

- 技术设计文档：`docs/technical/OPENCODE_EI_DATA_LAYER_TECHNICAL_DESIGN.md`
- 技术设计文档：`docs/technical/OPENCODE_MULTI_ENV_COLLAB_TECHNICAL_DESIGN.md`

## 讨论清单（下一轮细化）

1. OpenCode 事件协议是否直接对齐 Runtime 事件名，还是保留中间转换层。
2. `step.progress` 是否新增 Runtime 事件类型，还是复用 `llm.delta`。
3. 授权策略默认值（medium 自动/人工）与系统级可配置方案。
4. 审批入口放在 Agent 详情页、任务详情页还是全局待办中心。
5. 多个 OpenCode serve 节点的路由选择策略（固定、权重、健康检查）。

## TODO（暂缓项）

- [ ] 增加 `mapOpenCodeEventToRuntimeEvent` 映射函数设计与代码草案（含字段映射、异常兜底、版本兼容）。
- [ ] 增加映射函数单测用例清单（正常流、乱序、重复事件、终态保护）。

# Agent Runtime Overhaul 开发沉淀

## 1. 背景与目标

本次开发围绕 `docs/plan/AGENT_RUNTIME_OVERHAUL_PLAN.md` 执行，核心目标是将 Agent 运行时从“请求-响应型执行”升级为“状态机 + 持久化 + 可恢复 + 可观测 + 可控”的运行平台，并支持向模块外实时发布 Agent 生命周期状态。

关键诉求包括：

- 运行过程结构化持久化（run/message/part/event outbox）
- 外部可订阅的生命周期 Hook
- 工具调用闭环状态机
- run 控制面（pause/resume/cancel/replay）
- 死信恢复能力（查看、重投、dry-run）
- 运行维护操作审计（batchId、操作者、作用域、结果）

---

## 2. 架构落地总览

### 2.1 新增 Runtime 模块

路径：`backend/apps/agents/src/modules/runtime/`

- `runtime.module.ts`
- `runtime-orchestrator.service.ts`
- `runtime-persistence.service.ts`
- `hook-dispatcher.service.ts`
- `runtime.controller.ts`
- `contracts/runtime-event.contract.ts`
- `contracts/runtime-run.contract.ts`
- `contracts/runtime-control.contract.ts`

### 2.2 新增持久化模型

路径：`backend/apps/agents/src/schemas/`

- `agent-run.schema.ts`：运行实例（run）
- `agent-message.schema.ts`：消息层
- `agent-part.schema.ts`：消息分片/步骤层
- `agent-event-outbox.schema.ts`：事件外发 outbox
- `agent-runtime-maintenance-audit.schema.ts`：维护操作审计

### 2.3 现有 Agent 执行链路接入

主要修改：`backend/apps/agents/src/modules/agents/agent.service.ts`

- 普通执行 `executeTask` 接入 run 生命周期
- 流式执行 `executeTaskWithStreaming` 接入 `llm.delta` 事件
- 工具轮次接入 `tool.pending/running/completed/failed`
- 执行过程中加入 `assertRunnable`（支持外部控制打断）

---

## 3. 生命周期与状态模型

### 3.1 Runtime 事件契约（zod）

事件类型覆盖：

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

统一字段：`eventId/eventType/organizationId/agentId/sessionId/runId/taskId/messageId/partId/toolCallId/sequence/timestamp/traceId/payload`

### 3.2 工具调用状态机

实现为同一 `partId` 的状态迁移，不再通过多条 part 拼接状态：

- `pending -> running`
- `running -> completed`
- `running|pending -> error`

并对非法迁移抛错，避免状态污染。

---

## 4. Hook 外发与恢复

### 4.1 Outbox 机制

- 事件先入 `agent_events_outbox`
- Dispatcher 发布成功后标记 `dispatched`
- 发布失败标记 `failed` 并指数退避重试
- 后台定时 flush 重试队列

### 4.2 Replay 能力

支持按条件重放 run 事件：

- `eventTypes`
- `fromSequence`
- `toSequence`
- `channel`
- `limit`

并增加序列范围校验：`fromSequence <= toSequence`。

---

## 5. Run 控制面（Control Plane）

新增内部接口（`/agents/runtime/...`）：

- `GET runs/:runId`
- `POST runs/:runId/pause`
- `POST runs/:runId/resume`
- `POST runs/:runId/cancel`
- `POST runs/:runId/replay`

权限策略：

- 角色要求：`system/admin/owner`
- 组织隔离：非 `system` 只能操作同 organization 的 run

---

## 6. 死信治理与维护能力

### 6.1 死信查看

- `GET outbox/dead-letter`
- 支持筛选：`organizationId/runId/eventType/limit`
- 返回：`total/returned/hasMore/events`

### 6.2 死信重投

- `POST outbox/dead-letter/requeue`
- 支持两种方式：
  - 指定 `eventIds`
  - 按筛选条件批量
- 支持 `dryRun`
- 返回 `batchId`，用于后续审计检索

### 6.3 维护审计

- 新增审计集合：`agent_runtime_maintenance_audits`
- 记录字段：`action/batchId/actorId/actorRole/organizationId/dryRun/matched/affected/summary/scope/result`
- 查询接口：`GET maintenance/audits?limit=&action=&organizationId=&batchId=`

### 6.4 旧数据清理（不迁移策略）

- 策略变更：旧数据不迁移，切流后清理
- 接口：`POST maintenance/purge-legacy`
- 要求：
  - `system` 角色
  - `confirm = DELETE_LEGACY_RUNTIME_DATA`
  - 支持 `dryRun`

---

## 7. Gateway 协同改造

路径：`backend/apps/gateway/src/gateway-proxy.service.ts`

- 对 runtime 控制类路径增加审计日志
- 覆盖动作：`pause/resume/cancel/replay/dead_letter_requeue/purge_legacy`
- 审计字段包含：`requestId/action/runId/actorId/actorRole/organizationId/status`

---

## 8. 文档更新清单

- 计划文档：`docs/plan/AGENT_RUNTIME_OVERHAUL_PLAN.md`
- API 文档：`docs/api/agents-api.md`
- 架构指南：`docs/architecture/AGENT_RUNTIME_HOOKS_GUIDE.md`
- 开发沉淀：`docs/development/AGENT_RUNTIME_OVERHAUL_PLAN.md`（本文）

---

## 9. 验证与结果

本轮开发过程中已多次执行并通过：

- `npm run build:agents`
- `npm run build:gateway`

说明：当前仓库 Jest/TS 装饰器测试链路存在配置问题，未将 runtime 自动化测试纳入本轮提交，后续可单独补齐测试基础设施后补测。

---

## 10. 当前边界与后续建议

已按用户要求将以下项标记为“建议优化项，暂不执行”：

- 分布式运行锁（Redis）
- Outbox 投递幂等增强（delivery/attempt 元数据）
- run 级状态机守卫进一步强化
- replay/requeue/purge 接口限流防抖

这些建议已落在计划文档建议章节，作为后续迭代输入。

---

## 11. Commit 映射索引

- `437d030`：Runtime 重构底座（run/message/part/outbox + zod 事件契约）
  - `backend/apps/agents/src/modules/runtime/runtime.module.ts`
  - `backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts`
  - `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`
  - `backend/apps/agents/src/modules/runtime/hook-dispatcher.service.ts`
  - `backend/apps/agents/src/schemas/agent-run.schema.ts`
  - `backend/apps/agents/src/schemas/agent-message.schema.ts`
  - `backend/apps/agents/src/schemas/agent-part.schema.ts`
  - `backend/apps/agents/src/schemas/agent-event-outbox.schema.ts`

- `1c7477a`：Run 控制 API 初版与 replay 过滤、tool part 状态迁移
  - `backend/apps/agents/src/modules/runtime/runtime.controller.ts`
  - `backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts`
  - `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`

- `c827996`：Run 控制权限收敛（role + context）与 Hook 指标
  - `backend/apps/agents/src/modules/runtime/runtime.controller.ts`
  - `backend/apps/agents/src/modules/runtime/hook-dispatcher.service.ts`
  - `backend/apps/agents/src/modules/runtime/contracts/runtime-control.contract.ts`
  - `docs/architecture/AGENT_RUNTIME_HOOKS_GUIDE.md`

- `bc2856a`：组织隔离 + dead-letter 导出 + gateway 运行控制审计
  - `backend/apps/agents/src/modules/runtime/runtime.controller.ts`
  - `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`
  - `backend/apps/gateway/src/gateway-proxy.service.ts`

- `7334281`：dead-letter 重投闭环（requeue）
  - `backend/apps/agents/src/modules/runtime/runtime.controller.ts`
  - `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`
  - `backend/apps/gateway/src/gateway-proxy.service.ts`

- `92c6a45`：dead-letter dry-run 与指标补全
  - `backend/apps/agents/src/modules/runtime/runtime.controller.ts`
  - `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`
  - `backend/apps/agents/src/modules/runtime/contracts/runtime-control.contract.ts`

- `555bd1e`：dead-letter 可见性增强（total/hasMore）与安全性改进
  - `backend/apps/agents/src/modules/runtime/runtime.controller.ts`
  - `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`
  - `backend/apps/agents/src/modules/runtime/contracts/runtime-control.contract.ts`

- `df908b1`：legacy purge 接口与工具状态机严格迁移守卫
  - `backend/apps/agents/src/modules/runtime/runtime.controller.ts`
  - `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`
  - `backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts`
  - `backend/apps/agents/src/modules/runtime/contracts/runtime-control.contract.ts`

- `ff066c7`：维护审计落库（batch/dry-run/作用域/结果）与审计查询
  - `backend/apps/agents/src/schemas/agent-runtime-maintenance-audit.schema.ts`
  - `backend/apps/agents/src/modules/runtime/runtime.module.ts`
  - `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`
  - `backend/apps/agents/src/modules/runtime/runtime.controller.ts`

---

## 计划原文（合并归档：AGENT_RUNTIME_OVERHAUL_PLAN.md）

# Agent Runtime Overhaul Plan（含外部状态钩子）

## 1. 目标与范围

### 1.1 目标

- 将当前 Agent 执行链路升级为：流式循环 + 工具状态机 + 状态持久化 + 可恢复执行。
- 建立标准化生命周期钩子（Hooks），向 Agent 模块外部实时通知执行状态。
- 形成可观测、可审计、可灰度切换的运行时架构，支撑后续复杂编排与多 Agent 场景。

### 1.2 范围

- **包含**：Agents 服务运行时重构、消息存储模型重构、工具执行闭环、流式协议升级、外部钩子系统、迁移与灰度发布。
- **不包含**：无关业务功能开发（如新增业务 Agent 类型、业务页面大改版）。

---

## 2. 现状问题（重构动因）

- 当前执行主链路偏“请求-响应式”，中间状态缺少统一持久化，不利于恢复与审计。
- 工具调用虽有执行记录，但与会话步骤关联度不足，无法稳定还原“当时发生了什么”。
- 流式能力偏 token 级输出，缺少结构化事件，外部系统难以订阅“执行状态变化”。
- 会话历史主要以内嵌消息保存，长会话下增量更新、重放、压缩策略不够精细。

---

## 3. 执行步骤（按顺序）

### 步骤 1：重建 Runtime 分层与模块边界

- 新建七层结构：
  - orchestrator
  - processor
  - llm-adapter
  - tool-runtime
  - permission
  - persistence
  - hook-dispatcher
- `AgentService` 退化为 facade，负责组装入口，不承载复杂状态机。
- 明确每层 I/O 协议与错误边界，避免跨层耦合。

**关键影响点**：后端架构、服务模块依赖、日志链路。

### 步骤 2：定义统一生命周期事件模型（Hook Contract）

- 统一事件类型：
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
- 统一事件字段：`eventId`、`eventType`、`organizationId`、`agentId`、`sessionId`、`runId`、`taskId`、`messageId`、`partId`、`toolCallId`、`sequence`、`timestamp`、`traceId`、`payload`。
- 语义定义：至少一次投递；消费者幂等去重（`eventId` + `sequence`）。

**关键影响点**：后端协议、外部集成、可观测性。

### 步骤 3：重做数据模型（Run + Message + Part + Outbox）

- 新增集合：
  - `agent_runs`
  - `agent_messages`
  - `agent_parts`
  - `agent_events_outbox`
- `agent_parts` 采用显式状态机：`pending/running/completed/error/cancelled`。
- 工具与消息强关联：`toolCallId`、`runId`、`partId`、`taskId`。
- 对关键查询建立索引（按 `sessionId/runId/status/createdAt`）。

**关键影响点**：数据库模型、索引策略、读写 DAO。

### 步骤 4：重写执行主循环（Single-flight + Resume）

- 同一 `sessionId` 单执行器锁（Single-flight），支持 `start/resume/cancel/replay`。
- 每一步只返回有限状态：`continue/stop/compact/error`。
- 状态迁移先落库，再触发 hook；中断恢复从持久化 part 回放。
- 增加未终态扫尾（悬挂工具统一标记 error/cancelled）。

**关键影响点**：并发控制、容错、恢复能力。

### 步骤 5：工具执行升级为闭环状态机

- 工具执行流程：`tool.pending -> tool.running -> tool.completed/tool.failed`。
- `ToolExecution` 作为审计镜像，主事实源迁移到 `agent_parts`。
- 限制单步并发工具数，避免事件堆积与响应抖动。
- 保证工具失败可恢复、可追踪、可告警。

**关键影响点**：工具模块、执行历史、可靠性。

### 步骤 6：构建外部状态钩子系统（核心新增）

- 提供三类对外通道：
  - Webhook（外部系统回调）
  - Event Bus（Redis/Kafka）
  - SSE/WS（前端实时订阅）
- `hook-dispatcher` 仅消费 `agent_events_outbox`，统一重试、签名、限流、死信。
- 支持订阅过滤：`organizationId/agentId/sessionId/runId/eventType`。
- 安全要求：签名校验、重放保护、回调超时、失败退避重投。

**关键影响点**：外部集成能力、安全、运维。

### 步骤 7：上下文治理（Compaction + Structured Output + Permission）

- 引入 token 驱动 compaction，保留关键行动上下文与未完成任务。
- Structured Output 走强约束通道，避免静默非结构化输出。
- 高风险工具统一走 `allow/ask/deny` 异步审批，并事件化。

**关键影响点**：模型治理、安全策略、输出稳定性。

### 步骤 8：迁移、灰度与切流

- 本次策略调整为**不做旧数据迁移**，切流后直接清理旧会话数据（legacy collections）。
- 灰度期双写（新模型主写，旧模型兜底读），逐步切换读取路径。
- 外部 hooks 先 shadow 模式，再正式接入关键流程。
- 配置回滚开关，确保异常时可快速退回旧链路。

**关键影响点**：发布风险、兼容性、回滚策略。

### 步骤 9：验证与验收

- 测试矩阵：并发冲突、工具超时、回调失败、重复投递、断点恢复、权限审批闭环。
- 压测指标：事件延迟、吞吐、投递成功率、恢复成功率、长会话稳定性。
- 上线门禁：无长时间 pending/running、无 outbox 堆积、无状态丢失。

**关键影响点**：测试体系、质量门禁、运维稳定性。

---

## 4. 里程碑建议（3 个 Sprint）

- **Sprint 1**：步骤 1-4（引擎骨架 + 可恢复执行）
- **Sprint 2**：步骤 5-6（工具闭环 + 外部状态钩子）
- **Sprint 3**：步骤 7-9（治理、迁移、压测、切流）

---

## 5. 风险与依赖

### 5.1 主要风险

- 迁移期数据一致性与双写复杂度上升。
- Hook 外发失败导致外部感知滞后。
- 工具并发下事件顺序与幂等处理复杂。

### 5.2 依赖条件

- 稳定的消息基础设施（Redis/Kafka 至少其一）。
- Mongo 索引资源与容量评估。
- 前端/调用方同步升级事件消费协议。

### 5.3 风险控制

- Outbox + 幂等键 + 死信队列。
- 关键链路全量 traceId 打通。
- 灰度开关与回滚预案演练。

---

## 6. 交付物清单

- 新 runtime 模块与状态机实现。
- 新集合 schema、索引、迁移脚本。
- Hook Contract 文档与外部订阅接入文档。
- 流式事件接口（SSE/WS/Webhook/Event Bus）实现。
- 测试报告（功能、恢复、压测、故障注入）。
- 更新文档：`README.md`、`docs/api/*`、`docs/architecture/*`。

---

## 7. 完成判定（Definition of Done）

- 任一 run 可完整重放执行过程（含工具中间态）。
- 外部系统可实时订阅并稳定接收 Agent 状态事件。
- 故障场景下可恢复且不出现长期悬挂状态。
- 新旧链路完成切换并通过回归与压测门禁。

---

## 8. 建议优化项（待后续执行）

- **分布式运行锁**：将当前进程内 single-flight 升级为 Redis 分布式锁（含续约与 owner token），保障多实例部署下同一会话不会并发执行。
- **Outbox 投递幂等增强**：补充 `deliveryId/attemptId` 等投递元数据，并记录每次投递结果，提升重复投递与失败排查能力。
- **Run 状态机守卫强化**：补全 run 级合法迁移矩阵，禁止非法状态回跳（如 `completed -> running`）。
- **控制接口限流防抖**：为 `replay/requeue/purge` 增加按 actor + organization 的限速策略，避免误触发事件风暴。

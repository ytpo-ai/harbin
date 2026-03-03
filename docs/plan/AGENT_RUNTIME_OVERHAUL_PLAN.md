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

- 提供迁移脚本：旧会话消息映射到 `agent_messages/agent_parts`。
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

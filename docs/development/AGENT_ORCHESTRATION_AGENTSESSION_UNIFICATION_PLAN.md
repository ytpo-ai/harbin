# Agent Orchestration AgentSession Unification 开发沉淀

## 1. 背景与目标

本次开发基于 `docs/plan/AGENT_ORCHESTRATION_AGENTSESSION_UNIFICATION_PLAN.md` 执行，目标是将编排与执行分层：

- `orchestration` 负责计划拆解、任务依赖调度、任务状态管理。
- `apps/agents` 负责 task 级执行会话（AgentSession）与 run 生命周期。
- `orchestration` 新增 `PlanSession`，仅记录任务输入/输出与状态，不记录工具调用细节。

核心设计决策：

1. **每个 Task 对应一个 AgentSession**（不再 plan+agent 复用会话）。
2. **AgentSession 由 apps/agents 统一管理**。
3. **PlanSession 作为编排视图层**，用于跨任务查询执行结果。

---

## 2. 架构改造总览

### 2.1 新增 `apps/agents` 侧 AgentSession 模型

路径：`backend/apps/agents/src/schemas/agent-session.schema.ts`

新增统一容器字段：

- `runIds[]`（引用运行记录）
- `memoIds[]`（引用 memo）
- `planContext`（`linkedPlanId/linkedTaskId/latestTaskInput/latestTaskOutput/lastRunId`）
- `meetingContext`（预留会议上下文）

### 2.2 新增 `orchestration` 侧 PlanSession 模型

路径：`backend/src/shared/schemas/plan-session.schema.ts`

按 `planId` 聚合任务快照：

- task 基础信息（`taskId/order/title`）
- 状态（`pending/assigned/in_progress/blocked/waiting_human/completed/failed/cancelled`）
- 输入输出（`input/output/error`）
- 执行关联（`agentSessionId/agentRunId`）

---

## 3. 关键实现变更

### 3.1 Agents Runtime 接管 Session 生命周期

涉及文件：

- `backend/apps/agents/src/modules/runtime/runtime.module.ts`
- `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`
- `backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts`

主要改动：

- runtime 挂载 `AgentSession` model。
- 在 `startRun` 入口调用 `ensureSession`（若无则创建）。
- 在 run 启动/完成/失败后调用 `appendRunToSession`，写入 `runIds` 与 `planContext.lastRunId/latestTaskOutput`。
- `RuntimeRunContext` 新增 `sessionId` 回传给上层执行链路。

### 3.2 Agent 执行接口返回 run/session 元信息

涉及文件：

- `backend/apps/agents/src/modules/agents/agent.service.ts`
- `backend/apps/agents/src/modules/agents/agent.controller.ts`
- `backend/src/modules/agents-client/agent-client.service.ts`

主要改动：

- 新增 `executeTaskDetailed`，返回：`{ response, runId, sessionId }`。
- 原 `executeTask` 保持兼容，内部复用 detailed 结果并仅返回 `response`。
- `POST /agents/:id/execute` 响应扩展为 `response + runId + sessionId`。
- legacy 侧 `AgentClientService` 增加 `executeTaskDetailed` 调用。

### 3.3 Orchestration 移除本地会话管理，接入 PlanSession

涉及文件：

- `backend/src/modules/orchestration/orchestration.module.ts`
- `backend/src/modules/orchestration/orchestration.controller.ts`
- `backend/src/modules/orchestration/orchestration.service.ts`

主要改动：

- 模块移除 `SessionManagerService` 注入与导出。
- 控制器移除 `/orchestration/sessions` 相关接口。
- 执行节点改为调用 `agentClientService.executeTaskDetailed(...)`。
- 每个 task 固定传入 task 级 sessionId：`orch-task-{taskId}`。
- `createPlanFromPrompt` 时初始化 `PlanSession.tasks[]`。
- 在任务执行各路径（进行中/成功/失败/等待人工/改派/重试/人工完成）同步更新 `PlanSession` 快照。
- `GET /orchestration/plans/:id` 返回附带 `planSession` 视图。

---

## 4. 文档更新

- 新增计划文档：`docs/plan/AGENT_ORCHESTRATION_AGENTSESSION_UNIFICATION_PLAN.md`
- 更新 Agents API：`docs/api/agents-api.md`
  - 标注 `POST /agents/:id/execute` 返回 `response + runId + sessionId`
- 更新 Legacy API：`docs/api/legacy-api.md`
  - 标注 orchestration 不再维护 `/orchestration/sessions` 接口

---

## 5. 验证结果

已执行：

- `npm run build`（legacy）
- `npm run build:agents`

结果：均通过。

说明：

- `npm run lint` 在当前仓库失败，原因是缺少 ESLint 配置文件（历史环境问题，非本次改动引入）。

---

## 6. 当前边界与后续建议

已完成本轮目标，但仍建议后续迭代：

1. **迁移策略完善**：为历史 orchestration session 增加只读兼容或离线迁移脚本。
2. **契约收敛**：将 `execute` 返回体定义为共享 contract（避免多处弱类型 `context:any`）。
3. **事件驱动回写**：未来可由 runtime hook 事件异步回写 PlanSession，减少 orchestration 同步耦合。
4. **查询能力增强**：增加按 `planId/taskId/sessionId/runId` 的统一追踪接口，提升排障效率。

---

## 7. 增量改造：AgentSession 直接存储消息

根据后续需求补充实现：`AgentSession` 直接持久化会话消息，作为上下文主读取源。

实施内容：

- `backend/apps/agents/src/schemas/agent-session.schema.ts`
  - 新增 `messages[]` 字段，结构包含：
    - `id/runId/taskId`
    - `role`（`system/user/assistant/tool`）
    - `content`
    - `status`（`pending/streaming/completed/error`）
    - `metadata/timestamp`
- `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`
  - 在 `createMessage(...)` 写入 runtime 消息集合后，同步 `appendMessageToSession(...)`。
  - 新增 `AGENT_SESSION_MAX_MESSAGES`（默认 `1200`）用于消息条数裁剪，避免 session 文档无上限增长。

效果：

- 会议/编排等上层场景读取 Agent 上下文时可优先查询 `AgentSession.messages`，无需先拼装 runtime 子集合。
- runtime 细粒度执行数据（part/outbox 等）仍保留，满足审计与深度排障需求。

---

## 8. 增量改造：会议中通过 MCP 执行编排计划

根据新增需求，补充了会议场景下的 orchestration MCP 工具能力。

实施内容：

- `backend/apps/agents/src/modules/tools/tool.service.ts`
  - 新增工具：
    - `orchestration_create_plan`
    - `orchestration_run_plan`
    - `orchestration_get_plan`
    - `orchestration_list_plans`
    - `orchestration_reassign_task`
    - `orchestration_complete_human_task`
  - 新增服务间调用封装：使用 `x-user-context + x-user-signature` 调用 legacy orchestration API。
  - 新增会议上下文约束：上述工具仅允许会议上下文使用。
  - 高风险动作增加确认门槛：`confirm=true`。
- `backend/apps/agents/src/modules/agents/agent.service.ts`
  - 工具执行链路透传 `teamContext/taskType/teamId` 到 ToolService，支持会议场景识别。
- `backend/src/modules/orchestration/orchestration.controller.ts`
  - 鉴权兼容内部签名上下文（无 Bearer Token 的服务调用场景）。

效果：

- 会议中的 Agent 可以直接通过 MCP 工具创建/执行/查询编排计划。
- 编排能力在会议内闭环，不需要人工跳转到外部页面发起。

---

## 9. 增量改造：会议编排意图强制触发工具调用

问题复盘：

- 会议中 Agent 即使具备 `orchestration_*` 工具，也可能只返回自然语言承诺，不生成 `<tool_call>`。
- 原因是工具调用是“可调用”而非“必须调用”，模型可能直接结束回合。

修复实现（`backend/apps/agents/src/modules/agents/agent.service.ts`）：

- 新增会议编排意图识别：在 `discussion` 上下文中识别 `创建计划/执行计划/查询计划/改派/人工完成` 等指令。
- 命中后走确定性分支，直接触发对应 MCP 工具（`orchestration_*`），不依赖模型先输出 `<tool_call>`。
- 执行成功后返回结构化摘要（planId、状态统计等）。
- 执行失败时返回明确失败原因与补参建议（如缺失 planId/taskId）。
- 若识别到编排意图但 Agent 未分配任何 `orchestration_*` 工具，直接返回可操作提示，避免“我无权限”泛化回复。

---

## 计划原文（合并归档：AGENT_ORCHESTRATION_AGENTSESSION_UNIFICATION_PLAN.md）

# Agent 编排与 Session 统一计划

## 背景

当前 `orchestration` 与 `apps/agents` 存在双套会话/运行时数据模型，导致：

- 任务执行上下文分散在多处存储，追踪困难。
- `orchestration` 侧会话粒度与任务粒度不一致（按 plan+agent 复用 session）。
- 编排层与执行层边界不够清晰。

本计划目标是：

1. `apps/agents` 成为 AgentSession 的唯一管理者。
2. 任务执行改为「每个 Task 对应一个 AgentSession」。
3. `orchestration` 增加轻量 `PlanSession`，仅记录任务输入输出与状态，不存工具调用细节。

## 执行步骤

1. 扩展 `apps/agents` 的 AgentSession 能力，新增统一上下文字段（planContext/meetingContext 等），并保持引用式存储策略，避免单文档膨胀。
2. 在 `orchestration` 引入 `PlanSession` 模型，按 plan 聚合 task 级输入输出、执行状态与错误信息。
3. 改造 `AgentClientService` 与 `apps/agents` 执行接口，使 `orchestration` 在触发任务时可显式传入/创建 task 级 session。
4. 重构 `OrchestrationService`：移除本地 AgentSession 管理逻辑，改为通过 `apps/agents` 返回的 session/run 信息进行关联；保留编排、依赖调度、质量校验职责。
5. 更新查询接口与返回结构：在 plan 详情中附带 `planSession` 视图（task input/output/status），保证前端可见性与兼容。
6. 补充迁移与兼容策略（旧会话可读、新会话新写），并完成回归测试（编排执行、失败重试、人工接管路径）。
7. 调整 AgentSession 存储策略：在 `apps/agents` 中由 AgentSession 直接持久化会话消息（messages），Runtime 细粒度集合继续保留为执行明细层。

## 关键影响点

- 后端：`backend/apps/agents`、`backend/src/modules/orchestration`、`backend/src/modules/agents-client`
- 数据库：新增 `PlanSession` 集合；扩展 `AgentSession` 结构
- API：`agents/:id/execute` 请求上下文与响应结构会扩展（session/run 元信息）
- 前端：编排详情读取 `planSession` 信息（如需可后续分阶段接入）
- 数据模型：`AgentSession` 新增 `messages[]`，需考虑容量治理（条数裁剪）

## 风险与依赖

- 事件/执行状态一致性风险：异步执行回写需要保证幂等。
- 历史数据兼容风险：旧任务无 task 级 session，需要 fallback 读取。
- 服务边界依赖：`orchestration` 对 `apps/agents` 的 session/run 元数据依赖增强，需要约定稳定 contract。
- 存储容量风险：`messages[]` 直接写入 session，需限制消息数量避免单文档过大。

## 验收标准

- 每个 orchestration task 执行时都能关联唯一 AgentSession。
- orchestration 不再写入/维护本地 AgentSession。
- plan 维度可查看所有 task 的输入、输出、状态（通过 PlanSession）。
- 研究/审核/外部动作等既有校验路径不退化。
- AgentSession 可直接查询会话消息（含 user/assistant/system/tool），无需跨集合拼装基础上下文。

# ORCHESTRATION AGENT FIRST REQUIREMENT MCP PLAN

## 背景

- 当前 `backend/src/modules/orchestration` 在两个链路上直接调用 EI HTTP 接口：
  - 规划上下文读取 requirement 详情（GET `/ei/requirements/:id`）
  - 运行生命周期回写 requirement 状态（POST `/ei/requirements/:id/status`）
- 该模式属于系统直连，不符合 Agent-First 原则。

## 目标

- requirement 相关读写统一改为由 CTO/Planner Agent 通过 Requirement MCP 工具执行。
- orchestration 不再直接调用 EI requirement 接口。
- requirement 相关动作默认 fail-closed：工具执行失败则中断当前流程。

## 执行步骤

1. 在 `PlanningContextService` 中移除 EI axios 直连，改为注入强约束提示词，要求 planner/CTO agent 主动调用 `builtin.sys-mg.mcp.requirement.get`。
2. 在 `OrchestrationContextService` 中移除 EI axios 直连，改为通过 `AgentClientService.executeTask` 下发强约束提示词，驱动 planner/CTO agent 主动调用 `builtin.sys-mg.mcp.requirement.update-status`。
3. 调整 `PlanExecutionService` 调用链，状态回写显式传入 planner/CTO agentId；缺失 agentId 时按 fail-closed 抛错。
4. 增加最小证明校验（缺少 `REQUIREMENT_STATUS_UPDATE_PROOF` 视为失败）。
5. 更新 guide 文档，记录 requirement 同步链路已切为 Agent MCP 调用。

## 影响点

- 后端 Orchestration：规划上下文构建、运行状态同步
- Agent Tool 调用链：Requirement MCP 权限与可用性
- 可靠性语义：best-effort -> fail-closed（仅 requirement 相关链路）
- 文档：`docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD`

## 风险与依赖

- planner agent 未配置 requirement MCP 工具时将直接失败。
- 工具链路比直连多一跳，可能增加时延。
- 需要通过日志确认 tool execution 的可观测性满足排障需求。

# Plan C - Agents 核心服务拆分一期（P0-P1）

## 目标

降低 `agents` 侧 God Class 复杂度，按职责拆分 service，先完成高收益、低风险拆分。

## 影响点

- `backend/apps/agents/src/modules/tools/tool.service.ts`
- `backend/apps/agents/src/modules/agents/agent.service.ts`
- `backend/apps/agents/src/modules/memos/memo.service.ts`
- 相关模块测试与依赖注入配置

## 对应问题

- N-1, N-2, N-3, N-5

## 执行步骤

1. `tool.service.ts` 优先提取 `builtin-tool-definitions.ts` 与 `InternalApiClient`
2. 提取 `AgentExecutionService`，统一 `executeTaskDetailed/executeTaskWithStreaming` 的公共流程
3. 提取工具处理器：`OrchestrationToolHandler`、`RequirementToolHandler`、`RepoToolHandler`
4. 提取 `ToolGovernanceService`，承接限流、熔断、重试等治理逻辑
5. 提取 `MemoTaskTodoService` 与 `MemoTaskHistoryService`

## 验收标准

- 目标大文件行数明显下降，职责边界清晰
- Agent 与 Tool 的核心行为保持等价
- 单元测试与关键链路集成测试通过

## 风险与依赖

- 依赖注入调整较多，需分步迁移并保持接口兼容
- 拆分过程需避免引入循环依赖

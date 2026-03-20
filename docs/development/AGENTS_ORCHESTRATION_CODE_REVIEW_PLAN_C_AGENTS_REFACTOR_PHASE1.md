# AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_C_AGENTS_REFACTOR_PHASE1 开发沉淀

## 1. 背景与目标

- 对齐 `docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_C_AGENTS_REFACTOR_PHASE1.md`。
- 聚焦 Plan C 一期（P0-P1）中高收益低风险拆分，优先降低 `tool.service.ts`、`agent.service.ts`、`memo.service.ts` 的 God Class 风险。
- 对齐 `docs/issue/AGENTS_ORCHESTRATION_CODE_REVIEW.md` 执行建议，优先落地 N-1/N-2/N-3/N-5 相关结构性问题修复。

## 2. 本次落地范围

### 2.1 Tools 模块拆分（P0-P1）

- 新增 `InternalApiClient`：统一内部 HTTP 调用、签名头、错误摘要与超时配置。
  - 文件：`backend/apps/agents/src/modules/tools/internal-api-client.service.ts`
- 新增 `ToolGovernanceService`：抽离工具治理逻辑（限流、熔断、超时、重试、幂等 key）。
  - 文件：`backend/apps/agents/src/modules/tools/tool-governance.service.ts`
- `ToolService` 改造为编排层：
  - 内部 API 调用改为委托 `InternalApiClient`
  - 治理逻辑改为委托 `ToolGovernanceService`
  - 移除 `INTERNAL_CONTEXT_SECRET` 硬编码 fallback（未配置时显式报错）
  - 文件：`backend/apps/agents/src/modules/tools/tool.service.ts`
- 模块注入更新：
  - 文件：`backend/apps/agents/src/modules/tools/tool.module.ts`

### 2.2 Memos 模块拆分（P1）

- 新增 `MemoTaskTodoService`：承接 todo 状态归一化、读写聚合、内容渲染。
  - 文件：`backend/apps/agents/src/modules/memos/memo-task-todo.service.ts`
- 新增 `MemoTaskHistoryService`：承接 history 状态归一化、timeline 去重、内容渲染。
  - 文件：`backend/apps/agents/src/modules/memos/memo-task-history.service.ts`
- `MemoService` 保留主流程编排，todo/history 细节下沉至两个子服务。
  - 文件：`backend/apps/agents/src/modules/memos/memo.service.ts`
- 模块注入更新：
  - 文件：`backend/apps/agents/src/modules/memos/memo.module.ts`

### 2.3 Agents 模块执行公共流程抽取（P0 起步）

- 新增 `AgentExecutionService`，抽离两条执行链路公共能力：
  - runtime agentId 解析
  - model config 构建
  - runtime session system message 追加
  - 文件：`backend/apps/agents/src/modules/agents/agent-execution.service.ts`
- `AgentService` 的 `executeTaskDetailed`/`executeTaskWithStreaming` 已改为复用上述公共能力。
  - 文件：`backend/apps/agents/src/modules/agents/agent.service.ts`
- 模块注入更新：
  - 文件：`backend/apps/agents/src/modules/agents/agent.module.ts`

## 3. 测试与验证

- 构建验证：`npm run build:agents`（通过）
- 单测验证：
  - `apps/agents/src/modules/tools/tool.service.spec.ts`
  - `apps/agents/src/modules/memos/memo.service.spec.ts`
  - `apps/agents/src/modules/agents/agent.service.spec.ts`
  - 结果：3/3 suite 通过，27/27 tests 通过

## 4. 与 Review 建议对齐情况

- 已对齐：
  - `tool.service.ts` 抽离 `InternalApiClient`（Issue 第一章 2.2 P0）
  - `tool.service.ts` 抽离 `ToolGovernanceService`（Issue 第一章 2.2 P1）
  - `memo.service.ts` 抽离 `MemoTaskTodoService`、`MemoTaskHistoryService`（Issue 第一章 4.2 P1）
  - `agent.service.ts` 执行链路公共能力收敛到 `AgentExecutionService`（Issue 第一章 3.2 P0 起步）
  - 安全项：移除 `INTERNAL_CONTEXT_SECRET` 默认值（Issue N-17 / N-32）
- 尚未完成（下一阶段）：
  - `executeTaskDetailed`/`executeTaskWithStreaming` 全链路模板化（prepare/finalize 级别）

## 5. 第二轮补充拆分（同日增量）

### 5.1 Tools 继续解耦

- `builtinTools` 大数组与实现 ID 列表已外提到独立目录文件：
  - `backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts`
  - `backend/apps/agents/src/modules/tools/builtin-tool-definitions.ts`
- 工具分发在 Phase1 基础上继续细分 handler：
  - `OrchestrationToolHandler` / `RequirementToolHandler` / `RepoToolHandler`（已接入）
  - `ModelToolHandler` / `SkillToolHandler` / `AuditToolHandler` / `MeetingToolHandler`（新增接入）
- `ToolService` 进一步收敛为“注册 + 路由 + 编排”角色，具体执行逻辑下沉子服务。

### 5.2 验证结果

- 构建验证：`npm run build:agents`（通过）
- 回归单测：
  - `apps/agents/src/modules/tools/tool.service.spec.ts`
  - `apps/agents/src/modules/memos/memo.service.spec.ts`
  - `apps/agents/src/modules/agents/agent.service.spec.ts`
  - 结果：3/3 suite 通过，27/27 tests 通过

### 5.3 当前剩余项

- `AgentService` 执行链路（`executeTaskDetailed`/`executeTaskWithStreaming`）仍可继续做模板化收敛。

## 6. 第三轮补充拆分（2026-03-14）

### 6.1 Agent 执行链与运行时模板继续收口

- `AgentExecutionService` 新增 runtime 生命周期模板方法：
  - `startRuntimeExecution`
  - `completeRuntimeExecution`
  - `failRuntimeExecution`
  - `releaseRuntimeExecution`
- `AgentService` 的 `executeTaskDetailed/executeTaskWithStreaming` 改为调用上述模板方法，移除重复 `startRun/completeRun/failRun/releaseRun` 分支。
- 抽取 `resolveCustomApiKey`，统一 detailed/streaming API Key 获取、usage 记录与降级日志。

### 6.2 ToolService 继续去重（Phase C2 收口）

- `ToolService` 主分发改为薄分发 + 领域分发：
  - `dispatchRepoToolImplementation`
  - `dispatchOrchestrationToolImplementation`
  - `dispatchRequirementToolImplementation`
- 删除已迁移到 handler 的 requirements/orchestration 冗余私有实现，降低主类复杂度。

### 6.3 Memo history 策略继续下沉（Phase C3 收口）

- `MemoTaskHistoryService` 新增：
  - `UpsertHistoryTaskInput`
  - `upsertHistoryItem`
- `MemoService.upsertTaskHistory` 改为调用 `MemoTaskHistoryService.upsertHistoryItem`，主服务保留编排入口。

## 7. 第四轮补充拆分（2026-03-14）

### 7.1 Agent 深拆分：策略与意图下沉

- 新增 `AgentOpenCodePolicyService`：下沉 OpenCode gate/budget 策略（配置解析、门禁校验、配额审批暂停/恢复）。
- 新增 `AgentOrchestrationIntentService`：下沉会议编排意图识别、强制工具映射与结果文案（历史项，文件已于 2026-03-19 删除）。

### 7.2 Agent 深拆分：MCP Profile 领域下沉

- 新增 `AgentMcpProfileService`：下沉 MCP profile seeds、profile CRUD、tool permission set reset/upsert、agent->profile 映射与 tool summary 组装。
- `AgentService` 删除对应大段 MCP 常量与私有实现，改为服务协作。

### 7.3 量化结果

- `agent.service.ts`：`3474 -> 2250`（累计 `-1224`）
- 达到 Plan C 目标阈值附近（`<= 2200`，当前差 `50` 行）

## 8. 测试与验证（本轮）

- 构建验证：`npm run build:agents`（通过）
- 回归单测：
  - `apps/agents/src/modules/tools/tool.service.spec.ts`
  - `apps/agents/src/modules/agents/agent.service.spec.ts`
  - `apps/agents/src/modules/memos/memo.service.spec.ts`
  - 结果：3/3 suite 通过，27/27 tests 通过

## 6. 风险与后续建议

- 当前拆分为可回滚的小步改造，优先保证行为等价与测试稳定。
- 后续继续拆分前，建议先补充 handler 级单测，降低分发逻辑迁移风险。
- 对 `tool.service.ts` 的 4k+ 规模仍需继续推进 handler 级拆分，避免后续演进再次回到集中式变更。

## 9. 关联文档

- 计划文档：`docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_C_AGENTS_REFACTOR_PHASE1.md`
- Review 文档：`docs/issue/AGENTS_ORCHESTRATION_CODE_REVIEW.md`

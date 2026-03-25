# [已弃用] ORCHESTRATION_TASK_DEBUG_MCP_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# ORCHESTRATION_TASK_DEBUG_MCP 开发总结

## 1. 实施结果

- 已新增计划编排任务调试 MCP 工具：`builtin.sys-mg.mcp.orchestration.debug-task`。
- Agent 可在会议编排上下文中直接调试单个任务，无需人工先切换到页面。
- 调试返回已结构化补充：状态、错误、结果片段、最近日志、建议下一步动作。

## 2. 代码改动

### 2.1 Tools 模块

- `backend/apps/agents/src/modules/tools/tool.service.ts`
  - 注册新内置工具：`builtin.sys-mg.mcp.orchestration.debug-task`
  - 执行分发新增 debug-task 分支
  - 新增 `debugOrchestrationTask` 方法：
    - 参数校验：`taskId` 必填，`title/description` 长度限制
    - 透传调用：`POST /orchestration/tasks/:id/debug-run`
    - 结果封装：`debug.status/error/resultSnippet/recentLogs/suggestedNextAction`

### 2.2 Agent 编排意图与反馈

- `backend/apps/agents/src/modules/agents/agent.service.ts`
  - MCP profile 种子工具列表加入 `debug-task`
  - 会议编排强制工具调用意图新增 `mcp.orchestration.debugTask`
  - 支持关键词：`调试任务`、`任务调试`、`debug task`、`debug-run`
  - 新增调试执行后的自然语言结果反馈模板

### 2.3 测试

- `backend/apps/agents/src/modules/tools/tool.service.spec.ts`
  - 新增 3 个用例：
    - 缺失 `taskId` 抛错
    - 调试成功并返回摘要
    - completed 状态建议动作

## 3. 配置与文档同步

- `backend/package.json`
  - 新增 Jest 配置（`ts-jest`、alias 映射、jest types）

- `backend/.eslintrc.cjs`
  - 新增 backend ESLint 基础配置（用于解决无配置导致无法执行 lint）

- `docs/feature/ORCHETRATION_TASK.md`
  - 增补“任务调试 MCP”设计说明

- `docs/feature/AGENT_TOOL.md`
  - 编排工具能力说明补充 task debug

- `docs/api/agents-api.md`
  - 新增 `orchestration_debug_task` 端点映射与参数/返回语义

## 4. 验证

- 执行：`npm test -- tool.service.spec.ts`（backend）
- 结果：通过（3 passed）

- 执行：`npm run build:agents`（backend）
- 结果：构建通过

## 5. 风险与后续建议

- 当前调试 MCP 仍依赖会议上下文（meeting-like）约束，跨上下文调用会被拒绝。
- 建议后续补充“调试安全模式”策略，对外部副作用任务默认限制实际执行，仅保留验证路径。
- 建议补充集成测试，覆盖 Agent -> Tool -> Orchestration API 的端到端链路。

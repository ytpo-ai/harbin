# CTO Agent 日常研发工作流改造（开发沉淀）

## 关联主文档索引

- 计划主文档：`docs/plan/CTO_AGENT_DAILY_DEV_WORKFLOW_PLAN.md`
- 功能文档：`docs/feature/ORCHETRATION_TASK.md`
- 功能文档：`docs/feature/AGENT_TOOL.md`
- 功能文档：`docs/feature/ENGINEERING_INTELLIGENCE.md`

## 本次目标

围绕 CTO Agent 的“需求 -> 编排 -> 执行 -> 回写”闭环，优先完成 P0/P1 主链路，并补齐开发类任务自动验证（warning 级）基础能力。

## 已完成实现

1. Agents ToolService 新增需求管理 MCP 工具（8 个）：
   - `builtin.sys-mg.mcp.requirement.list`
   - `builtin.sys-mg.mcp.requirement.get`
   - `builtin.sys-mg.mcp.requirement.create`
   - `builtin.sys-mg.mcp.requirement.update-status`
   - `builtin.sys-mg.mcp.requirement.assign`
   - `builtin.sys-mg.mcp.requirement.comment`
   - `builtin.sys-mg.mcp.requirement.sync-github`
   - `builtin.sys-mg.mcp.requirement.board`
2. 编排 MCP 工具从“仅会议上下文”升级为“会议/自治双上下文”：
   - 新增 `assertExecutionContext`，支持 `meeting` 与 `autonomous` 两种模式。
   - `create-plan / update-plan / run-plan / get-plan / list-plans / reassign-task / complete-human-task / create-schedule / update-schedule / debug-task` 已接入双模式。
3. 编排任务模型新增需求关联：
   - `orchestration_tasks` 增加 `requirementId?: ObjectId`。
   - 增加 `requirementId + status + updatedAt` 索引，便于按需求聚合任务状态。
4. 计划创建与重规划透传需求上下文：
   - `CreatePlanFromPromptDto` 增加 `requirementId`。
   - `PlannerService.planFromPrompt` / `planByAgent` 支持 requirement 上下文注入。
   - 任务落库时自动写入 `requirementId`（可解析 ObjectId 时）。
5. 任务执行完成后回写需求状态（best-effort）：
   - 计划启动时尝试回写 `in_progress`。
   - 计划整体完成时尝试回写 `review -> done`。
   - 回写失败不阻塞编排执行链路。
6. GitHub Issue 生命周期同步补齐：
   - 需求状态变为 `done` 时自动关闭 Issue。
   - 从 `done` 回退到其他状态时自动 reopen Issue。
   - GitHub 调用失败仅记录 `lastError`，不阻塞需求状态流转。
7. 开发类任务自动验证门禁（warning）：
   - 新增 `validateCodeExecutionProof`，检查 build/test/lint 执行证据、成功信号、代码变更信号。
   - 缺失证据仅记 `runLogs.warn`，不 hard block 任务完成。
8. 治理角色工具权限补齐：
   - `executive-lead`、`management-assistant`、`system-builtin-agent` MCP profile 增补 requirement 工具集，支持 CTO 治理侧直接发起需求闭环操作。

## 关键文件

- `backend/apps/agents/src/modules/tools/tool.service.ts`
- `backend/src/shared/schemas/orchestration-task.schema.ts`
- `backend/src/modules/orchestration/dto/index.ts`
- `backend/src/modules/orchestration/planner.service.ts`
- `backend/src/modules/orchestration/orchestration.service.ts`
- `backend/apps/engineering-intelligence/src/modules/engineering-intelligence/engineering-intelligence.service.ts`
- `backend/apps/agents/src/modules/agents/agent.service.ts`

## 验证结果

- 已执行：`pnpm -C backend exec tsc --noEmit`
- 结果：仓库存在既有 TS4053 类型导出错误（非本次改造引入），未新增本次改动特有阻断项。

## 后续建议

1. 在 Scheduler 触发链路统一注入 autonomous context（`organizationId + agentId`）并补充端到端回归。
2. 增加“任务维度 requirement 回写幂等策略”与并发保护（例如基于状态条件更新）。
3. 为 `CODE_EXECUTION_PROOF` 增加结构化运行证据来源（OpenCode session event 解析），减少文本启发式误判。

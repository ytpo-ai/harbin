# Orchestration 无用 MCP 工具清理开发总结（2026-03-29）

## 背景

- 当前工具目录中存在一组历史 Orchestration MCP 工具，已不再是主流程依赖，但仍保留在注册、分发、profile seed 与 alias 映射中。
- 这会导致工具可见性与实际能力不一致，也增加了维护和误调用成本。

本次目标：下线以下 5 个工具，并通过 seed 同步到数据层。

- `builtin.sys-mg.mcp.orchestration.complete-human-task`
- `builtin.sys-mg.mcp.orchestration.create-schedule`
- `builtin.sys-mg.mcp.orchestration.debug-task`
- `builtin.sys-mg.mcp.orchestration.reassign-task`
- `builtin.sys-mg.mcp.orchestration.update-schedule`

## 改动范围

1. 移除工具注册与执行路由
   - `backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts`
   - `backend/apps/agents/src/modules/tools/tool-execution-dispatcher.service.ts`

2. 移除 Agent 常量与 legacy alias 映射
   - `backend/apps/agents/src/modules/agents/agent.constants.ts`
   - `backend/apps/agents/src/modules/agents/agent-mcp-profile.service.ts`

3. 调整 seed，避免 profile 中残留已下线工具
   - `backend/scripts/seed/mcp-profile.ts`
   - 关键修正：`mode=sync` 时改为 `tools: normalizedSeedTools` 覆盖写入，不再仅 `$addToSet`。

4. 增加历史工具清理标记
   - `backend/apps/agents/src/modules/tools/builtin-tool-definitions.ts`
   - 将 5 个 canonical tool id 纳入 `DEPRECATED_TOOL_IDS`，配合 `builtin-tools` 的 sync 清理旧数据。

5. 功能文档同步
   - `docs/feature/AGENT_TOOL.md`
   - 编排工具能力说明更新为当前有效集合（create/update/run/get/list/submit-task/report-task-run-result）。

## 执行与验证

- 执行命令：
  - `npm run seed:manual -- --only=builtin-tools,mcp-profiles --mode=sync`
- 实际结果：
  - `builtin-tools`: `created=0`, `updated=51`, `skipped=0`
  - `mcp-profiles`: `seeded=13`

## 结果

- 5 个无用 Orchestration MCP 工具已从代码与 seed 入口下线。
- 工具注册层、分发层、MCP profile seed 层保持一致。
- 数据层通过 sync seed 已完成对齐，避免后续继续暴露已下线工具。

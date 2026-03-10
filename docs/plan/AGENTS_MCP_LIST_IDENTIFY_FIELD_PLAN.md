# Agents MCP List Identify 字段调整计划

## 1. 需求理解

- 调整内置工具 `builtin.sys-mg.internal.agent-admin.list-agents` 的返回结构：
  - 移除 `roleId`、`type`
  - 新增 `identify` 字段
- `identify` 来源：按 `agentId + memoKind(identity)` 查询 memo，取第一条记录内容。
- 当 memo 缺失时，`identify` 返回空字符串 `""`。

## 2. 执行步骤

1. 定位 `Agents MCP List` 响应组装逻辑，确认字段出参与过滤行为（`includeHidden`/`limit`）。
2. 在 Memo 服务新增批量查询能力：按 `agentIds + memoKind` 拉取首条 memo 内容并构建映射。
3. 调整 `getAgentsMcpList` 返回结构，删除 `roleId/type`，并注入 `identify`。
4. 保持现有可见性与分页上限逻辑不变，避免行为回归。
5. 更新相关 API/功能文档，说明响应字段变更。

## 3. 影响点

- 后端：`backend/apps/agents/src/modules/tools/tool.service.ts`
- 后端：`backend/apps/agents/src/modules/memos/memo.service.ts`
- 文档：`docs/api/agents-api.md`、`docs/feature/AGENT_TOOL.md`

## 4. 风险与依赖

- 响应字段删除（`roleId/type`）可能影响现有调用方解析逻辑。
- `identify` 可能较长（memo 内容原文），调用方需按需截断展示。
- 数据依赖 memo 表，若未生成 identity memo 则返回空字符串。

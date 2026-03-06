# 前端 MCP Profile 管理能力补齐计划

## 背景

当前后端已具备 MCP Profile 查询与更新接口，但前端缺少管理入口，导致：

- 业务侧无法直接查看不同 `agentType` 的工具与能力配置。
- 新增工具后，难以及时验证或修正历史 Profile。
- 遇到 Agent “只能回复不执行工具”时，排障成本较高。

## 执行步骤

1. 梳理现有 Agents 页面结构与 API 封装，确定 MCP Profile 管理挂载位置（优先放在 Agents 页面中）。
2. 新增 MCP Profile 管理视图：列表 + 编辑面板，支持查看并更新 `role/tools/capabilities/exposed`。
3. 前端接入 `GET /agents/mcp/profiles`、`GET /agents/mcp/profiles/:agentType`、`PUT /agents/mcp/profiles/:agentType`。
4. 后端修复 MCP Profile seed 同步策略：从仅首次插入改为可对现有 profile 同步关键字段，避免历史 profile 长期缺失新工具。
5. 更新文档（API/开发沉淀），补充运维排障指引（Agent 无法调用工具时先查 profile）。
6. 执行构建验证（frontend + agents），确保编译通过。

## 关键影响点

- 前端：`frontend/src/pages/Agents.tsx`、`frontend/src/services/*`
- 后端：`backend/apps/agents/src/modules/agents/agent.service.ts`
- 文档：`docs/api/agents-api.md`、`docs/development/*`

## 风险与依赖

- 风险：直接编辑 profile 可能误删关键工具。
  - 缓解：前端提供当前值预览与保存前确认。
- 风险：seed 同步策略若过于强制，可能覆盖业务自定义配置。
  - 缓解：只补齐缺失工具/能力，不盲目替换全部字段。

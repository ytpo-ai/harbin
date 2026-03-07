# MCP Profile 治理主计划（开发沉淀）

## 关联主文档索引

- 计划主文档：`docs/plan/MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md`
- 技术实现细节：`docs/technical/MCP_PROFILE_GOVERNANCE_TECHNICAL.md`（中文）
- 相关 API 文档：`docs/api/agents-api.md`

## 范围

聚合沉淀：

- `docs/plan/FRONTEND_MCP_PROFILE_MANAGEMENT_PLAN.md`
- `docs/plan/AGENT_TOOL_WHITELIST_MODE_PLAN.md`

## 已完成实现

1. 前端新增 MCP Profile 管理能力（列表 + 编辑）。
2. 前端补齐 MCP Profile API 接入（查询/单条查询/更新）。
3. Agent 页面结构调整为 tab：`Agent 管理` / `MCP Profile 管理`。
4. 后端 seed 从“仅插入”增强为“对历史 profile 补齐关键字段（tools/capabilities）”。
5. 后端新增白名单硬校验：`Agent.tools` 必须是 profile 子集。
6. 前端 Agent 工具选择联动白名单，仅展示当前类型可选工具。
7. 对历史非法工具增加提示与保存收敛。

## 关键文件

- `frontend/src/pages/Agents.tsx`
- `frontend/src/services/agentService.ts`
- `backend/apps/agents/src/modules/agents/agent.service.ts`
- `docs/api/agents-api.md`

## 实现细节迁移说明

本开发沉淀聚焦治理结果与问题闭环；白名单校验、seed 同步、UI 联动与失败模式等实现细节已迁移至：

- `docs/technical/MCP_PROFILE_GOVERNANCE_TECHNICAL.md`（中文技术设计文档）

## 线上问题与对应修复

- 现象：前端看不到 MCP Profile 管理入口。
  - 修复：增加独立管理视图与编辑能力。
- 现象：profile 未配置但 Agent 仍可选/可用工具。
  - 修复：白名单模式 + 后端硬校验。
- 现象：新增工具后老 profile 不生效。
  - 修复：seed 同步策略支持历史补齐。

## 后续建议

1. 增加 profile 变更审计（操作者、变更前后 diff、时间）。
2. 增加“按 agentType 一键对齐 profile 默认值”操作入口。

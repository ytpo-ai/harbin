# Agent 工具白名单模式改造计划

> 已聚合到主计划：`docs/plan/MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md`

## 背景

当前 Agent 工具来源同时包含 `Agent.tools` 与 `MCP Profile.tools`，导致配置认知不一致：

- 前端可为 Agent 勾选任意工具，但 MCP Profile 未必包含该工具。
- 执行时又会合并两者，出现“Profile 没配置但 Agent 可调用”的现象。

目标是启用白名单模式：`Agent.tools` 必须是对应 `MCP Profile.tools` 的子集。

## 执行步骤

1. 后端新增工具白名单校验逻辑，约束 `createAgent` 和 `updateAgent` 写入工具集合。
2. 白名单来源为 `agent.type` 对应的 MCP Profile；若无 profile，则拒绝自定义工具写入。
3. 前端 Agent 管理页工具选择改为仅展示白名单工具，并对不合法历史工具给出提示。
4. 保存时自动过滤超出白名单的工具，并向用户反馈过滤结果。
5. 更新 API 文档，明确 `Agent.tools ⊆ MCPProfile.tools(agent.type)` 规则。
6. 构建验证 frontend 与 agents 后端，确保编译通过。

## 关键影响点

- 后端：`backend/apps/agents/src/modules/agents/agent.service.ts`
- 前端：`frontend/src/pages/Agents.tsx`
- 文档：`docs/api/agents-api.md`

## 风险与依赖

- 类型切换风险：变更 `agent.type` 后原工具可能不再合法。
  - 缓解：前端动态重算并提示非法项。
- 历史数据风险：已有 Agent 可能带有 profile 外工具。
  - 缓解：编辑保存时自动收敛到白名单；后续可补离线巡检脚本。

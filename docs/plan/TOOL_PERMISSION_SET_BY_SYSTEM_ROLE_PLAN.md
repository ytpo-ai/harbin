# 工具权限集（按系统角色）改造计划

## 目标

- 将前端“`MCP Profile 管理`”改名为“`工具权限集管理`”。
- 工具白名单与能力集从“按 Agent Type”切换为“按系统角色（HR Role）”。
- 提供“按系统角色重置数据”的一键能力，用于重建权限集基线。

## 执行步骤

1. 新增后端角色维度权限集接口（查询/更新/重置）。
2. 调整 Agent 工具白名单校验逻辑：优先按 `roleId -> role.code` 加载权限集。
3. 前端 Agent 页签改名与重构，基于系统角色展示权限集。
4. 增加“一键按系统角色重置权限集”按钮并展示执行结果。
5. 更新 API 与开发文档，完成构建验证。

## 影响点

- Backend（agents）：`agent.controller.ts`、`agent.service.ts`
- Frontend（agents）：`Agents.tsx`、`agentService.ts`
- Docs：`docs/api/agents-api.md`、`docs/development/AGENT_ROLE_HR_HARDCUT_PLAN.md`

## 风险

- 重置会覆盖现有权限集配置，需在 UI 中明确提示。
- 部分历史角色若缺少默认种子，将保留空/默认权限集并提示补充。

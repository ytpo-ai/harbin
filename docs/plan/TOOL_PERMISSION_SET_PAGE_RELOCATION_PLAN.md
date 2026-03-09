# 工具权限集管理页面迁移计划

## 需求目标

- 将“Agent 管理”页面下的“工具权限集管理”Tab 迁移到“工具管理”页面。
- 保持工具权限集现有能力不变（列表、编辑、按系统角色重置）。
- 保持 Agent 创建/编辑时的白名单能力约束不变。

## 执行步骤

1. 梳理当前页面职责与入口，确认 `Agents.tsx` 中权限集 UI 与 `Tools.tsx` 的现有 Tab 结构。
2. 在 `Tools.tsx` 增加“工具权限集管理”Tab，迁移权限集列表、编辑弹窗和重置操作。
3. 保留并复用 `agentService` 的权限集接口调用，避免接口与数据结构变更。
4. 从 `Agents.tsx` 移除权限集管理入口与相关状态逻辑，保留 Agent 列表与创建/编辑流程所需权限集数据读取。
5. 更新功能文档中的页面归属描述，并执行前端构建验证。

## 关键影响点

- 前端页面：`frontend/src/pages/Agents.tsx`、`frontend/src/pages/Tools.tsx`
- 前端服务：`frontend/src/services/agentService.ts`（仅复用，无协议变更）
- 文档：`docs/features/AGENT_MG.md`、`docs/features/AGENT_TOOL.md`

## 风险与依赖

- 页面迁移后需避免双入口并保持导航认知一致。
- 需确保权限集编辑弹窗迁移后工具筛选与保存逻辑一致，避免回归。
- 工具管理页 Tab 增加后需保持原工具筛选/日志功能不受影响。

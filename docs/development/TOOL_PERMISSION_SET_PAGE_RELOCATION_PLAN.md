# 工具权限集管理页面迁移开发总结

## 背景

- 原“工具权限集管理”位于 Agent 管理页面内，入口与“工具管理”职责存在分散。
- 本次调整目标是将权限集管理入口统一收敛到工具管理页面，减少跨页面操作成本。

## 实施内容

1. 新增并落地迁移计划文档。
   - `docs/plan/TOOL_PERMISSION_SET_PAGE_RELOCATION_PLAN.md`

2. 工具管理页新增“工具权限集管理”Tab，并迁移相关能力。
   - 新增 Tab：`frontend/src/pages/Tools.tsx`
   - 迁移能力：权限集列表、按系统角色重置、权限集编辑弹窗（含工具筛选与保存）

3. Agent 管理页移除权限集管理入口。
   - 移除 `Agents.tsx` 中“工具权限集管理”Tab 与编辑弹窗挂载。
   - 保留 Agent 创建/编辑所需权限集数据读取，不影响白名单模式约束。

4. 功能文档同步页面归属。
   - `docs/features/AGENT_MG.md`
   - `docs/features/AGENT_TOOL.md`

## 验证

- `frontend/` 执行 `npm run build` 通过。
- `frontend/` 未提供 `npm run lint` 脚本（执行时报 Missing script）。

## 影响与说明

- 仅前端页面入口迁移，后端权限集 API 与数据契约无变更。
- 迁移后避免了 Agent 页面与工具页面的双入口，权限治理入口更加集中。

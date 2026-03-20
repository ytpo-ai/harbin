# SKILL_BINDING_UI

## 模块定位

- 前端 Skill 绑定交互位于 `frontend/src/pages/Skills.tsx` 的 `SkillDetailDrawer` 组件中。
- 当前后端绑定接口保持单接口模式：`POST /skills/assign`（`enabled` 缺省为绑定，`enabled=false` 为解绑）。

## 关键数据来源

- Agent 列表：`agentService.getAgents()`。
- Skill -> Agent 绑定关系：`skillService.getAllSkillAgents()`，页面按 `skillId` 读取对应绑定数组。
- Skill 详情抽屉数据：`skillService.getSkillById(skillId, { includeContent: true })`。

## 绑定交互链路

1. 打开 Skill 详情抽屉时进入「Agent 绑定」Tab。
2. 以 `skillAgentsData` 初始化 `selectedAgentIds`（当前勾选集合）。
3. 用户在 Agent 列表逐项勾选，或通过“全选当前列表/取消全选”批量切换。
4. 点击“保存绑定”后，前端按差异计算：
   - `toBind = selected - initial`
   - `toUnbind = initial - selected`
5. 前端并行调用 `/skills/assign`：
   - 绑定：`{ agentId, skillId }`
   - 解绑：`{ agentId, skillId, enabled: false }`
6. 成功后刷新 `all-skill-agents` 查询，驱动列表与抽屉绑定态回显。

## 交互语义约束

- 全选按钮只作用于“当前可见 Agent 列表”，不跨筛选条件或后端分页。
- 当 `selectedAgentIds` 与初始绑定集合无差异时，保存按钮禁用，避免无效请求。
- 绑定保存后的提示展示“新增/解除”数量，便于批量操作结果确认。

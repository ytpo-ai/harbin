# Agent-role 迁移到 agents 计划

## 目标

- 将角色（Agent-role）主数据与管理能力收敛到 `backend/apps/agents`，不再依赖 legacy `/roles` 作为运行时强依赖。
- 保持 Agent 主流程（创建/编辑/执行）角色语义稳定，避免迁移期间影响 `roleId -> role.code` 权限链路。
- 统一前后端角色访问口径到 `/agents/roles*`，并保留短期兼容策略降低切换风险。

## 执行步骤

1. 在 agents 服务内补齐 `agent-role` 模块（schema/service/controller）并挂载到 `AgentsAppModule`。
2. 将现有 `AgentRoleService` 从“跨服务代理”改为“本地数据服务”，保留必要查询参数与响应结构兼容。
3. 改造 Agent 创建/更新校验链路，确保 `roleId` 校验仅依赖 agents 内部角色数据源。
4. 补充一次性迁移脚本（legacy roles -> agents roles，幂等）及最小化回填逻辑。
5. 对齐前端与调用方契约：角色下拉、详情展示、角色管理接口统一走 `/agents/roles*`。
6. 更新 API/feature 文档并完成 lint/typecheck/build 或测试验证。

## 关键影响点

- 后端（agents）：新增/启用角色主数据模块，调整 Agent 角色校验与查询路径。
- 后端（legacy）：角色服务从运行时强依赖降级为迁移输入源（可逐步下线）。
- 前端：角色数据来源保持 `/agents/roles*` 不变，但后端语义从代理改为本地直出。
- 数据库：`agent_roles` 集合成为 agents 侧角色事实来源；需要迁移与幂等保障。
- 测试：角色 CRUD、Agent 创建/更新角色校验、权限继承链路回归。

## 风险与应对

- 风险：迁移期间角色数据不一致导致 Agent 更新失败。
  - 应对：先导入后切读，提供幂等迁移脚本与差异日志。
- 风险：外部调用仍依赖 legacy `/roles`。
  - 应对：兼容期保留只读映射与日志观测，完成切流后移除。
- 风险：角色状态/字段口径差异（如 `isActive` vs `status`）。
  - 应对：在 agents role service 统一映射并在 API 文档显式声明。

## 验收标准

- `POST/PUT /agents` 在不访问 legacy `/roles` 的情况下可正确校验 `roleId`。
- `GET /agents/roles` 与 `GET /agents/roles/:id` 返回稳定且可用于前端管理页。
- 迁移脚本可重复执行且不会产生重复角色数据。
- 相关 feature/api 文档已更新并与实现一致。

# Agent Role HR Hardcut 开发总结

## 背景

- 角色能力从 Agent 内核中解耦，改为归属 legacy HR 业务域。
- 本次采用硬切换：不做历史迁移，直接切换到 `roleId` 必填契约。

## 实施内容

1. legacy HR 新增角色主数据管理能力。
   - 新增 `AgentRole` schema：`backend/src/shared/schemas/agent-role.schema.ts`。
   - HR 模块注入角色模型：`backend/src/modules/hr/hr.module.ts`。
   - 新增接口：
     - `GET /roles`
     - `GET /roles/:id`
     - `POST /roles`
     - `PUT /roles/:id`
     - `DELETE /roles/:id`
   - 业务实现：`backend/src/modules/roles/roles.service.ts`、`backend/src/modules/roles/roles.controller.ts`。

2. Agent 侧硬切换到 `roleId`。
   - Agent schema 将 `role` 替换为 `roleId` 且必填：`backend/src/shared/schemas/agent.schema.ts`。
   - 共享类型同步：`backend/src/shared/types.ts`、`frontend/src/types/index.ts`。
   - Agent 创建/更新流程强制校验 `roleId` 并调用 legacy HR 校验角色存在与激活状态：`backend/apps/agents/src/modules/agents/agent.service.ts`。
   - 新增跨服务角色查询代理接口：`GET /agents/roles`、`GET /agents/roles/:id`：`backend/apps/agents/src/modules/agents/agent.controller.ts`。

3. 前端角色管理与 Agent 绑定改造。
   - HR 页面新增角色管理（增删改查）：`frontend/src/pages/HRManagement.tsx`。
   - 新增 HR 角色服务：`frontend/src/services/hrService.ts`。
   - Agent 创建/编辑页移除 role 文本输入，改为 `roleId` 必选下拉：`frontend/src/pages/Agents.tsx`。
   - Agent 服务新增角色查询：`frontend/src/services/agentService.ts`。

4. 相关兼容调整。
   - 会议模块去除 `agent.role` 依赖，改为按名称识别系统模型管理 Agent：`backend/src/modules/meetings/meeting.service.ts`。
   - 人类专属助理创建改为传 `roleId`：`backend/src/modules/employees/employee.service.ts`。
   - Memo identity 聚合的角色输出改为 `roleId`：`backend/apps/agents/src/modules/memos/identity-aggregation.service.ts`。

5. 文档更新。
   - 计划文档：`docs/plan/AGENT_ROLE_HR_HARDCUT_PLAN.md`。
   - API 文档：`docs/api/agents-api.md`。
   - 类型规范：`docs/agent_type.md`。

## 验证

- `backend/` 执行 `npm run build`（legacy）通过。
- `backend/` 执行 `npm run build:agents` 通过。
- `frontend/` 执行 `npm run build` 通过。

## 风险与说明

- 硬切换下，历史无 `roleId` 的 Agent 不满足新约束（创建/更新会失败），属于预期。
- 专属助理默认角色依赖 `DEFAULT_EXCLUSIVE_ASSISTANT_ROLE_ID`（未配置回退 `human-exclusive-assistant-role`），需保证该角色在 HR 中存在。

## 增量：按 agent_type 初始化角色并关联现有 Agent

- 新增幂等接口：`POST /roles/sync-from-agent-types`。
  - `backfillAgents=true` 时，会按 `agent.type` 映射写入 `agent.roleId`。
  - 同步结果返回创建/更新角色数、Agent 回填数、未匹配 type 等统计。
- 角色种子来源对齐 `agent_type` 规范（`agentType -> defaultRole(code)`）。
- HR 角色页面新增“一键初始化并关联 Agent”操作按钮。

## 增量：MCP Profile 管理升级为工具权限集管理

- Agent 管理页将“`MCP Profile 管理`”重命名为“`工具权限集管理`”。
- 工具权限集按系统角色（`role.code`）维度维护，不再以 `agent.type` 为主键。
- 新增接口：
  - `GET /agents/tool-permission-sets`
  - `PUT /agents/tool-permission-sets/:roleCode`
  - `POST /agents/tool-permission-sets/reset-system-roles`
- 新增一键重置操作：按系统角色默认种子重建权限集数据。
- Agent 工具白名单校验改为优先按 `roleId -> role.code` 命中权限集，保留历史 `agent.type` 回退。

# AGENT_ROLE_TIER_AGENT_EMPLOYEE_FIELDS 开发总结

## 背景

- 基于 `docs/plan/AGENT_ROLE_TIER_AGENT_EMPLOYEE_FIELDS_PLAN.md` 执行三阶段落地，目标是将 Agent/Role/Employee 从角色名硬编码治理迁移为 tier 驱动治理。

## 交付结果

### 阶段一：字段与映射落地

- 新增统一 tier 映射与规则能力：`backend/src/shared/role-tier.ts`。
- 为 `agent`、`employee`、`agent_role` 三类核心 Schema 增加 `tier` 字段并接入类型系统。
- 修复一致性问题：
  - `employee.schema` 补齐 `userId` 明确字段定义。
  - 专属助理默认 roleId 统一为 `role-human-exclusive-assistant`。
- 角色 seed 增加 `tier` 写入，保障新环境初始化一致。
- 新增历史数据迁移脚本 `backend/scripts/migrate-role-tier.ts`，并注册 `migrate:role-tier` 命令。

### 阶段二：运行时守卫落地

- 编排执行者选择改为 tier 兼容驱动，减少 roleCode 硬编码依赖。
- 任务改派增加 tier 分派方向守卫，并返回统一拒绝码：
  - `delegation_direction_forbidden`
  - `tier_resolution_required`
- 工具执行授权增加临时工系统工具越权拦截，返回 `TEMPORARY_WORKER_TOOL_VIOLATION`。
- Agents 侧编排改派调用透传 `sourceAgentId`，用于后端守卫校验。

### 阶段三：前端与 API 合同同步

- 前端 Agent/Employee/Role 页面补齐 `tier` 展示与编辑：
  - Agent 管理页新增 tier 徽章与创建/编辑 tier 字段。
  - 员工管理页新增 tier 展示与创建/编辑 tier 字段。
  - 角色管理页新增 tier 列与创建/编辑 tier 字段。
- 前端类型与 service 层补齐 `tier` 字段，保持与后端合同一致。
- API 文档补充 `tier` 字段、默认映射回填、冲突校验及运行时拒绝码说明。

## 主要影响文件

- 后端
  - `backend/src/shared/role-tier.ts`
  - `backend/src/shared/schemas/agent.schema.ts`
  - `backend/src/shared/schemas/employee.schema.ts`
  - `backend/src/shared/schemas/agent-role.schema.ts`
  - `backend/src/modules/roles/roles.service.ts`
  - `backend/src/modules/employees/employee.service.ts`
  - `backend/src/modules/orchestration/orchestration.service.ts`
  - `backend/src/modules/orchestration/services/executor-selection.service.ts`
  - `backend/apps/agents/src/modules/tools/tool.service.ts`
  - `backend/scripts/migrate-role-tier.ts`
- 前端
  - `frontend/src/pages/Agents.tsx`
  - `frontend/src/pages/EmployeeManagement.tsx`
  - `frontend/src/pages/HRManagement.tsx`
  - `frontend/src/services/agentService.ts`
  - `frontend/src/services/employeeService.ts`
  - `frontend/src/services/hrService.ts`
  - `frontend/src/types/index.ts`
- 文档
  - `docs/api/agents-api.md`
  - `docs/api/legacy-api.md`

## 验证结果

- 后端定向 lint 通过。
- 后端定向测试通过：
  - `apps/agents/src/modules/agents/agent.service.spec.ts`
  - `apps/agents/src/modules/tools/tool.service.spec.ts`
- 前端构建通过：`pnpm -C frontend build`。
- 全量 backend `tsc --noEmit` 仍存在仓库既有 TS4053 问题（非本次改动引入）。

## 结论

- 角色治理主链路已由 tier 驱动：字段层、服务层、运行时守卫、前端管理面与 API 文档均已对齐。
- 后续可继续推进冲突仲裁细则（专属助理授权优先级）与更细粒度权限策略收敛。

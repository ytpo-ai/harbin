# Agent Type Schema Removal Plan

## 1. 背景与目标

- 现状：Agent 权限与可见性设计已经迁移到 `roleId -> role.code`，但仍残留 `type` 字段与回退逻辑。
- 问题：`list-agents` 等路径在 `type` 缺失时会回落到默认 profile（`exposed=false`），导致可见性误判。
- 目标：彻底移除 Agent `type` schema 字段与业务逻辑，统一以 role 作为唯一权限/可见性驱动。

## 2. 范围

### 2.1 In Scope

- 删除 `Agent` schema 中的 `type` 属性。
- 清理后端服务中所有 `agent.type` 读取、`agentType` 回退分支。
- 将 MCP profile 查询与 list-agents 过滤统一改为 role code 维度。
- 清理接口与类型中以 `agentType` 为核心的字段命名（保留必要兼容时需明确说明）。

### 2.2 Out of Scope

- 不处理历史 Mongo 文档中的冗余 `type` 存量数据（字段可保留但不再被程序读取）。
- 不引入新的权限模型，仅做既有 role-only 模型收敛。

## 3. 执行步骤

1. 移除 `Agent` schema/类型定义中的 `type` 字段，修复编译类型错误。
2. 重构 `agent.service.ts` 中 profile 解析逻辑，删除按 `type` 查找的回退分支，仅按 `role.code` 解析。
3. 重构 `tool.service.ts` 的 `getAgentsMcpList`，改为按 `roleId -> role.code` 获取 profile 并计算 `exposed`。
4. 清理 `mcp profile` 相关 API 中的 `agentType` 残留命名与参数（统一 role 语义）。
5. 更新相关文档（feature/api）中的字段与调用约束描述，确保与 role-only 一致。
6. 执行后端类型检查/关键链路验证，确认 list-agents 可见性行为符合预期。

## 4. 关键影响点

- 后端：Agent schema、AgentService、ToolService、AgentController。
- API：MCP profile 管理接口参数与返回结构。
- 可见性：`list-agents(includeHidden=false)` 的显示结果。
- 文档：`docs/feature/AGENT_MCP.md`、`docs/api/agents-api.md`。

## 5. 风险与应对

- 风险：外部调用仍使用 `agentType` 路由或参数。
  - 应对：本次按需求直接删除相应逻辑；若有调用方失败，再做单独兼容层。
- 风险：个别角色未配置 profile，导致 fallback 行为变化。
  - 应对：保留 role 维度默认 profile，并在种子同步阶段补齐系统角色 profile。
- 风险：历史分支仍拼接 `agent.type` 做启发式判断。
  - 应对：统一改为 `roleId` / `role.code` / `name` / `description`。

## 6. 验收标准

- `backend/src/shared/schemas/agent.schema.ts` 中不再存在 `type` 字段。
- 后端核心路径中不再读取 `agent.type` 或按 `agentType` 回退 profile。
- `list-agents` 在无 `type` 数据时仍能正确按 role 判定 `exposed`。
- 文档中权限与可见性描述统一为 role-only。

## 7. 二阶段补充（已追加）

- MCP Profile 存储键语义由 `agentType` 收敛为 `roleCode`（代码层字段命名同步）。
- MCP Profile API 路由参数由 `:agentType` 变更为 `:roleCode`。
- 追加历史数据清理方案：提供 Mongo Shell 语句清除 `agents.type` 与 `agentprofiles.agentType`。

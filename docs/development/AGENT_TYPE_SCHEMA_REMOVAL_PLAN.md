# Agent Type Schema Removal Development

## 1. 实现概览

- 已完成 Agent 主数据层的 `type` 字段移除：Schema 与共享类型不再声明 `type`。
- 已完成权限与可见性链路收敛：统一按 `agent.roleId -> role.code -> MCP profile`。
- 已完成 MCP profile 管理接口语义收敛：`/agents/mcp/profiles/:roleCode`。
- 已将 Agent Profile 存储主键语义从 `agentType` 收敛为 `roleCode`（代码层）。

## 2. 关键改动

### 2.1 Schema 与类型

- `backend/src/shared/schemas/agent.schema.ts`
  - 删除 `type` 字段。
- `backend/src/shared/types.ts`
  - 删除 `Agent.type`。
- `frontend/src/types/index.ts`
  - 删除 `Agent.type`。
- `shared/types.d.ts`
  - 删除 `Agent.type`，补齐 `roleId`。
- `backend/src/shared/schemas/agent-profile.schema.ts`
  - `agentType` 字段重命名为 `roleCode`。

### 2.2 业务逻辑

- `backend/apps/agents/src/modules/agents/agent.service.ts`
  - 删除创建/更新流程中的 `type` 处理逻辑。
  - 工具白名单校验仅按 `role.code` 获取 profile。
  - MCP profile 读写查询键切换为 `roleCode`。
  - MCP seed 由“类型键”调整为“角色码键”。
- `backend/apps/agents/src/modules/tools/tool.service.ts`
  - `list-agents` 改为按 `roleId -> role.code` 查 profile 与 `exposed`。
  - `create-agent` MCP 入参移除 `type`。
- `backend/src/modules/meetings/meeting.service.ts`
  - 移除会议隐藏判断中的 `agent.type` 依赖。
- `backend/src/modules/employees/employee.service.ts`
  - 创建专属助理不再传 `type`。

### 2.3 API 与文档

- `backend/apps/agents/src/modules/agents/agent.controller.ts`
  - MCP profile 接口路由参数改为 `:roleCode`。
- `frontend/src/services/agentService.ts`
  - 对应前端 API 客户端参数改为 `roleCode`。
- `docs/api/agents-api.md`
  - 更新 role-only 契约说明与 MCP profile 路由。
- `docs/feature/AGENT_MEMO.md`
  - Identity 模板移除“历史类型”描述。

## 3. 验证结果

- 执行：`pnpm --dir backend exec tsc --noEmit`
- 结果：存在仓库已有 TS4053 报错（控制器导出类型命名问题），本次改动未新增新的 `type/agentType` 编译错误。

## 4. 数据迁移建议

- 代码层已不再依赖 Agent 文档中的 `type` 字段。
- 如需清理历史数据，可对 `agents` 集合执行 `$unset: { type: "" }`。
- 如需同步 profile 集合字段，可将 `agentprofiles.agentType` 迁移到 `roleCode` 后再删除旧字段。

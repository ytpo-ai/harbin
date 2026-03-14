# Agent MCP（Agent 管理 MCP）

## 1. 功能设计

### 1.1 目标

- 为 Agent 管理提供可被智能体调用的 MCP 工具入口。
- 支持 Agent 列表查询与 Agent 创建，减少人工在管理后台重复操作。
- 统一 agent 管理 toolkit 命名为 `agent-master`，收敛命名语义。

### 1.2 核心逻辑

1. `builtin.sys-mg.internal.agent-master.list-agents`：返回当前 Agent 摘要列表（含 `identify`）。
2. `builtin.sys-mg.internal.agent-master.create-agent`：基于 MCP 入参创建 Agent。
3. 创建时 API Key 策略：优先使用显式 `apiKeyId`；否则按 provider 选择默认 key。
4. provider 策略参数默认为 `default`，会回退到模型 provider 查找默认 key。
5. 为兼容历史数据，旧 id `builtin.sys-mg.internal.agent-admin.list-agents` 保留执行兼容。
6. MCP Profile 授权字段统一为 `permissions`，并在工具集更新时自动聚合 `requiredPermissions` 写入 `permissionsDerived`。
7. Agent 在创建/更新（角色或工具变更）时自动继承 role 对应 Profile 的 `permissions` 到 `agent.permissions`（补齐合并，不覆盖已有手工权限）。

### 1.3 状态与约束

- `create-agent` 最小必填：`name`、`roleId`、`model.id`（或 `modelId`）；`roleId` 支持 role id 或 role code。
- role 合法性由 Agent 创建接口校验（role 不存在会返回失败）。
- 若 provider 对应默认 key 不存在，创建流程不阻断，回退系统默认 key 策略。
- Profile 权限采用 `effectivePermissions = permissionsManual ∪ permissionsDerived`。
- 迁移期保留 `capabilities` 双读兼容，写入主路径统一落到 `permissions`。

---

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `AGENT_MASTER_CREATE_AGENT_MCP_PLAN.md` | agent-master toolkit 命名升级与 create-agent MCP 实施计划 |
| `MCP_PROFILE_PERMISSIONS_ALIGNMENT_PLAN.md` | MCP Profile 权限模型统一与继承改造计划 |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| (待补充) | Agent MCP agent-master 与 create-agent 开发总结 |

### API 文档 (docs/api/)

| 文件 | 说明 |
|------|------|
| `api/agents-api.md` | MCP 工具 ID 与 create-agent 参数约定 |

---

## 3. 相关代码文件

### 后端 Tools 模块

| 文件 | 功能 |
|------|------|
| `backend/apps/agents/src/modules/tools/tool.service.ts` | Agent MCP 工具注册、执行分发、默认 API Key 解析 |
| `backend/apps/agents/src/modules/tools/tool.module.ts` | Agent MCP 依赖装配（含 API Key schema 注入） |

### 后端 Agents 模块

| 文件 | 功能 |
|------|------|
| `backend/apps/agents/src/modules/agents/agent.service.ts` | MCP Profile seed 中 Agent 管理工具引用维护 |
| `backend/apps/agents/src/modules/agents/agent-mcp-profile.service.ts` | MCP Profile 读写、权限自动派生、role profile 能力聚合 |
| `backend/src/shared/schemas/agent-profile.schema.ts` | MCP Profile 持久化结构（permissions/manual/derived 兼容字段） |

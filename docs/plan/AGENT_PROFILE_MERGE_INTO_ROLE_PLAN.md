# Plan: 合并 agent_profiles 到 agent_roles

## 背景

当前系统中 `agent_roles`（角色元数据）和 `agent_profiles`（角色工具/权限配置）是两个独立的 MongoDB 集合，通过 `AgentRole.code = AgentProfile.roleCode` 一一对应。两者在字段和能力上高度重叠，且每次获取角色完整信息都需要两次查询，增加了链路复杂度和数据一致性维护成本。

### 核心发现

1. `agent_roles.tools` 种子数据**全为空**，真正的工具绑定数据 100% 在 `agent_profiles.tools`
2. `agent_profiles` 没有独立业务 ID，完全依赖 `roleCode` 关联 `agent_roles`
3. 两者是**严格 1:1** 的关系，不存在 1:N 或 N:N
4. 每次获取角色完整信息需要两次查询（先查 role 再查 profile），可以合并为一次

---

## 目标

- 将 `agent_profiles` 的字段合并到 `agent_roles`，消除独立的 `agent_profiles` 集合
- 简化角色信息查询链路（两次查询 -> 一次查询）
- 统一种子脚本，减少维护成本
- 清理历史遗留的冗余类型定义

---

## 现状：字段对比

### agent_roles Schema

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string (uuid) | 业务主键 |
| `code` | string (unique) | 唯一角色编码 |
| `name` | string | 显示名 |
| `tier` | enum (leadership/operations/temporary) | 角色层级 |
| `description` | string | 描述 |
| `capabilities` | string[] | 角色级能力标签（种子为空） |
| `tools` | string[] | 角色默认工具（种子为空） |
| `promptTemplate` | string | 角色提示模板 |
| `status` | enum (active/inactive) | 状态 |
| `createdAt/updatedAt` | Date | 时间戳 |

### agent_profiles Schema

| 字段 | 类型 | 说明 |
|------|------|------|
| `roleCode` | string (unique) | 关联 AgentRole.code |
| `role` | string | 冗余存储角色名/代码 |
| `tools` | string[] | **实际的工具白名单数据源** |
| `permissions` | string[] | 合并后的完整权限集 |
| `permissionsManual` | string[] | 手动配置权限 |
| `permissionsDerived` | string[] | 从工具自动推导的权限 |
| `capabilities` | string[] | = permissions 的冗余字段 |
| `exposed` | boolean | 是否对 MCP 可见 |
| `description` | string | 描述 |

### 合并后 agent_roles Schema（目标态）

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `id` | string (uuid) | roles | 保留 |
| `code` | string (unique) | roles | 保留 |
| `name` | string | roles | 保留 |
| `tier` | enum | roles | 保留 |
| `description` | string | roles + profiles | 保留，合并 |
| `capabilities` | string[] | roles | 保留（角色级能力标签） |
| `tools` | string[] | **profiles** | 保留，数据从 profiles 迁移过来 |
| `promptTemplate` | string | roles | 保留 |
| `status` | enum | roles | 保留 |
| `permissions` | string[] | profiles | **新增**，合并后的完整权限集 |
| `permissionsManual` | string[] | profiles | **新增**，手动配置权限 |
| `permissionsDerived` | string[] | profiles | **新增**，从工具自动推导的权限 |
| `exposed` | boolean | profiles | **新增**，是否对 MCP 可见 |
| `createdAt/updatedAt` | Date | roles | 保留 |

**移除的冗余字段**：
- `agent_profiles.roleCode` -> 由 `agent_roles.code` 替代
- `agent_profiles.role` -> 冗余，由 `agent_roles.name` / `agent_roles.code` 替代
- `agent_profiles.capabilities` -> 冗余（= permissions），移除

---

## 影响范围

### 需要修改的后端文件

| 文件路径 | 修改内容 |
|----------|----------|
| `backend/apps/agents/src/schemas/agent-profile.schema.ts` | **删除** |
| `backend/apps/agents/src/schemas/agent-role.schema.ts` | 新增 permissions/permissionsManual/permissionsDerived/exposed 字段 |
| `backend/src/shared/schemas/agent-role1.schema.ts` | 同步更新（orchestration 模块副本） |
| `backend/apps/agents/src/modules/agents/agent-mcp-profile.service.ts` | **删除**，逻辑合并到 AgentRoleService |
| `backend/apps/agents/src/modules/agents/agent-role.service.ts` | 合并 profile 相关逻辑，消除两次查询 |
| `backend/apps/agents/src/modules/agents/agent.types.ts` | 移除 AgentMcpMapProfile，更新 AgentToolPermissionSet |
| `backend/apps/agents/src/modules/agents/agent.service.ts` | 移除 AgentProfile model 注入 |
| `backend/apps/agents/src/modules/agents/agent.controller.ts` | 合并 profile API 到 role API |
| `backend/apps/agents/src/modules/agents/agent.module.ts` | 移除 AgentProfile schema 注册 |
| `backend/apps/agents/src/modules/agents/agent-executor.service.ts` | 更新 allowed tools 获取方式 |
| `backend/apps/agents/src/modules/tools/tool.module.ts` | 移除 AgentProfile schema 注册 |
| `backend/apps/agents/src/modules/tools/tool-execution.service.ts` | 改为从 AgentRole 获取权限 |
| `backend/apps/agents/src/modules/tools/builtin/agent-tool-handler.service.ts` | 改为从 AgentRole 获取 profile 信息 |
| `backend/src/modules/orchestration/orchestration.module.ts` | 检查是否需要同步 |
| `backend/src/modules/orchestration/services/executor-selection.service.ts` | 检查是否需要同步 |

### 需要修改的种子/迁移脚本

| 文件路径 | 修改内容 |
|----------|----------|
| `backend/scripts/seed/role.ts` | 合并 mcp-profile.ts 的数据 |
| `backend/scripts/seed/mcp-profile.ts` | **删除**，数据合并到 role.ts |
| `backend/scripts/seed/hr-agent-role-master.ts` | 更新引用 |
| `backend/scripts/seed/seed-runner.ts` | 移除 mcp-profile 种子步骤 |
| **新增** 迁移脚本 | 将现有 agent_profiles 数据 merge 到 agent_roles |

### 需要修改的前端文件

| 文件路径 | 修改内容 |
|----------|----------|
| `frontend/src/services/hrService.ts` | 更新 HRAgentRole 类型（如有必要） |
| `frontend/src/types/index.ts` | 清理历史遗留 AgentRole 接口 |

### 需要清理的历史遗留

| 文件路径 | 说明 |
|----------|------|
| `backend/src/shared/types.ts` (Line 124-139) | 过时的 AgentRole 接口（含 title/department/level/salaryRange） |
| `backend/scripts/migrate/migrate-agent-profile-permissions.ts` | profile 权限迁移脚本，合并后可归档 |
| `backend/scripts/migrate/migrate-schema-collection-governance.ts` | 含 `agentprofiles -> agent_profiles` 迁移逻辑，合并后可归档 |
| `backend/scripts/migrate/cleanup-removed-requirement-tools.ts` | 含 profile 工具清理逻辑，需更新 |

---

## 执行步骤（渐进式 3 阶段）

### Phase 1: Schema 扩展 + 数据迁移 + 双写

**目标**: 在 AgentRole 上新增字段，迁移数据，写入时双写两个集合，读取仍从各自集合。

1. **修改 AgentRole Schema**: 新增 `permissions`, `permissionsManual`, `permissionsDerived`, `exposed` 字段（均设默认值）
2. **同步更新 agent-role1.schema.ts 副本**
3. **编写数据迁移脚本**: 遍历 `agent_profiles`，将每条记录的 tools/permissions/permissionsManual/permissionsDerived/exposed 写入对应 `agent_roles`（by `code = roleCode`）
4. **修改写入逻辑（双写）**: `AgentRoleService` 和 `AgentMcpProfileService` 中所有写操作同时更新两个集合
5. **合并种子脚本**: 将 `mcp-profile.ts` 中的数据合并到 `role.ts`，但暂时保留 `mcp-profile.ts` 的种子执行（双写期兼容）
6. **更新 agent.types.ts**: 新增合并后的类型定义

**验证**: 运行种子脚本，确认两个集合的数据一致

### Phase 2: 读取切换 + Service 合并

**目标**: 所有读取操作切换到 AgentRole，合并 AgentMcpProfileService 到 AgentRoleService。

1. **合并 AgentMcpProfileService 到 AgentRoleService**:
   - `getMcpProfiles` -> 从 agent_roles 查询
   - `getMcpProfile` -> 从 agent_roles 查询
   - `upsertMcpProfile` -> 更新 agent_roles 的对应字段
   - `getToolPermissionSets` -> 直接从 agent_roles 一次查询
   - `upsertToolPermissionSet` -> 更新 agent_roles
   - `buildAgentMcpProfiles` -> 从 agent_roles 构建
   - `derivePermissionsFromTools` -> 保持逻辑不变，移入 AgentRoleService
   - Legacy 工具 ID 别名映射 -> 移入 AgentRoleService
2. **修改 AgentRoleService.getAllowedToolIds**: 消除二次查询，直接从 role 读取 tools
3. **修改 tool-execution.service.ts**: 改为从 AgentRole 获取 permissions
4. **修改 agent-tool-handler.service.ts**: 改为从 AgentRole 获取 exposed/tools 信息
5. **修改 agent.controller.ts**: 
   - `/agents/mcp/profiles` API 保留路径但委托到 AgentRoleService（向后兼容）
   - `/agents/tool-permission-sets` API 委托到 AgentRoleService
6. **修改 agent.module.ts / tool.module.ts**: 移除 AgentProfile model 注册
7. **修改 agent.service.ts**: 移除 AgentProfile model 注入
8. **更新前端类型定义**: 如有必要

**验证**: 
- 运行全量 lint + typecheck
- 手动测试 MCP agent 列表、工具权限集管理、Agent 创建/编辑、工具执行授权等核心链路

### Phase 3: 清理

**目标**: 移除所有 agent_profiles 相关代码和集合。

1. **删除 agent-profile.schema.ts**
2. **删除 agent-mcp-profile.service.ts**
3. **删除 mcp-profile.ts 种子脚本**，更新 seed-runner.ts
4. **编写集合清理迁移脚本**: drop `agent_profiles` 集合（或标记为废弃）
5. **清理历史遗留类型**: `backend/src/shared/types.ts` 中的过时 AgentRole 接口
6. **归档旧迁移脚本**: `migrate-agent-profile-permissions.ts` 等
7. **更新 cleanup-removed-requirement-tools.ts**: 移除 profile 引用

**验证**:
- 运行全量 lint + typecheck + build
- 确认无 `AgentProfile` / `agent_profiles` / `agent-profile` 的残留引用

---

## 风险与缓解

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 影响文件多（~15-20 个） | 中 | 分 3 阶段渐进执行，每阶段独立 PR |
| 数据迁移失败 | 中 | 迁移脚本先做 dry-run，保留原集合不删除 |
| API 不兼容 | 中 | Phase 2 保留 `/agents/mcp/profiles` API 路径，内部委托切换 |
| orchestration 模块副本不同步 | 低 | Phase 1 同步更新 `agent-role1.schema.ts` |
| 前端类型不匹配 | 低 | 前端 `HRAgentRole` 类型按需扩展 |
| 双写期间数据不一致 | 低 | Phase 1 迁移脚本做全量同步，双写逻辑保证一致 |

---

## API 变更说明

### 保留（路径不变，内部切换）

| API | 变更 |
|-----|------|
| `GET /agents/roles` | 返回值新增 permissions/exposed 等字段 |
| `GET /agents/roles/:id` | 返回值新增 permissions/exposed 等字段 |
| `POST /agents/roles` | 入参可选传入 permissions/exposed 等字段 |
| `PUT /agents/roles/:id` | 入参可选传入 permissions/exposed 等字段 |
| `GET /agents/tool-permission-sets` | 内部改为单次查询，返回结构不变 |
| `PUT /agents/tool-permission-sets/:roleCode` | 内部改为更新 agent_roles，返回结构不变 |
| `GET /agents/mcp` | 内部改为单次查询，返回结构不变 |
| `GET /agents/mcp/:id` | 内部改为单次查询，返回结构不变 |

### 兼容保留（Phase 2 后标记 deprecated）

| API | 变更 |
|-----|------|
| `GET /agents/mcp/map` | 标记 deprecated，内部委托到 AgentRoleService |
| `GET /agents/mcp/profiles` | 标记 deprecated，内部委托到 AgentRoleService |
| `GET /agents/mcp/profiles/:roleCode` | 标记 deprecated，内部委托到 AgentRoleService |
| `PUT /agents/mcp/profiles/:roleCode` | 标记 deprecated，内部委托到 AgentRoleService |

---

## 预计工作量

| 阶段 | 工作量 | 说明 |
|------|--------|------|
| Phase 1 | 1-2h | Schema + 迁移脚本 + 双写 |
| Phase 2 | 3-4h | Service 合并 + Controller 调整 + 全链路验证 |
| Phase 3 | 1h | 清理代码 + 归档脚本 |
| **合计** | **5-7h** | 建议分 2-3 个 PR |

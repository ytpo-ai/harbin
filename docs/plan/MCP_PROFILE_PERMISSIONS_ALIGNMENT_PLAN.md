# MCP Profile 权限模型统一与继承改造计划

## 背景

当前 Agent 工具授权链路中存在一组长期易错点：

1. **语义混杂**：`agentprofiles.capabilities` 实际承载了“工具执行权限”语义，但字段名更像“能力标签”，与 `tools.requiredPermissions` 的命名和职责不一致。
2. **配置割裂**：给 Agent 分配工具不等于获得执行该工具所需权限，`tools` 与 `permissions` 需要人工双维护，容易出现“工具已分配但执行被拒绝（missing=...）”。
3. **自动同步缺失**：MCP Profile 在工具更新时不会自动聚合工具的 `requiredPermissions`，导致 profile 的权限集滞后或不完整。
4. **继承链路不清晰**：Agent 在创建/更新时不会稳定继承 role 对应 MCP Profile 的权限，导致运行时授权结果不可预期。

本计划目标：将 MCP Profile 的授权字段统一为 `permissions`，建立“工具变更 -> 权限自动同步 -> Agent 继承”的闭环，降低人工维护成本并提升鉴权可解释性。

---

## 目标

1. 将 MCP Profile 对外主字段由 `capabilities` 统一为 `permissions`。
2. MCP Profile 默认权限自动覆盖“所有已分配工具的 requiredPermissions”。
3. 当 profile 工具发生变更时，权限自动同步更新。
4. Agent 在工具分配/更新时自动继承 MCP Profile `permissions`。
5. 在迁移期兼容旧字段，避免前后端和历史数据一次性中断。

---

## 范围与影响点

- **后端模块**：
  - `backend/apps/agents/src/modules/agents/agent-mcp-profile.service.ts`
  - `backend/apps/agents/src/modules/agents/agent.service.ts`
  - `backend/apps/agents/src/modules/tools/tool.service.ts`
  - 相关 schema/DTO（AgentProfile）
- **接口层**：
  - `GET/PUT /agents/tool-permission-sets/:roleCode`
  - `GET/PUT /agents/mcp/profiles/:roleCode`
- **数据层**：`agentprofiles` 集合（字段迁移与回填）、必要时 `agents.permissions` 补齐。
- **前端层**：MCP 配置页面字段和文案同步（`capabilities -> permissions`）。
- **测试层**：权限推导、继承、鉴权回归。

---

## 实施步骤

1. **字段与契约统一（capabilities -> permissions）**
   - 在 AgentProfile 相关 schema/类型中引入 `permissions` 为主字段。
   - 控制器与服务返回中优先输出 `permissions`。
   - 迁移期保留 `capabilities` 读取兼容（只读兜底），写入落到 `permissions`。

2. **建立权限推导规则（由工具反推权限）**
   - 在 profile 更新入口（`upsertMcpProfile`、`upsertToolPermissionSet`）中，根据 `tools[]` 查询工具定义，聚合 `requiredPermissions[].id`。
   - 计算规则：
     - `derivedPermissions = union(requiredPermissions of selected tools)`
     - `effectivePermissions = union(manualPermissions, derivedPermissions)`
   - 去重、trim、排序，忽略空值。

3. **实现工具变更联动同步**
   - 工具新增：自动补齐新增工具的 required permissions。
   - 工具移除：仅回收派生权限，不误删人工维护权限。
   - 推荐内部结构：
     - `permissionsManual`（手工维护）
     - `permissionsDerived`（系统派生）
     - 对外只暴露合并后的 `permissions`。

4. **Agent 更新时继承 profile 权限**
   - 在 `createAgent` 与 `updateAgent` 的工具/角色更新路径增加继承逻辑：
     - 拉取 role 对应 profile `permissions`
     - 合并入 `agent.permissions`（建议补齐不覆盖：保留已有人工权限）
   - 场景覆盖：
     - 新建 Agent
     - Agent tools 变化
     - Agent role 变化

5. **鉴权链路收敛到 permissions**
   - `authorizeToolExecution` 读取角色与 profile 的授权字段优先走 `permissions`。
   - 保留 `capabilities` 迁移期兜底读取，逐步下线。
   - 增加鉴权日志来源标注（agent/role/profile/manual/derived）。

6. **数据迁移与回填**
   - 编写一次性迁移脚本：
     - `agentprofiles.capabilities -> permissions`
     - 基于 `profile.tools` 重算并补齐 `permissionsDerived`
   - 可选补偿：对现有 agents 做一次按 role/profile 的权限补齐。
   - 发布策略：先双读双写，稳定后清理旧字段。

7. **测试与验收**
   - 单测：
     - profile 工具更新触发 permissions 自动同步
     - Agent 更新继承 profile permissions
     - 工具鉴权通过/拒绝边界
     - 旧数据（仅 capabilities）兼容
   - 验收标准：
     - 分配工具后不再出现同工具 requiredPermissions 缺失
     - 关键工具（如 list-agents）在配置完成后可稳定执行

---

## 开发细节建议

1. **命名与兼容策略**
   - 对外统一 `permissions`，迁移期响应可附带 `capabilities` 镜像（deprecated）。
   - 请求体若传 `capabilities`，服务端映射到 `permissions` 并记录告警日志。

2. **权限来源可解释性**
   - 在运行日志中输出：
     - `requiredPermissions`
     - `grantedByAgent`
     - `grantedByRole`
     - `grantedByProfileManual`
     - `grantedByProfileDerived`
   - 便于线上快速定位“为何缺权/为何放行”。

3. **最小权限原则保持不变**
   - 即使自动同步权限，也仅基于已分配工具反推，不应越权补全与工具无关的权限。
   - 对高危工具（write/admin）可加二次开关或审批标记（可选后续迭代）。

4. **角色映射一致性校验**
   - 增加 roleId 有效性校验与告警，避免因 role 映射断链导致 profile 权限继承失效。

---

## 风险与依赖

- **风险1：字段替换冲击前端/脚本**
  - 通过双读双写与 deprecate 窗口缓解。
- **风险2：权限回收误删人工权限**
  - 通过 manual/derived 拆分防止误删。
- **风险3：历史脏数据 role/profile 关联不一致**
  - 需要迁移前做数据体检与修复。

依赖项：

- 角色主数据与 Agent `roleId` 映射可用。
- 工具注册表中 `requiredPermissions` 完整且语义准确。

---

## 交付物

1. 代码改造（profile/agent/tools 鉴权链路）
2. 数据迁移脚本与回滚说明
3. API 兼容说明（字段迁移）
4. 回归测试用例与验收报告

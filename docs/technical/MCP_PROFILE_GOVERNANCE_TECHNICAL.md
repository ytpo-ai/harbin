# MCP Profile 治理技术设计文档

## 1. 数据与控制模型

### 1.1 两层分离设计

系统采用两层分离的设计模式：

1. **类型级策略**: `MCP Profile.tools` (按 `agentType`)
2. **实例级选择**: `Agent.tools`

### 1.2 治理规则

```
Agent.tools ⊆ MCPProfile.tools(agent.type)
```

即 Agent 实例的工具必须是其所属类型对应的 MCP Profile 工具集合的子集。

---

## 2. 后端强制执行

### 2.1 白名单校验实现

位置：`backend/apps/agents/src/modules/agents/agent.service.ts`

核心方法：`ensureToolsWithinMcpProfileWhitelist(...)`

校验逻辑：
1. 规范化 tool ids
2. 按 `agentType` 加载对应 MCP Profile
3. 检查子集关系
4. 违规时抛出 `BadRequestException` 并列出非法工具

**应用场景**：
- `createAgent(...)` - 创建新 Agent 时校验
- `updateAgent(...)` - 更新 Agent 时校验（含 type 变更场景）

### 2.2 类型变更处理

当 Agent 的 `type` 变更时：
- 自动用新类型的 profile 重新校验工具集合
- 不合法的历史工具在保存时自动过滤

---

## 3. Profile Seed 同步策略

### 3.1 历史问题

旧策略：`$setOnInsert` 仅首次插入，导致历史 profile 不会同步新增工具。

### 3.2 新策略

位置：`ensureMcpProfileSeeds()` 方法

- `$set` 同步稳定字段：`role`、`exposed`、`description`
- `$addToSet` 增量补齐：`tools`、`capabilities`

这样历史 profile 会自动补齐新增的工具，避免“老 profile 不生效”问题。

---

## 4. 前端管理能力

### 4.1 MCP Profile 页面

位置：`frontend/src/pages/Agents.tsx`

- 独立 Tab：`MCP Profile 管理`
- 列表展示 + 编辑弹窗
- 可编辑字段：`role`、`tools`、`capabilities`、`exposed`、`description`

### 4.2 API 封装

位置：`frontend/src/services/agentService.ts`

- `getMcpProfiles()` - 获取所有 profile
- `getMcpProfile(agentType)` - 获取单个 profile
- `upsertMcpProfile(agentType, updates)` - 创建/更新 profile

### 4.3 Agent 工具选择联动

前端 Agent 编辑页：
- 工具选项仅展示当前 `agentType` 对应 profile 的工具
- 切换类型时自动清理不合法已选工具
- 历史非法工具显示警告提示，保存时自动过滤

---

## 5. API 契约

### 5.1 Profile 相关接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/agents/mcp/profiles` | 获取所有 Profile |
| GET | `/agents/mcp/profiles/:agentType` | 获取单个 Profile |
| PUT | `/agents/mcp/profiles/:agentType` | 创建/更新 Profile |

### 5.2 校验规则

Agent 创建/更新时：
- 提交的 tools 必须是对应 profile tools 的子集
- 违规返回 `400 Bad Request`，包含具体非法工具列表

---

## 6. 失败模式与处理

| 场景 | 处理方式 |
|------|----------|
| Profile 存在但缺少工具 | 由 seed 同步策略自动补齐 |
| UI 展示不在白名单的工具 | 前端过滤 + 后端硬校验双重保护 |
| 绕过前端直接调用 API | 后端子集校验拦截 |

---

## 7. 相关文档索引

- 计划主文档：`docs/plan/MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md`
- 开发沉淀：`docs/development/MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md`
- API 文档：`docs/api/agents-api.md`

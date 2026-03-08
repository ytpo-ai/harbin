# 工具分类优化方案：Provider 与 ExecutionChannel 重构

> 目标：将工具分类从 `provider: internal/composio/mcp` 调整为 `provider: composio/builtin` + `executionChannel: mcp/internal`

## 1. 背景与问题

### 1.1 当前问题

当前工具使用三段式前缀命名（如 `mcp.model.list`、`internal.memo.search`），通过前缀自动推导 `provider`，但存在以下问题：

1. **provider 语义混乱**：`internal` 和 `mcp` 都可能表示“本地实现”，但含义不清晰
2. **缺乏调用路径区分**：无法直接看出工具是“走 MCP 协议调用外部服务”还是“本服务直接处理”
3. **分组不直观**：toolkitId 按 `provider.namespace` 生成，`mcp.*` 和 `internal.*` 分到不同组，但实际调用路径可能相同

### 1.2 优化目标

| 维度 | 当前值 | 目标值 |
|------|--------|--------|
| provider | `internal` / `composio` / `mcp` | `composio` / `builtin` |
| 新增维度 | - | `executionChannel`: `mcp` / `internal` |

**语义定义**：

- **provider**：工具来源/所属平台
  - `composio`：外部集成（Slack、Gmail、GitHub 等）
  - `builtin`：内置能力（本服务实现）
- **executionChannel**：工具执行时所走的调用链路
  - `mcp`：通过 MCP 协议调用外部服务或 MCP Server
  - `internal`：本服务直接处理，不走 MCP

---

## 2. 迁移映射表

### 2.1 现有工具映射

| 当前 toolId | 当前 provider | 当前 namespace | 目标 provider | 目标 executionChannel | 目标 namespace |
|-------------|---------------|----------------|----------------|------------------------|----------------|
| `composio.slack.*` | composio | slack | composio | mcp | slack |
| `composio.gmail.*` | composio | gmail | composio | mcp | gmail |
| `internal.web.*` | internal | web | builtin | internal | web |
| `internal.content.*` | internal | content | builtin | internal | content |
| `internal.repo.*` | internal | repo | builtin | internal | repo |
| `internal.agents.*` | internal | agents | builtin | internal | agents |
| `internal.memo.*` | internal | memo | builtin | internal | memo |
| `internal.docs.*` | internal | docs | builtin | internal | docs |
| `internal.updates.*` | internal | updates | builtin | internal | updates |
| `mcp.docs.*` | mcp | docs | builtin | mcp | docs |
| `mcp.updates.*` | mcp | updates | builtin | mcp | updates |
| `mcp.model.*` | mcp | model | builtin | mcp | model |
| `mcp.orchestration.*` | mcp | orchestration | builtin | mcp | orchestration |
| `mcp.humanOperationLog.*` | mcp | humanOperationLog | builtin | mcp | humanOperationLog |

### 2.2 规则总结

- `composio.*` → `provider=composio`, `executionChannel=mcp`
- 原 `internal.*` → `provider=builtin`, `executionChannel=internal`
- 原 `mcp.*` → `provider=builtin`, `executionChannel=mcp`

---

## 3. 实施步骤

### 3.1 数据模型改造

- [ ] **Schema 字段新增**：在 `Tool` 和 `Toolkit` 中新增 `executionChannel` 字段
- [ ] **Toolkit.authStrategy 逻辑调整**：根据新 provider 推导

**涉及文件**：
- `backend/src/shared/schemas/tool.schema.ts`
- `backend/src/shared/schemas/toolkit.schema.ts`

### 3.2 ToolService 推导逻辑改造

- [ ] **移除 `inferProviderFromToolId` 对 mcp 的识别**
- [ ] **新增 `inferExecutionChannel` 方法**：根据 toolId 前缀判断
- [ ] **改造 toolkitId 生成逻辑**：`provider.namespace` 保持不变，但需兼容新的 executionChannel

**涉及文件**：
- `backend/apps/agents/src/modules/tools/tool.service.ts`

### 3.3 执行链路标记

- [ ] **ToolExecution 记录 executionChannel**：在工具执行时写入
- [ ] **历史查询兼容**：stats/history 返回兼容旧字段或新增字段

**涉及文件**：
- `backend/src/shared/schemas/toolExecution.schema.ts`
- `backend/apps/agents/src/modules/tools/tool.service.ts`

### 3.4 API 兼容层

- [ ] **GET /tools、/tools/registry**：返回 `provider` + `executionChannel`，兼容旧 `provider` 字段（或标记为 deprecated）
- [ ] **GET /tools/toolkits**：toolkit 视图返回新字段
- [ ] **前端筛选升级**：支持按 `executionChannel` 筛

**涉及文件**：
- `backend/apps/agents/src/modules/tools/tool.controller.ts`
- `frontend/src/services/toolService.ts`（如有）

### 3.5 数据迁移

- [ ] **一次性迁移脚本**：将现有工具的 `provider` 从 `mcp` 改为 `builtin`，新增 `executionChannel` 字段
- [ ] **回滚方案**：保留旧字段快照，支持快速回滚

### 3.6 文档与测试

- [ ] **API 文档更新**：`docs/api/agents-api.md`
- [ ] **功能文档更新**：`docs/features/AGENT_TOOL.md`
- [ ] **回归测试**：registry 查询、filter 筛选、执行链路、stats 聚合

---

## 4. 影响范围

| 模块 | 影响点 | 风险等级 |
|------|--------|----------|
| 后端 Schema | 新增字段，需 DB 迁移 | 中 |
| ToolService | 推导逻辑改动，影响所有工具注册 | 高 |
| API 返回 | 字段命名变化，需兼容 | 中 |
| 前端筛选 | 筛选项变化，需同步 UI | 低 |
| 历史数据 | 需一次性迁移 | 中 |

---

## 5. 验收标准

- [ ] 所有工具可通过 `provider` + `executionChannel` 唯一定位
- [ ] `GET /tools/registry` 支持双维度筛选
- [ ] 工具执行记录包含 `executionChannel` 标记
- [ ] API 兼容旧调用方（至少一个版本周期内）
- [ ] 前端筛选项同步更新

---

## 6. 时间估计

| 阶段 | 预估------|----------|
| 模型工时 |
|改造 + 推导逻辑 | 2h |
| 执行链路标记 + 迁移 | 1h |
| API 兼容 + 前端适配 | 1.5h |
| 测试 + 文档 | 1h |
| **总计** | **5.5h** |

---

## 7. 相关文档

- 工具统一架构设计：`docs/technical/TOOLING_UNIFICATION_ARCHITECTURE_DESIGN.md`
- 工具迁移清单：`docs/plan/TOOLING_UNIFICATION_TOOL_MIGRATION_CHECKLIST.md`
- API 文档：`docs/api/agents-api.md`

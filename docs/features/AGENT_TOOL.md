# Agent Tool（工具管理与执行）

## 1. 功能设计

### 1.1 目标

- 为 Agent 提供统一的工具发现、执行、审计能力。
- 支持外部工具源（如 Composio）与系统内建工具（如 memo/skill）并存。
- 在不破坏历史调用的前提下，推进工具元模型统一与治理收敛。

### 1.2 数据结构

当前核心数据结构位于 `backend/src/shared/schemas/`：

| 集合 | Schema 文件 | 说明 |
|------|-------------|------|
| `toolkits` | `toolkit.schema.ts` | 工具包实体（provider/namespace/auth/status/version） |
| `tools` | `tool.schema.ts` | 工具定义（id/name/description/type/schema 等） |
| `tool_executions` | `toolExecution.schema.ts` | 工具执行记录（入参、结果、状态、耗时） |

目标演进（详见技术设计文档）：

- `Toolkit`（管理边界）
- `Tool`（统一执行单元）
- `Adapter`（外部/内部工具协议转换）

### 1.3 核心逻辑

1. 工具发现：通过 `/tools` 提供工具列表，供 Agent 与管理端选择。
2. 工具执行：通过 `POST /tools/:id/execute` 触发工具调用，写入执行日志。
3. 统一发现：通过 `/tools/registry` 输出统一 `Tool` 视图，并支持按 provider/namespace 过滤。
4. 兼容映射：通过 `/tools/registry/mappings` 维护 legacy 与 unified tool id 映射。
5. Provider 接入：Composio 通过 `composio.service.ts` 对接第三方工具。
6. 治理约束：结合 Agent/MCP Profile 白名单控制工具可见性与可执行性。
7. 演进方向：对外统一为原子 `Tool`，对内保留 `Toolkit` 管理能力。

---

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `TOOLING_UNIFICATION_ARCHITECTURE_PLAN.md` | 工具系统统一化详细实施计划 |
| `TOOLING_UNIFICATION_TOOL_MIGRATION_CHECKLIST.md` | 工具存量迁移映射与下线清单 |
| `MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md` | MCP Profile 治理与工具白名单计划 |
| `AGENT_TOOL_MANAGEMENT_UI_OPTIMIZATION_PLAN.md` | 工具管理页与调用日志 Tab 展示优化计划 |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| `TOOLING_UNIFICATION_ARCHITECTURE_PLAN.md` | 工具系统统一化架构改造开发总结 |
| `AGENTS_TOOLS_MIGRATION_PLAN.md` | agents/tools 模块迁移与边界收敛总结 |
| `MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md` | 工具白名单治理开发沉淀 |

### 技术文档 (docs/technical/, docs/api/)

| 文件 | 说明 |
|------|------|
| `technical/TOOLING_UNIFICATION_ARCHITECTURE_DESIGN.md` | 工具系统统一化技术设计 |
| `technical/MCP_PROFILE_GOVERNANCE_TECHNICAL.md` | Agent 工具白名单治理技术设计 |
| `api/agents-api.md` | Tools/Agent/MCP 相关接口清单 |

---

## 3. 相关代码文件

### 后端 Tools 模块 (backend/apps/agents/src/modules/tools/)

| 文件 | 功能 |
|------|------|
| `tool.module.ts` | Tools 模块装配与依赖注入 |
| `tool.controller.ts` | 工具列表、执行、执行统计接口 |
| `tool.service.ts` | 工具注册、执行编排、结果封装 |
| `composio.service.ts` | Composio 工具包接入与调用封装 |
| `gh-repo-docs-reader-mcp.util.ts` | 文档检索类工具实现 |
| `gh-repo-updates-mcp.util.ts` | 更新摘要类工具实现 |

### 共享 Schema (backend/src/shared/schemas/)

| 文件 | 功能 |
|------|------|
| `tool.schema.ts` | 工具定义模型 |
| `toolExecution.schema.ts` | 工具执行记录模型 |

### 集成调用

| 文件 | 功能 |
|------|------|
| `backend/apps/agents/src/modules/agents/agent.service.ts` | Agent 运行链路中的工具可用集与调用协同 |
| `backend/apps/gateway/src/gateway-proxy.service.ts` | `/api/tools/**` 网关分流与日志透传 |

### 前端 Tools 页面 (frontend/src/)

| 文件 | 功能 |
|------|------|
| `pages/Tools.tsx` | 工具管理页（工具/调用日志 Tab、工具展示、执行日志展示、手动执行入口） |
| `services/toolService.ts` | 工具注册表、执行历史、执行统计、工具执行接口封装 |

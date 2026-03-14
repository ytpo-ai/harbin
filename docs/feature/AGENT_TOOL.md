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
   - 运行时工具事件日志统一记录 `toolName/toolId/params`，用于系统进程日志与任务 Agent 日志对齐观测。
3. 统一发现：通过 `/tools/registry` 输出统一 `Tool` 视图，并支持按 provider/namespace 过滤。
4. 兼容映射：通过 `/tools/registry/mappings` 维护 legacy 与 unified tool id 映射。
5. 工具管理：前端通过右侧抽屉统一承载“执行/修改”Tab；修改页支持编辑（名称/描述/分类/状态/启用开关/prompt）并提供弃用入口（标记 `status=deprecated` 且 `enabled=false`）。`/tools/registry` 返回 `prompt` 字段，工具列表“有提示词/无提示词”与修改页回填均基于统一字段。
6. Provider 接入：搜索工具拆分为显式 Exa 与显式 Composio SERP 两类（`web-tools.service.ts` + `exa.service.ts` + `composio.service.ts`），并通过 canonical id 统一治理。
7. 编排工具：Orchestration MCP 已覆盖 create/update/run/get/list/reassign/complete-human、schedule create/update 及 task debug 操作。
8. Skill 工具：新增 `skill-master` toolkit，提供 `list-skills`（支持 title 模糊检索）与 `create-skill`（创建 skill）能力。
9. Agents MCP：`agent-master` toolkit 提供 `builtin.sys-mg.internal.agent-master.list-agents`（列表）与 `builtin.sys-mg.internal.agent-master.create-agent`（创建）能力；列表返回 `identify`（来自 `identity` memo 首条内容，缺失时为空字符串），并不再返回 `roleId/type`。
10. RD 文档工具：`builtin.sys-mg.internal.rd-related.docs-write` 支持在 `docs/**` 下写入 `.md` 文档（`create/update/append`），并内置路径穿越与后缀白名单防护。
11. 治理约束：结合 Agent/MCP Profile 白名单控制工具可见性与可执行性。
12. 工具级 Prompt：`tools` 支持 `prompt` 字段，Agent 运行时会按已授权工具自动注入对应 system 提示，不再依赖角色硬编码。
13. 演进方向：对外统一为原子 `Tool`，对内保留 `Toolkit` 管理能力。
14. 需求管理 MCP：新增 `requirement` toolkit（list/get/create/update-status/assign/comment/sync-github/board），统一代理 EI 需求 API。
15. 编排上下文分级：Orchestration MCP 新增 `meeting/autonomous` 双上下文断言，允许 CTO 在非会议场景发起编排治理。

---

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `TOOLING_UNIFICATION_ARCHITECTURE_PLAN.md` | 工具系统统一化详细实施计划 |
| `TOOLING_UNIFICATION_TOOL_MIGRATION_CHECKLIST.md` | 工具存量迁移映射与下线清单 |
| `MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md` | MCP Profile 治理与工具白名单计划 |
| `AGENT_TOOL_MANAGEMENT_UI_OPTIMIZATION_PLAN.md` | 工具管理页与调用日志 Tab 展示优化计划 |
| `TOOL_ID_NAMESPACE_FORMAT_OPTIMIZATION_PLAN.md` | Tool ID 命名层级与 namespace 优化计划 |
| `RD_RELATED_DOCS_WRITE_MCP_PLAN.md` | RD 文档写入 MCP（docs-write）接入计划 |
| `CTO_AGENT_DAILY_DEV_WORKFLOW_PLAN.md` | CTO 日常研发工作流改造计划 |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| `TOOLING_UNIFICATION_ARCHITECTURE_PLAN.md` | 工具系统统一化架构改造开发总结 |
| `AGENTS_TOOLS_MIGRATION_PLAN.md` | agents/tools 模块迁移与边界收敛总结 |
| `MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md` | 工具白名单治理开发沉淀 |
| `TOOL_PROMPT_INJECTION_PLAN.md` | 工具级 prompt 注入与历史数据回填总结 |
| `CTO_AGENT_DAILY_DEV_WORKFLOW_PLAN.md` | CTO 日常研发工作流改造开发沉淀 |

### 技术文档 (docs/technical/, docs/api/)

| 文件 | 说明 |
|------|------|
| `technical/TOOLING_UNIFICATION_ARCHITECTURE_DESIGN.md` | 工具系统统一化技术设计 |
| `technical/MCP_PROFILE_GOVERNANCE_TECHNICAL.md` | Agent 工具白名单治理技术设计 |
| `technical/TOOL_ID_NAMESPACE_FORMAT_OPTIMIZATION_DESIGN.md` | Tool ID 五段式命名与 namespace 分类设计 |
| `api/agents-api.md` | Tools/Agent/MCP 相关接口清单 |

---

## 3. 相关代码文件

### 后端 Tools 模块 (backend/apps/agents/src/modules/tools/)

| 文件 | 功能 |
|------|------|
| `tool.module.ts` | Tools 模块装配与依赖注入 |
| `tool.controller.ts` | 工具列表、执行、执行统计接口 |
| `tool.service.ts` | 工具注册、执行编排、结果封装（含统一分发） |
| `web-tools.service.ts` | Web Search/Web Fetch/Content Extract 内置工具实现 |
| `exa.service.ts` | Exa 搜索接入（默认 web search provider） |
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
| `pages/Tools.tsx` | 工具管理页（工具/调用日志/工具权限集管理 Tab、按 provider/namespace/toolkit 筛选、工具模糊搜索、列表仅保留编辑入口、右侧抽屉执行/修改 Tab、修改内置弃用、列表精简字段、提示词标识、ID快捷复制、执行日志展示） |
| `services/toolService.ts` | 工具注册表、更新/弃用、执行历史、执行统计、工具执行接口封装 |

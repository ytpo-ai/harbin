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
| `agent_toolkits` | `toolkit.schema.ts` | 工具包实体（provider/namespace/auth/status/version） |
| `agent_tools` | `tool.schema.ts` | 工具定义（id/name/description/type/schema 等） |
| `agent_tool_executions` | `tool-execution.schema.ts` | 工具执行记录（入参、结果、状态、耗时） |

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
7. 编排工具：Orchestration MCP 当前覆盖 create/update/run/get/list、submit-task、report-task-run-result 操作。
8. Skill 工具：新增 `skill-master` toolkit，提供 `list-skills`（支持 title 模糊检索）与 `create-skill`（创建 skill）能力。
9. Agents MCP：`agent-master` toolkit 提供 `builtin.sys-mg.internal.agent-master.list-agents`（列表）与 `builtin.sys-mg.internal.agent-master.create-agent`（创建）能力；列表返回 `identify`（来自 `identity` memo 首条内容，缺失时为空字符串），并不再返回 `roleId/type`。`list-agents` 支持可选 `agentId` 精确查询，且返回 `runtimeStatus`（Redis task tool 级状态快照）。
10. Agent Role MCP：新增 `agent-role-master` toolkit，提供 `builtin.sys-mg.internal.agent-role-master.list-roles/create-role/update-role/delete-role` 能力，支持受控角色主数据管理。
11. RD 文档工具：`builtin.sys-mg.internal.rd-related.docs-write` 支持在 `docs/**` 下写入 `.md` 文档（`create/update/append`），并内置路径穿越与后缀白名单防护。
12. 治理约束：结合 Agent/MCP Profile 白名单控制工具可见性与可执行性。
13. 工具级 Prompt：`tools` 支持 `prompt` 字段，Agent 运行时会按已授权工具自动注入对应 system 提示，不再依赖角色硬编码。
14. 演进方向：对外统一为原子 `Tool`，对内保留 `Toolkit` 管理能力。
15. 需求管理 MCP：`requirement` toolkit 当前为（list/get/create/update-status/update/sync-github）；其中看板并入 `list(view=board)`，分配与评论并入 `update(action=assign|comment)`，统一代理 EI 需求 API。
16. 编排上下文分级：Orchestration MCP 新增 `meeting/autonomous` 双上下文断言，允许 CTO 在非会议场景发起编排治理。
17. 工具分发架构：`ToolService` 逐步转为编排层，具体域逻辑拆分至 `InternalApiClient`、`ToolGovernanceService` 及多类 handler（orchestration/requirement/repo/model/skill/audit/meeting）。
18. 内置工具目录治理：`builtin-tool-catalog.ts` 承载内置工具清单，`builtin-tool-definitions.ts` 承载常量与清理列表，减少 `tool.service.ts` 静态数据耦合。
19. 鉴权升级：新增 Agent Credential + JWT token exchange，`POST /tools/:id/execute` 在 `hybrid/jwt-strict` 模式下支持 Bearer token 并在执行入口统一执行 scope/白名单/requiredPermissions 校验。
20. 内部消息工具：新增 `builtin.sys-mg.mcp.inner-message.send-internal-message`，Agent 可直连 legacy `/inner-messages/direct` 发内部消息，并返回 `messageId/status/sentAt` 作为发送回执。
21. 手动 seed 支持 `--mode=append|sync`：`append` 仅追加新内置工具/新 profile，并对已存在 profile 仅追加 `tools`；默认 `sync` 保持全量对齐行为。
22. 会议分配执行提示：`requirement.update-status / requirement.update(action=assign) / send-internal-message` 增加闭环执行 prompt（一次确认即执行、先分配后通知、三段式回执、默认短版通知）。
23. 工具参数契约按需注入：运行时默认仅注入工具目录（id/name/description）；当出现参数错误时，仅对当前失败工具回填 `inputSchema` 做修正重试，避免把全部工具 schema 常驻到上下文。
24. RD 仓库写入工具：新增 `builtin.sys-mg.internal.rd-related.repo-writer`，支持 `git-clone` 到 `data/repos/**`，并内置 HTTPS 协议限制与目录沙箱防护。
25. Prompt Registry 写入工具：新增 `builtin.sys-mg.mcp.prompt-registry.save-template`，支持单条/批量保存 PromptTemplate，按 `scene+role` 自动递增版本并可选自动发布；`category` 必须为 `system/recruitment`，且 `recruitment` 类强制 `role=<domain>:<persona-role>`。
26. Prompt Registry 读取工具：新增 `builtin.sys-mg.mcp.prompt-registry.list-templates`（摘要列表，不含 content）与 `builtin.sys-mg.mcp.prompt-registry.get-template`（按 `scene+role` 或 `templateId` 获取完整内容），支持 Agent 在绑定前先检索后读取。

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
| `PROMPT_IMPORT_REPO_WRITER_TOOL_PLAN.md` | Prompt 批量导入与 repo-writer/save-template 工具接入计划 |
| `CTO_AGENT_DAILY_DEV_WORKFLOW_PLAN.md` | CTO 日常研发工作流改造计划 |
| `AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_A_SECURITY_AUTH_HOTFIX.md` | 工具鉴权热修与 JWT 凭证化升级计划 |
| `TOOL_SERVICE_SPLIT_BUILTIN_UNIFICATION_PLAN.md` | ToolService 拆分与 builtin 目录统一改造计划 |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| `TOOLING_UNIFICATION_ARCHITECTURE_PLAN.md` | 工具系统统一化架构改造开发总结 |
| `AGENTS_TOOLS_MIGRATION_PLAN.md` | agents/tools 模块迁移与边界收敛总结 |
| `MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md` | 工具白名单治理开发沉淀 |
| `TOOL_PROMPT_INJECTION_PLAN.md` | 工具级 prompt 注入与历史数据回填总结 |
| `CTO_AGENT_DAILY_DEV_WORKFLOW_PLAN.md` | CTO 日常研发工作流改造开发沉淀 |
| `AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_C_AGENTS_REFACTOR_PHASE1.md` | Agents/Tools 一期拆分（InternalApiClient + ToolGovernanceService）开发沉淀 |
| `ORCHESTRATION_UNUSED_MCP_TOOL_CLEANUP_2026-03-29.md` | Orchestration 无用 MCP 工具下线与 seed 对齐总结 |

### 技术文档 (docs/technical/, docs/api/)

| 文件 | 说明 |
|------|------|
| `technical/TOOLING_UNIFICATION_ARCHITECTURE_DESIGN.md` | 工具系统统一化技术设计 |
| `technical/MCP_PROFILE_GOVERNANCE_TECHNICAL.md` | Agent 工具白名单治理技术设计 |
| `technical/TOOL_ID_NAMESPACE_FORMAT_OPTIMIZATION_DESIGN.md` | Tool ID 五段式命名与 namespace 分类设计 |
| `technical/AGENT_TOOL_AUTH_JWT_CREDENTIAL_TECHNICAL_DESIGN.md` | Agent 凭证换 token + JWT 工具鉴权升级设计 |
| `technical/TOOL_SERVICE_SPLIT_BUILTIN_UNIFICATION_DESIGN.md` | ToolService 拆分（Facade+Registry+Execution+Dispatcher）技术设计 |
| `api/agents-api.md` | Tools/Agent/MCP 相关接口清单 |

---

## 3. 相关代码文件

### 后端 Tools 模块 (backend/apps/agents/src/modules/tools/)

| 文件 | 功能 |
|------|------|
| `tool.module.ts` | Tools 模块装配与依赖注入 |
| `tool.controller.ts` | 工具列表、执行、执行统计接口 |
| `tool.service.ts` | Facade：保持外部 API 不变，内部委托 registry/execution |
| `tool-registry.service.ts` | Tool/Toolkit 种子、CRUD、查询、路由、执行历史聚合 |
| `tool-execution.service.ts` | 执行引擎（鉴权、输入校验、重试、结果归一化） |
| `tool-execution-dispatcher.service.ts` | 分发路由：tool id 到 builtin handler 的映射 |
| `tool-identity.util.ts` | Tool Identity 解析与 metadata 构建纯函数 |
| `internal-api-client.service.ts` | 内部 HTTP 调用封装（签名头、超时、错误摘要） |
| `tool-governance.service.ts` | 工具治理策略（限流/熔断/超时/重试/幂等） |
| `builtin-tool-catalog.ts` | 内置工具清单与实现 ID 目录 |
| `builtin-tool-definitions.ts` | Tool 常量、虚拟/废弃工具 ID 列表 |
| `builtin/index.ts` | builtin handlers barrel export |
| `builtin/orchestration-tool-handler.service.ts` | 编排类工具处理器 |
| `builtin/requirement-tool-handler.service.ts` | 需求类工具处理器 |
| `builtin/repo-tool-handler.service.ts` | 仓库读取与文档写入处理器 |
| `builtin/model-tool-handler.service.ts` | 模型管理类工具处理器 |
| `builtin/skill-tool-handler.service.ts` | Skill 类工具处理器 |
| `builtin/audit-tool-handler.service.ts` | 人工操作审计工具处理器 |
| `builtin/meeting-tool-handler.service.ts` | 会议类工具处理器 |
| `builtin/prompt-registry-tool-handler.service.ts` | Prompt 模板读写处理器 |
| `builtin/web-tools.service.ts` | Web Search/Web Fetch/Content Extract 内置工具实现 |
| `builtin/agent-master-tool-handler.service.ts` | Agent MCP（list/create）处理器 |
| `builtin/agent-role-tool-handler.service.ts` | Agent Role MCP（list/create/update/delete）处理器 |
| `builtin/memo-tool-handler.service.ts` | Memo MCP（search/append）处理器 |
| `builtin/communication-tool-handler.service.ts` | 通讯工具（Slack/Gmail/Inner Message）处理器 |
| `builtin/rd-intelligence-tool-handler.service.ts` | 研发智能快照工具处理器 |
| `exa.service.ts` | Exa 搜索接入（默认 web search provider） |
| `composio.service.ts` | Composio 工具包接入与调用封装 |
| `gh-repo-docs-reader-mcp.util.ts` | 文档检索类工具实现 |
| `gh-repo-updates-mcp.util.ts` | 更新摘要类工具实现 |

### Agents Schema (backend/apps/agents/src/schemas/)

| 文件 | 功能 |
|------|------|
| `tool.schema.ts` | 工具定义模型 |
| `tool-execution.schema.ts` | 工具执行记录模型 |

### 集成调用

| 文件 | 功能 |
|------|------|
| `backend/apps/agents/src/modules/agents/agent.service.ts` | Agent 运行链路中的工具可用集与调用协同 |
| `backend/apps/gateway/src/gateway-proxy.service.ts` | `/api/tools/**` 网关分流与日志透传 |
| `backend/src/modules/agents-client/agent-client.service.ts` | legacy 后端访问 agents 服务时的工具执行历史查询（`getToolExecutions`） |

### 前端 Tools 页面 (frontend/src/)

| 文件 | 功能 |
|------|------|
| `pages/Tools.tsx` | 工具管理页（工具/调用日志/工具权限集管理 Tab、按 provider/namespace/toolkit 筛选、工具模糊搜索、列表仅保留编辑入口、右侧抽屉执行/修改 Tab、修改内置弃用、列表精简字段、提示词标识、ID快捷复制、执行日志展示） |
| `services/toolService.ts` | 工具注册表、更新/弃用、执行历史、执行统计、工具执行接口封装 |

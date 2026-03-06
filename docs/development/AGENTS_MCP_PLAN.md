# Agents MCP 开发总结

## 本次目标

- 实现 agents 的 MCP 查询能力。
- 通过 agents map 暴露系统内 agent 的角色、工具集、能力集。
- 支持“仅部分 agent 可见”的安全过滤策略。

## 实现内容

### 1) 计划与文档落盘

- 已按流程先落盘计划文档：`docs/plan/AGENTS_MCP_PLAN.md`。

### 2) 建立 agents map（MCP 元信息）

- 新增文件：`backend/src/modules/agents/agent-mcp.map.ts`
- 定义 `AgentMapProfile`：
  - `role`
  - `tools`
  - `capabilities`
  - `exposed`
  - `description`
- 对现有常见 agent type（如 `ai-executive`、`ai-technical` 等）配置默认映射。
- 提供 `DEFAULT_AGENT_MAP_PROFILE`，未知 type 默认不暴露。

### 3) MCP 服务能力实现

- 在 agent service 中新增 MCP 相关方法：
  - `getAgentsMcpMap()`
  - `getMcpAgents({ includeHidden })`
  - `getMcpAgent(agentId, { includeHidden })`
- 能力要点：
  - 将数据库 agent 与 agents map 合并，统一生成 MCP 结构。
  - 输出标准字段：`role`、`capabilitySet`、`toolSet`、`exposed`、`mapKey`。
  - 默认仅返回 `exposed=true`，`includeHidden=true` 时可查看隐藏项。
  - 对未暴露单体详情请求返回 `NotFoundException`，避免泄露。

涉及文件：
- `backend/src/modules/agents/agent.service.ts`
- `backend/apps/agents/src/modules/agents/agent.service.ts`

### 4) MCP API 路由扩展

- 在 agents controller 新增接口：
  - `GET /agents/mcp/map`
  - `GET /agents/mcp`
  - `GET /agents/mcp/:id`
- 支持 query 参数 `includeHidden=true|false`。

涉及文件：
- `backend/src/modules/agents/agent.controller.ts`
- `backend/apps/agents/src/modules/agents/agent.controller.ts`

### 5) 文档更新

- 已更新 API 文档：`docs/api/API.md`
- 已更新 README 的 Agent API 列表：`README.md`

## 测试与验证

- 构建验证通过：
  - `npm run build:agents`
  - `npm run build`
- 新增 MCP 单测文件：`backend/src/modules/agents/agent.service.spec.ts`
- 现状说明：仓库当前 Jest 对 TypeScript 测试文件缺少 transform 配置，导致该 spec 暂无法直接执行；不影响本次功能编译与接口可用性。

## 安全与兼容策略

- 默认不暴露未知类型 agent。
- 默认不返回隐藏 agent（需显式 `includeHidden=true`）。
- 单体查询隐藏 agent 时返回 404 风格异常，减少内部信息暴露。

## 后续建议

1. 将 `AGENTS_MAP` 配置化（环境变量/数据库）以支持运行时调整。
2. 为 MCP 接口补充鉴权策略（如仅内部服务或特定角色可见）。
3. 补充 Jest TS 配置后启用并纳入 CI。

## 增补实现（CEO/CTO 对话实时查询 agents）

### 目标

- 当用户与 CEO/CTO 对话并询问“系统里有哪些 agents”时，Agent 能基于实时数据回答，而非静态记忆。

### 具体改动

1. 新增内置工具 `agents_mcp_list`
   - 注册位置：
     - `backend/src/modules/tools/tool.service.ts`
     - `backend/apps/agents/src/modules/tools/tool.service.ts`
   - 功能：读取 agent 列表并按 MCP 暴露规则返回 `id/name/type/role/capabilitySet`。

2. 工具模块增加 Agent Schema 注入
   - 使工具服务可直接读取 agent 数据：
     - `backend/src/modules/tools/tool.module.ts`
     - `backend/apps/agents/src/modules/tools/tool.module.ts`

3. CEO/CTO 默认可用该工具
   - 在 map 中为 `ai-executive`、`ai-technical` 增加 `agents_mcp_list`：
     - `backend/src/modules/agents/agent-mcp.map.ts`
   - 运行时工具白名单由 `agent.tools + map.tools` 合并，兼容历史数据。

4. 对话行为约束
   - 当可用工具包含 `agents_mcp_list` 时，追加系统提示：
     - 询问 agent 列表时优先调用该工具。
   - 实现位置：
     - `backend/src/modules/agents/agent.service.ts`
     - `backend/apps/agents/src/modules/agents/agent.service.ts`

5. 核心角色初始化配置更新
   - CEO/CTO 默认工具集改为内置真实 tool id，并包含 `agents_mcp_list`：
     - `backend/src/modules/organization/organization.service.ts`

### 验证

- 构建通过：
  - `npm run build:agents`
  - `npm run build`

## 二期增补（完全数据库驱动）

### 改造目标

- 移除运行时硬编码 `agent-mcp.map.ts` 依赖。
- MCP 角色/工具/能力/暴露配置全部由数据库 `agent_profiles` 驱动。

### 实现

1. 新增 schema：`backend/src/shared/schemas/agent-profile.schema.ts`
   - 字段：`agentType`（唯一）、`role`、`tools[]`、`capabilities[]`、`exposed`、`description`

2. AgentService 改造（legacy + agents app）
   - 读取 `agent_profiles` 生成 MCP map/list/detail
   - `getAllowedToolIds` 改为实时读取 profile 合并 `agent.tools`
   - 增加 profile 管理方法：`getMcpProfiles/getMcpProfile/upsertMcpProfile`
   - 增加默认 profile seed（仅首次插入，不覆盖已配置）

3. ToolService 改造（legacy + agents app）
   - `agents_mcp_list` 改为读取 `agents + agent_profiles` 合并结果

4. Controller 扩展（legacy + agents app）
   - 新增：
     - `GET /agents/mcp/profiles`
     - `GET /agents/mcp/profiles/:agentType`
     - `PUT /agents/mcp/profiles/:agentType`

5. 运行时硬编码移除
   - 删除文件：`backend/src/modules/agents/agent-mcp.map.ts`

### 验证

- 构建通过：
  - `npm run build:agents`
  - `npm run build`

## 三期增补（修改 Agent 支持 type + agent-level role）

### 改造目标

- 在 Agent 修改流程中支持更新 `type` 与 `role`。
- `role` 采用单个 agent 级别字段，不再仅依赖 `agent_profiles.role`。

### 实现

1. 数据模型扩展
   - `Agent` 增加 `role?: string`：
     - `backend/src/shared/schemas/agent.schema.ts`
     - `backend/src/shared/types.ts`
     - `frontend/src/types/index.ts`

2. Agent 更新逻辑增强（legacy + agents app）
   - `PUT /agents/:id` 支持 `type`/`role` 更新。
   - `type` 为空时拦截。
   - `role` 传空字符串时执行 unset。

3. MCP 角色解析策略调整
   - MCP 输出中的 `role` 优先使用 `agent.role`，无值时回退到 `agent_profiles.role`。
   - `agents_mcp_list` 工具输出同策略。

4. 前端编辑能力补齐
   - 编辑 Agent 弹窗新增 `type` 下拉与 `role` 输入。
   - 保存时提交 `type/role`。

5. 初始化核心角色补充实例级 role
   - CEO: `chief-executive-officer`
   - CTO: `chief-technology-officer`

### 验证

- 构建通过：
  - `backend`: `npm run build:agents`、`npm run build`
  - `frontend`: `npm run build`

## 四期增补（Agent Type 配置化与文档规范）

### 改造目标

- 解决“CEO助理等角色缺少合适 type”问题。
- 统一维护 agent type 列表及默认 role/defaultPrompt。
- 前端表单类型来源改为配置文件，避免硬编码散落。

### 实现

1. 新增类型规范文档
   - `docs/agent_type.md`
   - 定义 `type/label/defaultRole/defaultPrompt` 与维护规则。

2. 前端新增配置文件
   - `frontend/src/config/agentType.json`
   - 包含扩展类型：`ai-executive-assistant`（CEO助理）、`ai-operations` 等。

3. Agent 表单改造
   - 创建/编辑页类型下拉改为读取 `agentType.json`。
   - 切换类型时自动填充默认 `role` 与 `systemPrompt`（仅在字段为空或仍为上一类型默认值时覆盖，保留用户自定义）。

4. 后端 seed 增补
   - MCP 默认 profile seeds 增加新类型（legacy + agents app），保持能力发现一致。

### 验证

- 构建通过：
  - `backend`: `npm run build:agents`、`npm run build`
  - `frontend`: `npm run build`

## 五期增补（全量迁移系统内置并清理旧类型）

### 改造目标

- 将所有历史 agent 类型统一迁移为 `ai-system-builtin`。
- 删除旧类型 profile，防止系统继续暴露废弃类型。

### 实现

1. `AgentService` 启动时执行迁移流程（legacy + agents app）
   - 先 seed 当前类型清单 profile
   - 再清理不在清单内的旧 `agent_profiles`
   - 最后将所有 `agents.type` 迁移为 `ai-system-builtin`

2. 类型清单更新
   - 文档：`docs/agent_type.md`
   - 前端配置：`frontend/src/config/agentType.json`
   - 已移除旧类型（如创意设计师、旧研发等）

### 验证

- 构建通过：
  - `backend`: `npm run build:agents`、`npm run build`
  - `frontend`: `npm run build`

---

## 计划原文（合并归档：AGENTS_MCP_PLAN.md）

# Agents MCP 能力建设计划

## 需求理解

- 在系统中实现 agents 的 MCP 能力。
- 系统中仅部分 agent 可被暴露。
- 可通过 agents map 了解已注册 agent 及其能力信息（角色、工具集、能力集等）。

## 执行步骤

1. 梳理现有 `agents map` 与 agent/tool 相关模块，确认当前可复用的数据来源。
2. 设计并落地 MCP 元信息模型，统一 agent 的角色、工具集、能力集与暴露开关字段。
3. 在后端实现 agents MCP 查询能力，提供“列表 + 详情”并基于 map 生成标准化响应。
4. 增加“部分可见”过滤机制（默认仅返回允许暴露的 agent）。
5. 补充测试，覆盖字段映射、过滤规则和异常场景。
6. 更新接口文档与使用说明，确保前后端可按统一结构接入。

## 关键影响点

- 后端模块：`agents` 模块服务与控制器能力扩展。
- 配置与映射：`agents map` 增加/规范 MCP 元信息字段。
- API：新增或扩展 mcp 查询接口（列表、详情）。
- 测试：新增服务与控制器测试，重点验证暴露过滤与字段完整性。
- 文档：更新 `docs/api/API.md`、必要的使用文档与说明。

## 风险与依赖

- 现有 agent 信息可能分散在不同模块，需统一归一化策略。
- 能力字段命名若不一致，可能影响前端消费，需要保持向后兼容。
- 存在敏感内部 agent 时，必须采用“默认不暴露”的安全策略。

## 验证方式

- 构建通过：`backend` 应可正常编译。
- 功能验证：
  - 查询 MCP agent 列表可返回可见 agent。
  - 查询单个 agent MCP 信息返回角色、工具集、能力集等完整字段。
  - 未暴露或不存在 agent 的返回符合预期（过滤或 404）。
- 质量检查：按项目规范执行 lint / typecheck / test。

## 增补范围（CEO/CTO 对话可感知 agents）

1. 新增内置工具 `agents_mcp_list`，用于查询当前 MCP 可见 agent 列表。
2. 将该工具默认加入 CEO/CTO 创始 agent 的可用工具集。
3. 在 CEO/CTO system prompt 中加入“询问系统现有 agents 时优先调用该工具”的约束。
4. 补充接口/功能文档，说明该能力的调用链与可见性规则。

### 增补影响点

- 后端工具模块：新增工具执行分支。
- 组织初始化：创始 agent 默认工具分配。
- 提示词：CEO/CTO 行为约束。
- 文档：README/API 开发说明。

## 增补范围（二期：MCP 配置完全数据库驱动）

1. 新增 `agent_profiles` 数据模型，存储 `agentType/role/tools/capabilities/exposed/description`。
2. MCP 列表与详情改为实时读取 `agent_profiles + agents`，移除运行时硬编码 map 依赖。
3. Agent 可用工具改为 `agent.tools + 对应 profile.tools` 合并计算（实时读取 DB）。
4. 增加 profile 管理接口（至少列表、按类型查询、按类型更新/创建）。
5. 提供默认 profile 自动补齐逻辑，保障历史数据平滑迁移。

### 二期影响点

- 数据库：新增 `agent_profiles` 集合。
- 后端：agents/tool 服务增加 profile 查询与合并逻辑。
- API：新增/扩展 MCP profile 管理接口。
- 文档：补充 profile 管理与默认策略说明。

## 增补范围（三期：Agent 更新支持 type + agent-level role）

1. 在 `Agent` 实体新增 `role` 字段（单个 agent 级别）。
2. `PUT /agents/:id` 显式支持更新 `type` 与 `role`。
3. MCP 输出中的 `role` 优先读取 `agent.role`，若为空再回退 `agent_profiles.role`。
4. `agents_mcp_list` 工具返回中的 `role` 同样采用 agent 优先策略。
5. 更新 API 文档，说明 `role` 已支持实例级别覆盖。

### 三期影响点

- 数据模型：`agents` 集合新增 `role` 字段。
- 后端服务：agent 更新和 MCP 聚合逻辑调整。
- 文档：`PUT /agents/:id` 参数说明补充。

## 增补范围（四期：Agent Type 规范与前端配置化）

1. 新增 `docs/agent_type.md`，维护 agent 类型清单（type、名称、默认 role、默认 prompt）。
2. 前端新增 `agentType.json` 配置数组，表单类型选择统一来自该文件。
3. 选择类型时自动带入默认 `role` 与 `systemPrompt`（不覆盖用户已自定义内容）。
4. 增加适配“CEO 助理”等新类型。
5. 同步更新 README/API 与开发总结文档。

### 四期影响点

- 文档：新增类型规范文档。
- 前端：Agent 创建/编辑页类型来源配置化。
- 后端：默认 profile seed 增补新类型，保证可发现能力一致。

## 增补范围（五期：全量迁移为系统内置并清理旧类型）

1. 将现存 agents 的 `type` 统一迁移为 `ai-system-builtin`。
2. 清理 `agent_profiles` 中不在新类型清单内的旧类型记录。
3. 更新 agent type 文档与前端配置，替换为新清单（高管/高管助理/技术专家/全栈/运维/数据/产品/HR/行政/营销/系统内置）。

### 五期影响点

- 数据：历史 agent 类型统一归并。
- 配置：旧 profile 类型会被自动清理。
- 前端：类型选项全面切换到新清单。

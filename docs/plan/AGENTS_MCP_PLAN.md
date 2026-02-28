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

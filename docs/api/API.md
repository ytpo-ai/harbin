# API 文档

## 基础信息

- **Base URL**: `http://localhost:3001/api`
- **Content-Type**: `application/json`
- **响应格式**: JSON

## 认证

当前版本未启用认证，后续版本将支持 JWT Token。

---

## 1. Agent 管理 API

### 1.1 获取所有Agent
```http
GET /agents
```

**响应示例**:
```json
[
  {
    "id": "65d123...",
    "name": "Alex Chen",
    "type": "ai-executive",
    "description": "CEO of the company",
    "model": {
      "id": "claude-sonnet-4-6",
      "name": "Claude Sonnet 4.6",
      "provider": "anthropic"
    },
    "isActive": true,
    "capabilities": ["战略思维", "领导力"]
  }
]
```

### 1.2 创建Agent
```http
POST /agents
```

**说明**:
- `type` 建议从前端配置 `frontend/src/config/agentType.json` 选择。
- 类型规范与默认 role/prompt 说明见 `docs/agent_type.md`。
- 现行类型包括：`ai-executive`、`ai-management-assistant`、`ai-technical-expert`、`ai-fullstack-engineer`、`ai-devops-engineer`、`ai-data-analyst`、`ai-product-manager`、`ai-hr`、`ai-admin-assistant`、`ai-marketing-expert`、`ai-human-exclusive-assistant`、`ai-system-builtin`。

**请求体**:
```json
{
  "name": "New Agent",
  "type": "ai-developer",
  "role": "backend-developer",
  "description": "A new AI developer",
  "model": {
    "id": "gpt-4-turbo",
    "name": "GPT-4 Turbo",
    "provider": "openai",
    "model": "gpt-4-turbo-preview",
    "maxTokens": 4096
  },
  "capabilities": ["编程", "代码审查"],
  "systemPrompt": "You are a helpful AI developer...",
  "isActive": true
}
```

### 1.3 更新Agent
```http
PUT /agents/:id
```

**请求体（示例）**:
```json
{
  "name": "Alex Chen",
  "type": "ai-executive",
  "role": "chief-executive-officer",
  "description": "更新后的描述",
  "capabilities": ["战略思维", "组织管理"]
}
```

**说明**:
- `type` 与 `role` 均可在更新时修改。
- `role` 为单个 agent 级别字段，MCP 输出会优先使用该值。
- 前端编辑页的类型选项来自 `frontend/src/config/agentType.json`。

### 1.4 执行Agent任务
```http
POST /agents/:id/execute
```

**请求体**:
```json
{
  "task": {
    "title": "Task Title",
    "description": "Task Description",
    "type": "development",
    "priority": "high",
    "messages": [
      {
        "role": "user",
        "content": "Please write a hello world program",
        "timestamp": "2026-02-25T10:00:00Z"
      }
    ]
  }
}
```

**响应**:
```json
{
  "response": "Here's a hello world program in Python:\n\nprint('Hello, World!')"
}
```

### 1.5 测试Agent连接
```http
POST /agents/:id/test
```

**响应**:
```json
{
  "success": true,
  "agent": "Alex Chen",
  "model": "Claude Sonnet 4.6",
  "response": "Agent Connected to AI Model Successfully",
  "duration": "1250ms"
}
```

### 1.6 获取 Agents MCP Map
```http
GET /agents/mcp/map
```

**说明**:
- 返回数据库中 `agent_profiles` 的映射（按 `agentType`）。
- 字段包含 `role`、`tools`、`capabilities`、`exposed` 等。

### 1.5.1 获取 MCP Profiles 列表
```http
GET /agents/mcp/profiles
```

### 1.5.2 获取单个 MCP Profile
```http
GET /agents/mcp/profiles/:agentType
```

### 1.5.3 创建或更新 MCP Profile
```http
PUT /agents/mcp/profiles/:agentType
```

**请求体**:
```json
{
  "role": "executive-strategist",
  "tools": ["websearch", "agents_mcp_list"],
  "capabilities": ["strategy_planning", "decision_making"],
  "exposed": true,
  "description": "管理层agent能力配置"
}
```

### 1.6 获取可见 MCP Agent 列表
```http
GET /agents/mcp
```

**Query 参数**:
- `includeHidden` (可选): `true/false`，默认为 `false`。

**响应示例**:
```json
{
  "total": 2,
  "visible": 1,
  "agents": [
    {
      "id": "65d123...",
      "name": "Alex Chen",
      "type": "ai-executive",
      "description": "具有丰富战略思维和领导力的AI首席执行官",
      "role": "executive-strategist",
      "capabilitySet": ["战略思维", "领导力", "strategy_planning"],
      "toolSet": [
        {
          "id": "websearch",
          "name": "Web Search",
          "description": "Search web information via Composio SERPAPI",
          "type": "web_search",
          "category": "Information Retrieval"
        }
      ],
      "exposed": true,
      "mapKey": "ai-executive"
    }
  ]
}
```

### 1.7 获取单个 MCP Agent 详情
```http
GET /agents/mcp/:id
```

**说明**:
- 默认仅允许读取 `exposed=true` 的 agent。
- 若需读取隐藏 agent，可传 `?includeHidden=true`。
- CEO/CTO 对话场景可通过内置工具 `agents_mcp_list` 获取同源列表数据。
- CTO 在“系统核心功能盘点”问答中会由后端强制触发 `code-docs-mcp`，返回功能清单与 docs 证据路径。
- CTO 在“最近24小时主要更新”问答中会由后端强制触发 `code-updates-mcp`，返回提交证据与更新摘要。
- profile 配置来源为数据库 `agent_profiles`，非代码硬编码。

---

## 1.8 会议 API（Meetings）

前端路由补充：会议列表页为 `/meetings`，可通过 `/meetings/:meetingId` 直接打开某个会议的独立页面（不包含全局菜单与会议列表，保留聊天区与会议操作区）。

### 获取会议列表
```http
GET /meetings
```

### 发送会议消息
```http
POST /meetings/:id/messages
```

当消息内容包含 `@AgentName` 时，仅被 @ 的在场 Agent 会响应；
不包含 @ 时，默认所有在场常规 Agent 依次响应（专属助理除外）。

会议参会人上下文同步规则：
- 会议开始时，系统会写入一条“参会人上下文已初始化”系统消息，包含当前参会人结构化信息（`id/type/name/role/isPresent`）。
- 通过“添加参会人员 / 移除参会人员”接口变更成员后，系统会写入“参会人上下文已更新：当前参会X人”系统消息。
- Agent 执行任务时，`teamContext` 除保留 `participants`（ID 列表）外，新增 `participantProfiles`（结构化参会人信息）。

专属助理规则：
- 人类员工/高管账号必须先绑定专属助理，否则不可发起会议或参与会议。
- 人类发起会议时，会议主持人会自动切换为其专属助理（host 为 agent），人类本人不加入会议参与者列表。
- 人类在会议中发送消息时，后端会自动映射为其专属助理身份发言。
- 专属助理不会主动发言，仅在其对应人类显式 `@` 时响应。

会议中的模型检索特例：
- 当人类消息命中“搜索最新openai模型 / search latest openai models”等意图时，系统会优先路由 `Model Management Agent` 响应。
- 该 Agent 会先联网搜索并返回候选模型，再询问“是否需要添加到系统？”。
- 在用户明确确认前，不会触发模型入库。

会议中的模型列表特例：
- 当人类消息命中“现在系统里有哪些模型 / list models”等意图时，系统会优先路由 `Model Management Agent`。
- 该 Agent 会调用 `model_mcp_list_models` 返回实时模型清单。

### 暂停会议
```http
POST /meetings/:id/pause
```

### 恢复会议
```http
POST /meetings/:id/resume
```

### 切换发言模式
```http
PUT /meetings/:id/speaking-mode
```

**请求体**:
```json
{
  "speakingOrder": "free"
}
```

`speakingOrder` 可选值:
- `free`: 自由讨论
- `ordered`: 有序发言（Agent发言后需等待人类下一次发言）

### 修改会议名称
```http
PUT /meetings/:id/title
```

**请求体**:
```json
{
  "title": "新会议名称"
}
```

### 添加参会人员
```http
POST /meetings/:id/participants
```

当目标会议标题为“1对1聊天”语义，且新增参会者导致会议扩展为多人讨论（排除系统内置/隐形 Agent）时，后端会自动更新会议标题，并通过 `settings_changed` 事件下发新标题。

**请求体**:
```json
{
  "id": "employee-or-agent-id",
  "type": "employee",
  "name": "显示名称",
  "isHuman": true
}
```

### 移除参会人员
```http
DELETE /meetings/:id/participants/:participantType/:participantId
```

> 说明：主持人不可被移除。

### 删除会议
```http
DELETE /meetings/:id
```

> 说明：支持删除 `pending`、`ended`、`archived` 状态会议。

### 绑定/查询专属助理
```http
POST /employees/:id/exclusive-assistant
GET /employees/:id/exclusive-assistant
POST /employees/:id/exclusive-assistant/auto-create
```

`POST` 请求体示例：
```json
{
  "agentId": "agent-xxx"
}
```

`POST /employees/:id/exclusive-assistant/auto-create` 说明：
- 用于“登录后未绑定专属助理”的一键引导场景。
- 后端会自动创建一个 `ai-human-exclusive-assistant` 类型 Agent，并立即绑定到该员工账号。

### 实时会议事件（WebSocket）
- WS 地址: `ws://localhost:3003/ws`
- 订阅频道: `meeting:<meetingId>`
- 事件类型: `message` / `status_changed` / `participant_joined` / `participant_left` / `summary_generated` / `settings_changed`

---

## 2. 模型管理 API

### 2.1 获取所有可用模型
```http
GET /models
```

### 2.2 获取模型调试状态
```http
GET /models/debug/status
```

**响应**:
```json
{
  "registeredModels": 3,
  "models": [
    {
      "id": "gpt-4-turbo",
      "name": "GPT-4 Turbo",
      "provider": "openai"
    }
  ]
}
```

### 2.3 测试模型连接
```http
POST /models/:modelId/test
```

### 2.4 聊天接口
```http
POST /models/:modelId/chat
```

**请求体**:
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "options": {
    "temperature": 0.7,
    "maxTokens": 1000
  }
}
```

---

## 3. 模型选择 API

### 3.1 获取所有可用模型列表
```http
GET /model-management/available
```

**响应** (50个模型):
```json
[
  {
    "id": "gpt-4-turbo",
    "name": "GPT-4 Turbo",
    "provider": "openai",
    "model": "gpt-4-turbo-preview",
    "maxTokens": 4096,
    "temperature": 0.7
  }
]
```

### 3.2 获取推荐模型
```http
GET /model-management/recommended
```

### 3.3 按提供商获取模型
```http
GET /model-management/by-provider/:provider
```

**示例**: `/model-management/by-provider/openai`

### 3.4 为核心角色选择模型
```http
POST /model-management/select-for-founder/:founderType
```

**参数**:
- `founderType`: `ceo` 或 `cto`

**请求体**:
```json
{
  "modelId": "gpt-4-turbo"
}
```

**响应**:
```json
{
  "success": true,
  "message": "CEO model updated successfully",
  "model": {
    "id": "gpt-4-turbo",
    "name": "GPT-4 Turbo"
  }
}
```

### 3.5 获取当前核心角色模型
```http
GET /model-management/founder-models
```

**响应**:
```json
{
  "ceo": {
    "id": "claude-sonnet-4-6",
    "name": "Claude Sonnet 4.6"
  },
  "cto": {
    "id": "gpt-4-turbo",
    "name": "GPT-4 Turbo"
  }
}
```

### 3.6 MCP 模型管理工具（通过 Tools 执行）

系统新增内置 MCP 工具，用于模型管理、审计日志与研发文档功能盘点：

- `model_mcp_list_models`
  - 入参：`provider?: string`、`limit?: number`
  - 出参：系统当前模型列表（`id/name/provider/model/maxTokens/temperature/topP`）

- `model_mcp_search_latest`
  - 入参：`providers?: string[]`、`query?: string`、`maxResultsPerQuery?: number`、`limit?: number`
  - 出参：结构化候选模型列表（含 `provider/model/name/sourceUrl/confidence`）

- `model_mcp_add_model`
  - 入参：`provider`、`model`、`name?`、`id?`、`maxTokens?`、`temperature?`、`topP?`
  - 出参：`created`、`duplicateBy`、`model`、`message`
  - 内置去重：按 `id` 与 `provider+model` 双重判重

- `human_operation_log_mcp_list`
  - 入参：`from?`、`to?`、`action?`、`resourceKeyword?`、`success?`、`statusCode?`、`page?`、`pageSize?`
  - 出参：绑定人类的操作日志分页列表（含 `action/resource/statusCode/success/timestamp` 等）
  - 权限：仅允许“人类专属助理”查询其绑定人类日志，禁止跨人类访问

- `code-docs-mcp`
  - 入参：`query?: string`、`focus?: string`、`maxFeatures?: number`、`maxEvidencePerFeature?: number`
  - 出参：核心功能列表（`name/summary/confidence/evidence[]`）与 `unknownBoundary`
  - 权限：默认仅 CTO 可用，用于“当前系统实现了哪些核心功能”类问答

- `code-updates-mcp`
  - 入参：`hours?: number`、`limit?: number`、`includeFiles?: boolean`、`minSeverity?: 'high'|'medium'|'low'`
  - 出参：时间窗口内提交记录（`commits[]`）与按主题聚合的主要更新摘要（`majorUpdates[]`）
  - 权限：默认仅 CTO 可用，用于“最近24小时主要更新”类问答

新增系统内置 Agent：`Model Management Agent`（`role=model-management-specialist`），默认具备以上三个模型管理工具。

---

## 4. 组织管理 API（已下线）

组织管理相关后端接口已移除，后续将以新设计重新实现。

---

## 5. 工具管理 API

### 5.1 获取所有工具
```http
GET /tools
```

### 5.2 执行工具
```http
POST /tools/:toolId/execute
```

**请求体**:
```json
{
  "agentId": "agent-uuid",
  "parameters": {
    "language": "python",
    "code": "print('Hello')"
  },
  "taskId": "task-uuid"
}
```

**模型管理工具调用示例（查询系统模型列表）**:
```json
{
  "agentId": "agent-uuid",
  "parameters": {
    "provider": "openai",
    "limit": 50
  }
}
```

请求路径示例：`POST /tools/model_mcp_list_models/execute`

**模型管理工具调用示例（搜索最新模型）**:
```json
{
  "agentId": "agent-uuid",
  "parameters": {
    "providers": ["openai", "anthropic", "google"],
    "limit": 10
  }
}
```

请求路径示例：`POST /tools/model_mcp_search_latest/execute`

**模型管理工具调用示例（新增模型）**:
```json
{
  "agentId": "agent-uuid",
  "parameters": {
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "name": "GPT-4.1 Mini",
    "maxTokens": 8192,
    "temperature": 0.7
  }
}
```

请求路径示例：`POST /tools/model_mcp_add_model/execute`

**人类操作日志 MCP 工具调用示例（仅专属助理可用）**:
```json
{
  "agentId": "exclusive-assistant-agent-id",
  "parameters": {
    "from": "2026-03-01T00:00:00.000Z",
    "to": "2026-03-01T23:59:59.000Z",
    "action": "POST /api/meetings",
    "page": 1,
    "pageSize": 20
  }
}
```

请求路径示例：`POST /tools/human_operation_log_mcp_list/execute`

**研发文档 MCP 工具调用示例（核心功能盘点）**:
```json
{
  "agentId": "cto-agent-id",
  "parameters": {
    "query": "当前系统实现了哪些核心功能",
    "focus": "core_features",
    "maxFeatures": 8,
    "maxEvidencePerFeature": 3
  }
}
```

请求路径示例：`POST /tools/code-docs-mcp/execute`

**研发更新 MCP 工具调用示例（最近24小时主要更新）**:
```json
{
  "agentId": "cto-agent-id",
  "parameters": {
    "hours": 24,
    "limit": 10,
    "includeFiles": true,
    "minSeverity": "medium"
  }
}
```

请求路径示例：`POST /tools/code-updates-mcp/execute`

### 5.3 获取工具执行历史
```http
GET /tools/executions/history
```

**查询参数**:
- `agentId` (可选): 筛选特定Agent
- `toolId` (可选): 筛选特定工具

### 5.4 获取工具统计
```http
GET /tools/executions/stats
```

---

## 5.4A 系统操作日志查询 API

### 获取系统操作日志（人类用户全员可见）
```http
GET /operation-logs
```

**权限**:
- 任意已登录人类用户均可访问。
- 返回全员系统操作日志（已脱敏字段）。

**查询参数**:
- `from` / `to` (可选): ISO 时间范围
- `action` (可选): 动作关键词
- `resourceKeyword` (可选): 资源路径关键词
- `humanEmployeeId` (可选): 指定人类员工ID
- `assistantAgentId` (可选): 指定专属助理Agent ID
- `success` (可选): `true | false`
- `statusCode` (可选): HTTP 状态码
- `page` (可选): 页码，默认 1
- `pageSize` (可选): 每页条数，默认 20，最大 100

**响应示例**:
```json
{
  "success": true,
  "data": {
    "total": 120,
    "page": 1,
    "pageSize": 20,
    "totalPages": 6,
    "logs": [
      {
        "id": "log-id",
        "humanEmployeeId": "emp-1",
        "humanName": "Alice",
        "action": "POST /api/meetings",
        "resource": "/api/meetings",
        "statusCode": 201,
        "success": true,
        "timestamp": "2026-03-01T12:00:00.000Z"
      }
    ],
    "fetchedAt": "2026-03-01T12:01:00.000Z"
  }
}
```

---

## 5.5 Skills 管理 API

### 获取技能库
```http
GET /skills
```

**Query 参数**:
- `status` (可选): `active | experimental | deprecated | disabled`
- `category` (可选): 技能分类
- `search` (可选): 关键字搜索（name/description/tags/category/provider/version）
- `page` (可选): 页码（传入后返回分页结构）
- `pageSize` (可选): 每页条数（默认 10，最大 100）

**分页响应示例**（当传入 `page`/`pageSize`/`search` 时）:
```json
{
  "items": [],
  "total": 42,
  "page": 1,
  "pageSize": 10,
  "totalPages": 5
}
```

### 创建技能
```http
POST /skills
```

**请求体示例**:
```json
{
  "name": "security-audit-skill",
  "description": "Static security checks for code review tasks",
  "category": "engineering",
  "tags": ["security", "code-review"],
  "sourceType": "manual",
  "provider": "internal",
  "status": "active",
  "confidenceScore": 80
}
```

### 为 Agent 绑定技能
```http
POST /skills/assign
```

**请求体示例**:
```json
{
  "agentId": "65d...",
  "skillId": "f6d...",
  "proficiencyLevel": "intermediate",
  "assignedBy": "AgentSkillManager"
}
```

### 获取 Agent 的技能清单
```http
GET /skills/agents/:agentId
```

### AgentSkillManager 互联网检索技能
```http
POST /skills/manager/discover
```

**请求体示例**:
```json
{
  "query": "code review automation",
  "maxResults": 5,
  "sourceType": "github"
}
```

### AgentSkillManager 生成技能建议
```http
POST /skills/manager/suggest/:agentId
```

**请求体示例**:
```json
{
  "contextTags": ["security", "typescript", "review"],
  "topK": 5,
  "persist": true
}
```

### 查询建议记录
```http
GET /skills/suggestions/agents/:agentId
```

### 审核建议记录
```http
PUT /skills/suggestions/:id
```

**请求体示例**:
```json
{
  "status": "accepted",
  "note": "Will schedule this upgrade in next sprint"
}
```

### 重建 skills 文档
```http
POST /skills/docs/rebuild
```

说明：skills 在数据库和 `docs/skills` 目录双轨维护，该接口用于从 DB 全量重建 Markdown 文档。

---

## 6. 人力资源 API

### 6.1 生成绩效报告
```http
GET /hr/performance/:agentId
```

**响应**:
```json
{
  "agentId": "agent-uuid",
  "overallScore": 85,
  "kpis": {
    "taskCompletionRate": 90,
    "codeQuality": 85,
    "collaboration": 88,
    "innovation": 80,
    "efficiency": 82
  },
  "recommendations": ["继续保持", "加强创新"]
}
```

### 6.2 识别低绩效员工
```http
GET /hr/low-performers
```

### 6.3 获取招聘建议
```http
GET /hr/hiring-recommendations
```

### 6.4 计算团队健康度
```http
GET /hr/team-health
```

---

## 7. 公司治理 API（已下线）

公司治理相关后端接口已移除，后续将以新设计重新实现。

---

## 8. 讨论协作 API

### 8.1 创建讨论
```http
POST /discussions
```

**请求体**:
```json
{
  "taskId": "task-uuid",
  "participantIds": ["agent-1", "agent-2"],
  "initialPrompt": "Let's discuss the architecture"
}
```

### 8.2 发送消息
```http
POST /discussions/:id/messages
```

**请求体**:
```json
{
  "agentId": "agent-uuid",
  "content": "I think we should use microservices",
  "type": "opinion"
}
```

### 8.3 结束讨论
```http
POST /discussions/:id/conclude
```

---

## 9. 任务编排与 Session API

### 9.1 通过提示词创建计划
```http
POST /orchestration/plans/from-prompt
```

**请求体**:
```json
{
  "prompt": "实现客服机器人 MVP，并分配给合适的执行者",
  "title": "客服机器人 MVP",
  "plannerAgentId": "65f...",
  "mode": "hybrid",
  "autoRun": false
}
```

### 9.2 执行计划
```http
POST /orchestration/plans/:id/run
```

**请求体**:
```json
{
  "continueOnFailure": true
}
```

**响应示例（异步触发）**:
```json
{
  "accepted": true,
  "planId": "69a2d149a397bd1d7458f63f",
  "status": "accepted",
  "alreadyRunning": false
}
```

说明：该接口仅负责触发执行并立即返回，前端应通过 `GET /orchestration/plans/:id` 轮询计划状态。

### 9.2.1 删除计划
```http
DELETE /orchestration/plans/:id
```

**响应示例**:
```json
{
  "success": true,
  "deletedTasks": 4
}
```

### 9.3 任务改派
```http
POST /orchestration/tasks/:id/reassign
```

**请求体**:
```json
{
  "executorType": "agent",
  "executorId": "65f...",
  "reason": "具备更匹配的能力标签"
}
```

`executorType` 可选值:
- `agent`
- `employee`
- `unassigned`

### 9.4 人工任务完成回填
```http
POST /orchestration/tasks/:id/complete-human
```

**请求体**:
```json
{
  "summary": "需求评审与原型已完成",
  "output": "文档链接或结果摘要"
}
```

说明：对于“发送邮件”等外部动作任务，系统会校验执行输出是否包含可验证凭证（如 `recipient/provider/messageId`）。若凭证缺失，任务会进入 `waiting_human`，需人工确认回填。

### 9.4.1 失败任务重试
```http
POST /orchestration/tasks/:id/retry
```

**响应示例**:
```json
{
  "task": {
    "_id": "69a...",
    "status": "assigned"
  },
  "run": {
    "accepted": true,
    "planId": "69a...",
    "status": "accepted"
  }
}
```

说明：重试会重置失败任务状态并自动触发所属计划异步续跑。

补充：研究类任务失败时，错误信息会包含结构化缺失项（如 `missing=json-top10-items,population-values`），可据此修正输出后重试。

补充：研究类任务需包含联网执行证明块：
`RESEARCH_EXECUTION_PROOF: {"toolCalls":["websearch","webfetch"],"fetchedUrls":["https://..."]}`。
系统会按任务类型动态校验输出结构（如城市人口类校验 `cities[]`，通用研究类校验 `findings[]`）。

补充：研究任务识别已扩展为阶段语义识别（如 identify/collect/analyze）。
Review/Finalize 类任务需输出“修订后完整正文（Subject+称呼+正文+结尾）”，仅建议列表将判定失败。

### 9.5 Session 管理
```http
POST /orchestration/sessions
GET /orchestration/sessions
GET /orchestration/sessions/:id
POST /orchestration/sessions/:id/messages
POST /orchestration/sessions/:id/messages/batch
POST /orchestration/sessions/:id/archive
POST /orchestration/sessions/:id/resume
```

### 9.6 统一消息查询
```http
GET /messages
```

**Query 参数**:
- `sceneType` (必填): `meeting | discussion | orchestration_session | task`
- `sceneId` (必填): 场景ID（例如 meetingId/discussionId/sessionId）
- `limit` (可选): 返回条数，默认 50，最大 500
- `before` (可选): 按 `occurredAt` 游标向前分页（ISO 时间）

说明：该接口用于聚合查看统一消息库 `messages`，支持后续模型评测与 Agent 绩效统计。

---

## 10. 研发智能 API

用于配置研发可访问 GitHub 仓库，并对仓库文档执行阅读摘要与技术状态感知。

### 10.1 获取仓库配置列表
```http
GET /engineering-intelligence/repositories
```

### 10.2 新增仓库配置
```http
POST /engineering-intelligence/repositories
```

**请求体示例**:
```json
{
  "repositoryUrl": "https://github.com/owner/repo",
  "branch": "main"
}
```

### 10.3 更新仓库配置
```http
PUT /engineering-intelligence/repositories/:id
```

### 10.4 删除仓库配置
```http
DELETE /engineering-intelligence/repositories/:id
```

### 10.5 触发文档摘要
```http
POST /engineering-intelligence/repositories/:id/summarize
```

**响应说明**:
- 返回仓库级摘要（overview/keyPoints/stackSignals/confidence）
- 返回分文档摘要（path/title/summary/evidence）

### 10.6 获取 docs 目录树
```http
GET /engineering-intelligence/repositories/:id/docs/tree
```

**响应说明**:
- 返回 `docs/` 目录下 markdown 文档树（`file/dir` 结构）

### 10.7 获取文档内容
```http
GET /engineering-intelligence/repositories/:id/docs/content?path=docs/guide/README.md
```

**响应说明**:
- 返回文档原文内容（Markdown）
- 返回文件辅助信息（`size/sha/htmlUrl`）

### 10.8 获取文档更新记录
```http
GET /engineering-intelligence/repositories/:id/docs/history?path=docs/guide/README.md&limit=20
```

**响应说明**:
- 返回最近 commit 记录（sha/message/author/committedAt/htmlUrl）
- 返回辅助统计（提交次数、贡献者数、最近更新时间）

**说明**:
- 仅支持 `engineering-intelligence` 路径。

---

## 错误处理

### 错误响应格式
```json
{
  "statusCode": 400,
  "message": "Agent not found: invalid-id",
  "error": "Bad Request"
}
```

### 常见错误码
- `400` - 请求参数错误
- `404` - 资源不存在
- `500` - 服务器内部错误

---

## 调试接口

### Agent调试状态
```http
GET /agents/debug/status
```

### 模型调试状态
```http
GET /models/debug/status
```

---

**API版本**: v1.0
**最后更新**: 2026-02-25

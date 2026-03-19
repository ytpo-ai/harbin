---
在 /Users/van/Workspace/harbin 项目中，深入分析 agent 的能力模型和角色系统。我需要了解：

1. Agent schema 的完整定义（agent.schema.ts），特别关注：capabilities, tools, skills, role, description 等字段
2. agent-master（list-agents）返回的数据结构，看它暴露了哪些能力信息
3. 是否存在 agent 角色定义（如 fullstack_developer, technical_expert, CTO 等），搜索 agentRole, roleId, role-executive
4. agent 的 MCP profile（agent-mcp-profile.service.ts）完整内容
5. agent 工具权限管理（getAllowedToolIds, tool binding 机制）
6. orchestration-tool-handler.service.ts 中 create-plan 的处理逻辑（看 plannerAgentId 是怎么传入的）
7. 是否有 agent 能力评估/匹配的现有代码（搜索 capability match, agent match, agent select）
8. builtin-tool-catalog.ts 中工具定义的结构

请返回所有关键代码片段和行号。搜索深度：very thorough
---

## Agent 能力模型与角色系统深度分析

### 1. Agent Schema 完整定义

**文件**: `backend/src/shared/schemas/agent.schema.ts:1-106`

```typescript
@Schema({ timestamps: true, collection: 'agents' })
export class Agent {
  id?: string;
  name: string;                    // 必填
  roleId: string;                  // 必填，关联 agent_roles 表
  description: string;             // 必填
  model: {                         // 嵌入式模型配置
    id, name, provider, model, maxTokens,
    temperature?, topP?,
    reasoning?: { enabled, effort, verbosity }
  };
  capabilities: string[];          // 能力标签列表
  systemPrompt: string;            // 系统提示词
  isActive: boolean;               // 激活状态
  config?: Record<string, unknown>;
  tools: string[];                 // 可使用的工具ID列表
  skills?: string[];               // 已启用的技能ID列表
  permissions: string[];           // 权限ID列表
  personality: {                   // 人格模型 (0-100)
    workEthic, creativity, leadership, teamwork
  };
  learningAbility: number;         // 学习能力 (0-100)
  salary?: number;
  performanceScore?: number;
  apiKeyId?: string;               // 关联的API密钥
}
```

**共享类型** (`backend/src/shared/types.ts:5-30`) 与 schema 完全一致。

---

### 2. Agent-Master (list-agents) 返回结构

**MCP 工具调用路径**: `tool.service.ts:1175-1177` -> `getAgentsMcpList()` at `tool.service.ts:1840-1885`

**返回数据结构**:
```typescript
{
  total: number;           // 全部 agent 数量
  visible: number;         // 可见 agent 数量
  includeHidden: boolean;
  agents: Array<{
    id: string;
    name: string;
    role: string;          // 角色名称 (来自 roleMap)
    capabilitySet: string[];  // 合并 agent.capabilities + profile.permissions (截取前12个)
    exposed: boolean;      // 是否对外可见
    isActive: boolean;
    identify: string;      // 身份备忘录全文 (identity memo)
  }>;
  fetchedAt: string;       // ISO 时间戳
}
```

**MCP 接口路径** (`agent.controller.ts:115-118`): `GET /agents/mcp` 返回的结构更丰富:
```typescript
// AgentMcpProfile (agent.service.ts:65-75)
{
  total: number;
  visible: number;
  agents: Array<{
    id: string;
    name: string;
    description: string;
    roleId?: string;
    role: string;           // 角色名或 code
    capabilitySet: string[];
    toolSet: AgentMcpToolSummary[];  // { id, name, description, type?, category? }
    exposed: boolean;
    mapKey: string;
  }>;
}
```

---

### 3. Agent 角色定义体系

**AgentRole Schema** (`backend/src/shared/schemas/agent-role.schema.ts:10-40`):
```typescript
@Schema({ collection: 'agent_roles' })
export class AgentRole {
  id: string;              // UUID
  code: string;            // 唯一 code (如 'executive-lead')
  name: string;            // 显示名
  description?: string;
  capabilities: string[];  // 角色级别能力
  tools: string[];         // 角色默认工具
  promptTemplate?: string; // 角色提示模板
  status: 'active' | 'inactive';
}
```

**AgentRole 类型定义** (`backend/src/shared/types.ts:121-135`):
```typescript
export interface AgentRole {
  id: string;
  title: string;
  department: string;
  level: 'junior' | 'senior' | 'lead' | 'manager' | 'executive';
  requiredTools: string[];
  requiredCapabilities: string[];
  maxEmployees?: number;
  salaryRange: { min: number; max: number };
  stockOptions?: number;
}
```

**14 个预定义角色种子** (`roles.service.ts:14-40`):

| agentType | roleCode | roleName |
|---|---|---|
| ai-executive | `executive-lead` | 高管 |
| ai-management-assistant | `management-assistant` | 高管助理 |
| ai-technical-expert | `technical-architect` | 技术专家 |
| ai-fullstack-engineer | `fullstack-engineer` | 全栈工程师 |
| ai-devops-engineer | `devops-engineer` | 运维工程师 |
| ai-data-analyst | `data-analyst` | 数据分析师 |
| ai-product-manager | `product-manager` | 产品经理 |
| ai-hr | `human-resources-manager` | HR |
| ai-admin-assistant | `administrative-assistant` | 行政助理 |
| ai-marketing-expert | `marketing-strategist` | 营销专家 |
| ai-human-exclusive-assistant | `human-exclusive-assistant` | 人类专属助理 |
| ai-system-builtin | `system-builtin-agent` | 系统内置 |
| ai-meeting-assistant | `meeting-assistant` | 会议助理 |

**CTO 特殊判定** (`agent.service.ts:2199-2208`): 通过关键词匹配（不是 roleCode），`isCtoAgent()` 检测 name/roleId/description 中是否包含 `cto`, `chief-technology-officer`, `technical-architect`, `sarah kim`, `首席技术官`，匹配的 agent 额外获得 repo-read、docs-read、updates-read 工具。

---

### 4. Agent MCP Profile 完整内容

**文件**: `backend/apps/agents/src/modules/agents/agent-mcp-profile.service.ts` (767行)

**核心模型** - `AgentProfile Schema` (`agent-profile.schema.ts:7-34`):
```typescript
@Schema({ collection: 'agent_profiles' })
export class AgentProfile {
  roleCode: string;           // 唯一键
  role: string;
  tools: string[];            // 工具ID列表
  permissions: string[];      // 合并后权限
  permissionsManual: string[];  // 手动配置权限
  permissionsDerived: string[]; // 从工具推导的权限
  capabilities: string[];     // = permissions
  exposed: boolean;           // 是否对外可见
  description?: string;
}
```

**13 个 MCP Profile 种子** (`agent-mcp-profile.service.ts:83-278`):

| roleCode | 工具数量 | permissions | exposed |
|---|---|---|---|
| `executive-lead` | 19 (全部orchestration+requirement+web) | strategy_planning, decision_making, stakeholder_communication, resource_governance | true |
| `management-assistant` | 16 | schedule_management, meeting_followup, information_synthesis | true |
| `technical-architect` | 4 | system_design, technical_planning, risk_assessment | true |
| `fullstack-engineer` | 3 | frontend_implementation, backend_implementation, integration_testing | true |
| `devops-engineer` | 3 | deployment_automation, monitoring_alerting, incident_response | true |
| `data-analyst` | 3 | data_analysis, insight_generation, reporting | true |
| `product-manager` | 8 (orchestration) | requirement_planning, roadmap_management, cross_team_alignment | true |
| `human-resources-manager` | 1 | talent_acquisition, performance_management, organization_development | true |
| `administrative-assistant` | 2 | administrative_coordination, meeting_support, document_management | true |
| `marketing-strategist` | 3 | campaign_planning, brand_communication, growth_optimization | true |
| `human-exclusive-assistant` | 4 | personal_schedule_management, task_followup, communication_drafting | true |
| `system-builtin-agent` | 19 (全部) | system_coordination, workflow_orchestration, platform_safeguard | true |
| `meeting-assistant` | 3 | meeting_monitoring, inactivity_warning, automatic_meeting_end | true |

**关键方法**:
- `buildAgentMcpProfiles()` (行585-599): 批量构建 agent MCP 视图，合并 agent 自身 tools + profile tools
- `toMcpProfile()` (行652-681): 生成最终 `AgentMcpProfile` 输出，包含 `capabilitySet = unique(agent.capabilities, profile.permissions)`
- `derivePermissionsFromTools()` (行735-747): 从工具反向推导权限（读取 tool.requiredPermissions）
- **Legacy Tool ID 别名映射** (行52-71): 12 个旧 ID → 新 canonical ID 的自动映射

---

### 5. Agent 工具权限管理

**`getAllowedToolIds()`** (`agent.service.ts:2181-2191`):
```typescript
private async getAllowedToolIds(agent: Agent): Promise<string[]> {
  const role = await this.getRoleById(agent.roleId);
  const profile = await this.agentMcpProfileService.getMcpProfileByRoleCode(role?.code);
  const merged = uniqueStrings(
    agent.tools,              // agent 自身配置的工具
    profile.tools,            // MCP profile 配置的工具
    [MEMO_MCP_SEARCH_TOOL_ID, MEMO_MCP_APPEND_TOOL_ID]  // 所有 agent 默认获得 memo 工具
  ).map(normalizeToolId);
  
  if (this.isCtoAgent(agent)) {  // CTO 额外获得代码读取工具
    return uniqueStrings(merged, [REPO_READ_TOOL_ID, CODE_DOCS_READER_TOOL_ID, CODE_UPDATES_READER_TOOL_ID]);
  }
  return merged;
}
```

**三层工具绑定机制**:
1. **Agent 层** (`agent.tools[]`): 直接绑定在 agent document 上
2. **Profile 层** (`AgentProfile.tools[]`): 按 roleCode 查找，所有同角色 agent 共享
3. **默认注入层**: 所有 agent 自动获得 memo search/append 工具

**工具授权检查** (`tool.service.ts:882-948`):
- 验证 agent 存在且激活
- JWT scope 检查 (`tool:execute:*` 或 `tool:execute:<toolId>`)
- 严格模式下检查 agent.tools 是否包含该工具
- 验证 tool.requiredPermissions 是否被 agent.permissions + role profile permissions 覆盖

**OpenCode 执行权限** (`agent-opencode-policy.service.ts:45`):
```typescript
const OPENCODE_ALLOWED_ROLE_CODES = new Set(['devops-engineer', 'fullstack-engineer', 'technical-architect']);
```
只有这 3 个角色允许通过 OpenCode 执行代码。

---

### 6. Orchestration Create-Plan 中 plannerAgentId 的传入

**文件**: `orchestration-tool-handler.service.ts:175-232`

```typescript
async createOrchestrationPlan(params: {
  prompt?: string;
  title?: string;
  mode?: 'sequential' | 'parallel' | 'hybrid';
  plannerAgentId?: string;   // ← 由 LLM 工具调用时传入
  autoRun?: boolean;
  requirementId?: string;
}, agentId?, executionContext?)
```

**流程**:
1. `plannerAgentId` 是 **LLM 在调用工具时可选传入的参数**（定义于 `builtin-tool-catalog.ts:390`）
2. 直接透传到 orchestration API payload（行219）: `{ plannerAgentId: params.plannerAgentId }`
3. 后端 `POST /plans/from-prompt` 接收后存入 `plan.strategy.plannerAgentId`

**计划执行时的 plannerAgentId 解析** (`orchestration-tool-handler.service.ts:101-120`):
```typescript
private resolvePlanExecutorId(plan: any): string {
  // 优先: plan.strategy.plannerAgentId
  const plannerAgentId = plan?.strategy?.plannerAgentId;
  if (plannerAgentId) return plannerAgentId;
  
  // 回退: 第一个 agent 类型的 task assignment
  const taskAssignments = plan.tasks.filter(t => t.assignment.executorType === 'agent');
  if (taskAssignments.length) return taskAssignments[0].executorId;
  
  throw new Error('plan has no executable agent context');
}
```

**种子计划中的用法** (`backend/scripts/system-schedule-seed.ts:312`):
```typescript
plannerAgentId: 'executive-lead'  // CTO 每日需求整理计划
```

---

### 7. Agent 能力评估/匹配现有代码

**存在**: `ExecutorSelectionService` (`backend/src/modules/orchestration/services/executor-selection.service.ts:1-193`)

**匹配算法** (行50-56):
```typescript
const agentCandidates = agents.map(agent => {
  const context = `${agent.name} ${agent.description} ${(agent.capabilities || []).join(' ')}`.toLowerCase();
  const score = keywords.reduce((acc, kw) => context.includes(kw) ? acc + 1 : acc, 0);
  return { id, score };
}).sort((a, b) => b.score - a.score);
```

**这是一个纯关键词匹配的简单评分模型**:
- 将 task title + description 分词为 keywords（最多 20 个，长度 >= 2）
- 对每个 agent 拼接 name + description + capabilities 为上下文
- 每命中一个 keyword 加 1 分
- 按分数排序，最高分 agent 获胜

**特殊路由**:
- Email 任务: 优先路由到有 gmail/email 工具的 agent，否则路由到人类 (行69-92)
- Research 任务: 优先路由到有 websearch/webfetch 工具的 agent (行94-103)
- 无匹配时: fallback 到第一个 active agent (行106-113)

**不存在的模式**: `capabilityMatch`, `agentMatch`, `agentSelect`, `chooseAgent`, `pickAgent`, `findBestAgent`, `agentRouting`, `agentDispatch` — 搜索结果为空。当前只有 `executor-selection.service.ts` 这一处能力匹配逻辑。

---

### 8. Builtin Tool Catalog 结构

**文件**: `backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts` (756行)

**每个工具的定义结构**:
```typescript
{
  id: string;                    // canonical ID (如 'builtin.web-retrieval.internal.web-search.exa')
  name: string;                  // 显示名
  description: string;           // 功能描述
  prompt?: string;               // 工具使用策略提示词 (注入 system message)
  type: 'web_search' | 'data_analysis' | 'api_call';
  category: string;              // 分类标签
  requiredPermissions: Array<{   // 所需权限
    id: string;
    name: string;
    level: 'basic' | 'intermediate' | 'admin';
  }>;
  tokenCost: number;             // token 消耗成本
  implementation: {
    type: 'built_in';
    parameters: Record<string, string>;  // 参数名 → 类型字符串
  };
}
```

**ID 命名规范**: `{来源}.{领域}.{类型}.{子域}.{动作}`
- `builtin.web-retrieval.internal.web-search.exa`
- `composio.communication.mcp.slack.send-message`
- `builtin.sys-mg.mcp.orchestration.create-plan`

**工具分类 (category)**:
| Category | 工具数量 |
|---|---|
| Information Retrieval | 4 |
| Communication | 2 |
| Engineering Intelligence | 6 |
| System Intelligence | 2 |
| Model Management | 2 |
| Memory | 2 |
| Skill | 2 |
| Audit | 1 |
| Orchestration | 10 |
| Meeting | 3 |

**总计 34 个内置工具**。

**工具常量定义** (`builtin-tool-definitions.ts:1-48`):
- `AGENT_LIST_TOOL_ID` / `LEGACY_AGENT_LIST_TOOL_ID` / `AGENT_CREATE_TOOL_ID` / `RD_DOCS_WRITE_TOOL_ID`
- `VIRTUAL_TOOL_IDS`: 7 个虚拟工具类型
- `DEPRECATED_TOOL_IDS`: 28 个已废弃工具 ID

---

### 总结：关键架构发现

1. **角色系统是双层的**: `AgentRole`（agent_roles 集合）定义角色元数据 + `AgentProfile`（agent_profiles 集合）定义 MCP 工具/权限绑定，通过 `roleCode` 关联
2. **能力模型是静态标签式的**: `capabilities[]` 是自由字符串数组，无结构化评估
3. **Agent 匹配极其简单**: 只有 keyword overlap scoring（`executor-selection.service.ts`），没有语义匹配、没有 embedding、没有能力权重
4. **plannerAgentId 是 LLM 自主决定的**: 没有自动选择逻辑，完全依赖 LLM 在工具调用时传入
5. **工具权限是三层合并**: agent.tools + profile.tools + 默认 memo 工具，CTO 有硬编码特权
6. **没有通用的 agent 能力评估框架**: 不存在 capability scoring、agent ranking、智能路由等机制
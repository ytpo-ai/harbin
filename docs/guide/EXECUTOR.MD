---
在 /Users/van/Workspace/harbin 项目中，深入分析 executor 选择（任务分配）的完整链路和上下文。我需要了解：

1. `ExecutorSelectionService` 被调用的所有位置（搜索 selectExecutor, executorSelection）
2. orchestration.service.ts 中 generatePlanTasksAsync 的完整逻辑（从 L200 到 L400），特别关注：
   - plannerAgentId 是否在任何地方被用于 executor 分配决策
   - 是否有任何"角色匹配"或"能力校验"的逻辑
3. Agent schema 中的能力描述字段（capabilities, tools, skills, description 等）
4. 是否存在 agent 角色（role）的概念（搜索 role, agentRole, agent-role）
5. orchestration task 执行时（executeTaskNode），executor 的确认和降级逻辑
6. 是否有 agent 工具权限校验的现有实现（搜索 hasPermission, checkCapability, validateTools）
7. requirement 模块中的 assign 逻辑（搜索 requirement assign, 看分配需求时是否有能力匹配）

请返回所有关键代码片段和行号。搜索深度：very thorough
---

## Executor 选择（任务分配）完整链路深度分析

### 1. `ExecutorSelectionService` 被调用的所有位置

**文件**: `/Users/van/Workspace/harbin/backend/src/modules/orchestration/services/executor-selection.service.ts` (完整 193 行)

调用点共 **3 处**，全部在 `orchestration.service.ts` 中：

| 调用位置 | 文件/行号 | 方法 | 场景 |
|---------|----------|------|------|
| 1 | `orchestration.service.ts` L264 | `generatePlanTasksAsync` | 创建新计划时，遍历每个 planner 产出的子任务，调用 `selectExecutor(title, description)` |
| 2 | `orchestration.service.ts` L520 | `replanPlan` | 重新规划时，遍历每个子任务调用 `selectExecutor(title, description)` |
| 3 | `orchestration.service.ts` L1397 | `executeTaskNode` | 执行阶段，对 external action 任务调用 `hasEmailExecutionCapability(assignment.executorId)` 做运行时能力校验 |

注入声明在：
- `orchestration.service.ts` **L35** (import), **L84** (constructor 注入)
- `orchestration.module.ts` **L28** (import), **L54** (providers 注册)

此外，`orchestration.service.ts` **L2149-2256** 还保留了一个 **旧版 `private selectExecutor` 方法**（dead code），与 `ExecutorSelectionService.selectExecutor` 逻辑完全相同，属于重构时未清理的历史残留。

---

### 2. `generatePlanTasksAsync` 完整逻辑 (L209-L407)

**文件**: `/Users/van/Workspace/harbin/backend/src/modules/orchestration/orchestration.service.ts`

```
L209: private async generatePlanTasksAsync(planId, dto)
```

**执行流程**:

1. **L210-213**: 查询 plan，获取 `requirementId`
2. **L219**: 设置 plan 状态为 `'drafting'`
3. **L226-231**: 调用 `plannerService.planFromPrompt()`，传入：
   - `prompt`: 原始需求
   - `mode`: dto.mode 或 plan.strategy.mode
   - `plannerAgentId`: **dto.plannerAgentId 或 plan.strategy.plannerAgentId**
   - `requirementId`
4. **L237-257**: 更新 plan 的 strategy（写回 plannerAgentId 和 mode）
5. **L262-353**: **遍历每个 planningTask**:
   - **L264**: 调用 `executorSelectionService.selectExecutor(planningTask.title, planningTask.description)`
   - **L266-288**: 创建 OrchestrationTask，`assignment` 直接使用 selectExecutor 返回值
   - **L273**: 状态根据 executorType 决定 (`'unassigned'` -> `'pending'`，否则 -> `'assigned'`)
6. **L355-357**: 刷新统计，设置 plan 状态为 `'planned'`
7. **L377-384**: 如果 `dto.autoRun`，自动启动 `runPlanAsync`

#### plannerAgentId 是否用于 executor 分配决策？

**结论：完全不参与 executor 分配决策。**

- `plannerAgentId` 仅在 **L226-229** 传给 `plannerService.planFromPrompt()`，用于选择 **哪个 agent 来做任务拆解（规划）**
- `plannerService.planFromPrompt()` (planner.service.ts L29-52) 用 plannerAgentId 调用 agent 生成任务 JSON，然后返回 tasks 数组
- **selectExecutor 的入参只有 `title` 和 `description`** (L264)，不接收 plannerAgentId、roleId 或任何 agent 上下文
- plannerAgentId 最终只写入 `plan.strategy.plannerAgentId` 做记录 (L243)

#### 是否有"角色匹配"或"能力校验"逻辑？

**结论：仅有基于关键词的朴素文本匹配，没有正式的角色匹配或能力校验。**

`ExecutorSelectionService.selectExecutor()` (L26-133) 的完整算法：

```typescript
// L30-36: 任务分类（仅邮件/研究两种硬编码类别）
const emailTask = taskClassificationService.isEmailTask(title, description);
const researchTask = taskClassificationService.isResearchTask(title, description);
const keywords = text.split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/).filter(len>=2).slice(0,20);

// L38-45: 加载全部 active agents + active/probation employees
const [agents, employees] = await Promise.all([...]);

// L50-56: Agent 打分 —— 关键词 ∈ (name + description + capabilities) 的命中数
const score = keywords.reduce((acc, kw) => context.includes(kw) ? acc+1 : acc, 0);

// L58-64: Employee 打分 —— 关键词 ∈ (name + title + description + capabilities)
```

**选择优先级**:
1. **邮件任务** (L69-92): 优先找有 email tool 的 agent -> 降级到人类 -> unassigned
2. **调研任务** (L94-103): 优先找有 websearch/webfetch/content_extract 工具的 agent
3. **通用** (L105-132): 比较 bestAgent.score vs bestEmployee.score
   - 两者都为 0 -> fallback 到第一个 active agent (L106-113)
   - agent 分数 >= employee 分数 -> 选 agent (L120-126)
   - 否则 -> 选 employee (L128-132)

**关键缺陷**:
- **不读取 `roleId`、`AgentRole.capabilities`、`AgentProfile` 的任何数据**
- 只用 `agent.capabilities` 字符串数组做关键词包含匹配（不是语义匹配）
- 没有考虑 agent 当前负载、历史表现、权限
- 没有利用 `agent.tools` 做通用能力推断（只有邮件和调研两种硬编码场景）

---

### 3. Agent Schema 中的能力描述字段

#### Agent Schema (`/Users/van/Workspace/harbin/backend/src/shared/schemas/agent.schema.ts`)

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `name` | `string` | L17 | Agent 名称 |
| `roleId` | `string` | L20 | 关联的角色ID |
| `description` | `string` | L23 | Agent 描述 |
| `capabilities` | `string[]` | L57 | 能力标签列表（executor selection 使用此字段做关键词匹配） |
| `tools` | `string[]` | L69 | 可使用的工具ID列表 |
| `skills` | `string[]` | L72 | 已启用的技能ID列表 |
| `permissions` | `string[]` | L75 | 权限ID列表 |
| `systemPrompt` | `string` | L60 | 系统提示词 |
| `personality` | `object` | L77-88 | 个性维度 (workEthic, creativity, leadership, teamwork 各 0-100) |
| `learningAbility` | `number` | L91 | 学习能力 0-100 |

#### AgentRole Schema (`/Users/van/Workspace/harbin/backend/src/shared/schemas/agent-role.schema.ts`)

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `code` | `string` | L14 | 角色编码（如 `executive-lead`, `fullstack-engineer`） |
| `name` | `string` | L17 | 角色名称 |
| `description` | `string` | L20 | 角色描述 |
| `capabilities` | `string[]` | L24 | 角色级能力标签 |
| `tools` | `string[]` | L27 | 角色级工具 |
| `promptTemplate` | `string` | L30 | 提示词模板 |
| `status` | `active/inactive` | L33 | 状态 |

#### AgentProfile Schema (`/Users/van/Workspace/harbin/backend/src/shared/schemas/agent-profile.schema.ts`)

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `roleCode` | `string` | L9 | 角色编码 |
| `role` | `string` | L12 | 角色名 |
| `tools` | `string[]` | L15 | 工具列表 |
| `permissions` | `string[]` | L18 | 权限 |
| `permissionsManual` | `string[]` | L21 | 手动权限 |
| `permissionsDerived` | `string[]` | L24 | 派生权限 |
| `capabilities` | `string[]` | L27 | 能力标签 |
| `exposed` | `boolean` | L30 | 是否暴露给 MCP |
| `description` | `string` | L33 | 描述 |

**关键发现**: AgentRole 和 AgentProfile 的 `capabilities`、`tools` 字段在 executor selection 中 **完全未被使用**。`ExecutorSelectionService` 只读 `agent.capabilities`（实体级），而 role 级和 profile 级的能力数据被浪费了。

---

### 4. Agent 角色（Role）概念

**存在完整的 Role 体系**，但在 executor selection 中未使用。

#### 角色模型层次：
```
Agent (agent.schema.ts)
  └── roleId -> AgentRole (agent-role.schema.ts)
                  └── code -> AgentProfile (agent-profile.schema.ts)
```

#### 预定义角色种子 (`/Users/van/Workspace/harbin/backend/src/modules/roles/roles.service.ts` L14-40):

| agentType | roleCode | roleName |
|-----------|----------|----------|
| ai-executive | executive-lead | 高管 |
| ai-management-assistant | management-assistant | 高管助理 |
| ai-technical-expert | technical-architect | 技术专家 |
| ai-fullstack-engineer | fullstack-engineer | 全栈工程师 |
| ai-devops-engineer | devops-engineer | 运维工程师 |
| ai-data-analyst | data-analyst | 数据分析师 |
| ai-product-manager | product-manager | 产品经理 |
| ai-hr | human-resources-manager | HR |
| ai-admin-assistant | administrative-assistant | 行政助理 |
| ai-marketing-expert | marketing-strategist | 营销专家 |
| ai-human-exclusive-assistant | human-exclusive-assistant | 人类专属助理 |
| ai-system-builtin | system-builtin-agent | 系统内置 |
| ai-meeting-assistant | meeting-assistant | 会议助理 |

#### Role 在代码中的使用位置（非 executor selection）：
- `agent.service.ts` L440, L790, L1015, L2182, L2267: 构建 MCP profile、获取 agent 详情时读取 role
- `tool.service.ts` L934: 工具执行权限校验时调用 `resolveRoleAndProfilePermissions(agent.roleId)`
- `agent-mcp-profile.service.ts` L589-625: 构建 MCP 对外暴露的 agent 能力画像
- `identity-aggregation.service.ts` L95: 构建 agent 身份描述时包含 roleId

---

### 5. executeTaskNode 中 executor 的确认和降级逻辑

**文件**: `/Users/van/Workspace/harbin/backend/src/modules/orchestration/orchestration.service.ts` **L1277-1666**

完整的决策树：

```
executeTaskNode(planId, task)
│
├── L1282: assignment = task.assignment || { executorType: 'unassigned' }
├── L1283-1286: 任务分类（isExternalAction, isResearchTask, isReviewTask）
│
├── [L1327] executorType === 'employee'?
│   └── YES -> status='waiting_human', return  ← 【降级1: 人工处理】
│
├── [L1363] executorType !== 'agent' || !executorId?
│   ├── [L1364] isExternalAction?
│   │   └── YES -> status='waiting_human'      ← 【降级2: 外部动作无agent时转人工】
│   └── NO -> status='failed' ("No agent assigned")  ← 【失败: 无agent可用】
│
├── [L1396] isExternalAction?
│   └── YES -> hasEmailExecutionCapability(executorId)?
│       └── NO -> status='waiting_human' ("Agent lacks email tool capability")
│                                                ← 【降级3: agent无邮件工具时转人工】
│
├── [L1427-1443] 提交异步 Agent Task (createAsyncAgentTask)
├── [L1467] 等待结果 (waitForAsyncAgentTaskResult)
│
├── [L1474-1498] isResearchTask? → validateResearchOutput → 不通过则 'failed'
├── [L1500-1524] isReviewTask? → validateReviewOutput → 不通过则 'failed'
├── [L1526-1550] isExternalAction? → extractEmailSendProof → 无证据则 'waiting_human'
│                                                ← 【降级4: 执行后无发送证据时转人工确认】
├── [L1552-1571] codeTask? → validateCodeExecutionProof → 只记warning不阻断
│
└── [L1573-1628] → status='completed'
```

**关键发现**:
- **没有运行时的 executor 降级/重选逻辑** — 如果选定的 agent 不合适，不会自动换一个 agent
- 降级只有两种出路：`'waiting_human'`（等人工介入）或 `'failed'`（直接失败）
- **唯一的运行时能力校验**只针对"邮件发送"能力 (L1396-1414)
- 不检查 agent 是否有 research 工具（即使是 research 任务）
- 不检查 agent 的 role、skill、permission 是否匹配任务需求

---

### 6. Agent 工具权限校验的现有实现

**`hasPermission` / `checkCapability` / `validateTools` 这些具体方法名不存在**，但工具权限校验在 `tool.service.ts` 中有完整实现：

**文件**: `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/tools/tool.service.ts` **L890-948**

这是 **agent 执行工具时的权限校验**（不是 executor selection 阶段的，而是工具实际执行时的）：

```typescript
// L912-916: Scope 校验（JWT token scope）
if (scopeSet.size > 0 && !scopeSet.has('tool:execute:*') 
    && !scopeSet.has(`tool:execute:${resolvedToolId}`)) {
  throw new Error(`Tool scope denied: ${resolvedToolId}`);
}

// L918-924: 工具分配校验（agent.tools 白名单）
const assignedToolIds = new Set(agent.tools || []);
const enforceAssignment = strict || authMode === 'jwt' || assignedToolIds.size > 0;
if (enforceAssignment && !assignedToolIds.has(resolvedToolId)) {
  throw new Error(`Tool not assigned: ${resolvedToolId}`);
}

// L926-948: 权限校验（合并 agent.permissions + role permissions + profile permissions）
const requiredPermissions = tool.requiredPermissions.map(p => p.id);
if (requiredPermissions.length) {
  const roleBasedPermissions = await this.resolveRoleAndProfilePermissions(agent.roleId);
  const granted = new Set([
    ...agent.permissions,
    ...roleBasedPermissions,          // role capabilities + profile permissions
    ...executionContext?.auth?.permissions
  ]);
  const missing = requiredPermissions.filter(p => !granted.has(p));
  if (missing.length) {
    throw new Error(`Tool permission denied: missing=${missing.join(',')}`);
  }
}
```

**`resolveRoleAndProfilePermissions`** (L951-1009): 查询 AgentRole（获取 role.permissions/capabilities）+ AgentProfile（获取 profile.permissions/permissionsManual/permissionsDerived/capabilities），合并返回权限列表，带本地缓存。

**关键发现**: 这套权限校验 **只在工具执行阶段** 起作用。ExecutorSelectionService 在 **分配 executor 时完全不检查目标 agent 是否拥有完成任务所需的工具权限**。也就是说，一个 agent 可能被分配了一个需要 `requirement_write` 权限的任务，但在分配时不做校验，只有在实际执行工具调用时才会报错 `Tool permission denied`。

---

### 7. Requirement 模块中的 assign 逻辑

**完整调用链**:

```
builtin-tool-catalog.ts L633:
  工具定义 'builtin.sys-mg.mcp.requirement.assign'
  requiredPermissions: [{ id: 'requirement_write' }]
    │
    ▼
tool.service.ts L1269-1270:
  case 'builtin.sys-mg.mcp.requirement.assign':
    return requirementToolHandler.assignRequirement(params, agentId, ctx)
    │
    ▼
requirement-tool-handler.service.ts L165-200:
  async assignRequirement(params, agentId, executionContext)
    - 校验 requirementId 和 toAgentId 必填
    - 调用 EI API: POST /requirements/{id}/assign
    - 不做任何能力匹配
    │
    ▼
requirements.controller.ts L46-48:
  @Post(':requirementId/assign')
    │
    ▼
ei.service.ts L1363-1402:
  async assignRequirement(requirementId, payload)
    - 查找 requirement
    - 创建 assignment 记录（toAgentId, toAgentName, reason...）
    - 设置 requirement.status = 'assigned'
    - 记录 statusHistory
    - 保存
```

**关键发现**: Requirement assign 逻辑 **完全没有能力匹配**：
- 不检查目标 agent 是否 active
- 不检查目标 agent 的 role、capabilities、tools 是否适合该需求
- 不检查目标 agent 的当前负载
- 只是简单地把 `toAgentId` 写入 requirement 的 `currentAssigneeAgentId`
- 需求分配是一个**纯赋值操作**，由调用方（通常是另一个 agent）自行决定分配给谁

---

### 总结：系统级架构缺陷图谱

```
┌─────────────────────────────────────────────────────────────────┐
│                  EXECUTOR 选择完整链路                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. PLANNING 阶段                                               │
│     plannerService.planFromPrompt(plannerAgentId)               │
│       └── plannerAgentId 只用于"谁来做规划"                       │
│           ❌ 不参与后续 executor 分配                              │
│                                                                 │
│  2. EXECUTOR SELECTION 阶段                                     │
│     executorSelectionService.selectExecutor(title, description)  │
│       ├── 输入：仅 title + description 文本                      │
│       ├── 算法：关键词分词 → 文本包含匹配 → 计分                   │
│       ├── 候选池：all active agents + active employees           │
│       ├── Agent打分字段：name + description + capabilities        │
│       │   ❌ 不读取 roleId / AgentRole / AgentProfile             │
│       │   ❌ 不读取 tools（仅邮件/调研两种硬编码场景例外）           │
│       │   ❌ 不读取 skills / permissions / personality            │
│       │   ❌ 不读取 systemPrompt                                  │
│       ├── 特殊路由：                                              │
│       │   ✅ emailTask → 找有 gmail/email tool 的 agent           │
│       │   ✅ researchTask → 找有 websearch/webfetch tool 的 agent │
│       └── 降级：score=0 → fallback 到第一个 active agent          │
│                                                                 │
│  3. EXECUTION 阶段 (executeTaskNode)                             │
│     ├── 运行时能力校验：                                          │
│     │   ✅ isExternalAction → hasEmailExecutionCapability          │
│     │   ❌ 其他类型任务不做预执行能力校验                           │
│     ├── 降级策略：                                                │
│     │   employee → waiting_human                                  │
│     │   unassigned + external → waiting_human                     │
│     │   unassigned + !external → failed                           │
│     │   agent 无邮件能力 → waiting_human                          │
│     │   ❌ 不支持"换一个 agent 重试"                              │
│     └── 工具执行阶段权限校验（tool.service.ts）：                   │
│         ✅ tool scope 校验                                        │
│         ✅ tool assignment 白名单校验                              │
│         ✅ role + profile permission 合并校验                      │
│         ❌ 但这是执行后才发现，不是分配时预防                       │
│                                                                 │
│  4. REQUIREMENT ASSIGN                                           │
│     ❌ 纯赋值操作，无任何能力匹配                                  │
│                                                                 │
│  5. 手动 REASSIGN (reassignTask L954-1013)                       │
│     ❌ 纯赋值操作，不校验目标 executor 能力                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**核心问题**：系统拥有丰富的角色/能力/权限元数据（Agent.capabilities, Agent.tools, Agent.skills, Agent.permissions, AgentRole.capabilities, AgentRole.tools, AgentProfile.capabilities, AgentProfile.permissions），但 executor selection 阶段几乎没有利用这些数据，仅做了最简单的关键词文本匹配。权限校验只在工具实际执行时才触发，导致"分配-执行"之间存在断层。
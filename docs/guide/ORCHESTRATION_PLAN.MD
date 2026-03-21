---
探索 /Users/van/Workspace/harbin 项目中与 orchestration plan 编排相关的代码结构。我需要了解以下内容：

1. 项目整体目录结构（顶层和 apps/ 下的子项目）
2. orchestration 相关的模块/文件位置（搜索关键词：orchestration, plan, planner, create-plan）
3. plan 创建时 task assignee/executor 的分配逻辑在哪里（搜索 assignee, executor, plannerAgentId 相关代码）
4. skill 技能系统相关代码位置（搜索 skill, orchestration-planner-guard, enabled-skills）
5. session/task 消息构建逻辑（搜索 system message, prompt 组装相关代码，理解为什么 prompt 会重复出现）

请尽量全面搜索，返回：
- 关键文件路径及其职责
- orchestration plan 创建的核心代码流程
- task executor 分配的具体逻辑
- skill 加载/注入机制
- session 消息构建的代码位置
---

# Orchestration Plan 编排系统代码结构分析

## 1. 项目整体目录结构

```
/Users/van/Workspace/harbin/
├── AGENTS.md                 # AI Agent 开发协议
├── backend/                  # 后端 (Nest.js + TypeScript + MongoDB)
│   ├── src/                  # 主应用（Legacy 服务）
│   │   ├── modules/
│   │   │   └── orchestration/   # 核心编排模块
│   │   └── shared/
│   │       └── schemas/         # MongoDB Schema 定义
│   ├── apps/                 # 微服务子应用
│   │   ├── agents/           # Agent 运行时服务
│   │   ├── ei/               # Engineering Intelligence（研发智能）
│   │   ├── gateway/          # API 网关
│   │   ├── legacy/           # 旧版主服务
│   │   └── ws/               # WebSocket 服务
│   ├── libs/                 # 共享库
│   └── scripts/              # 脚本
├── frontend/                 # 前端 (React + TypeScript)
│   └── src/
│       └── services/
│           └── orchestrationService.ts
├── docs/                     # 文档
└── data/                     # 数据
```

**注意：项目没有 `apps/` 顶层目录，子项目均位于 `backend/apps/` 下。**

---

## 2. Orchestration 相关的模块/文件位置总览

### 核心模块（Legacy 服务端）

| 文件 | 职责 |
|------|------|
| `/Users/van/Workspace/harbin/backend/src/modules/orchestration/orchestration.module.ts` | 模块注册，汇聚所有 Provider 和 Controller |
| `/Users/van/Workspace/harbin/backend/src/modules/orchestration/orchestration.controller.ts` | REST API 控制器，路由前缀 `orchestration` |
| `/Users/van/Workspace/harbin/backend/src/modules/orchestration/orchestration.service.ts` | **核心服务（2727行）**，Plan CRUD、Task 执行、依赖处理、SSE 事件流 |
| `/Users/van/Workspace/harbin/backend/src/modules/orchestration/planner.service.ts` | Plan 任务拆解引擎（Agent 拆解 / 启发式 fallback） |
| `/Users/van/Workspace/harbin/backend/src/modules/orchestration/session-manager.service.ts` | Plan Session 管理（创建、追加消息、归档） |
| `/Users/van/Workspace/harbin/backend/src/modules/orchestration/dto/index.ts` | DTO 定义（CreatePlanFromPromptDto 等） |

### 辅助服务

| 文件 | 职责 |
|------|------|
| `/Users/van/Workspace/harbin/backend/src/modules/orchestration/services/executor-selection.service.ts` | **Executor 分配核心逻辑**（关键词匹配 + 能力路由） |
| `/Users/van/Workspace/harbin/backend/src/modules/orchestration/services/task-classification.service.ts` | 任务类型分类（email/research/review/code） |
| `/Users/van/Workspace/harbin/backend/src/modules/orchestration/services/task-output-validation.service.ts` | 任务输出验证（research proof / email proof / code proof） |

### 调度子模块

| 文件 | 职责 |
|------|------|
| `/Users/van/Workspace/harbin/backend/src/modules/orchestration/scheduler/scheduler.service.ts` | 定时/周期性计划调度 |
| `/Users/van/Workspace/harbin/backend/src/modules/orchestration/scheduler/scheduler.controller.ts` | 调度 API |
| `/Users/van/Workspace/harbin/backend/src/modules/orchestration/scheduler/scheduler.module.ts` | 调度模块注册 |

### Schema 定义

| 文件 | 职责 |
|------|------|
| `/Users/van/Workspace/harbin/backend/src/shared/schemas/orchestration-plan.schema.ts` | Plan 数据模型（strategy.plannerAgentId, mode, stats） |
| `/Users/van/Workspace/harbin/backend/src/shared/schemas/orchestration-task.schema.ts` | Task 数据模型（assignment: {executorType, executorId}, dependencyTaskIds, runLogs） |
| `/Users/van/Workspace/harbin/backend/src/shared/schemas/orchestration-plan-session.schema.ts` | PlanSession 快照模型（task 执行状态追踪） |
| `/Users/van/Workspace/harbin/backend/src/shared/schemas/orchestration-schedule.schema.ts` | 定时调度模型 |

### Agent 服务端（工具调用层）

| 文件 | 职责 |
|------|------|
| `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/tools/orchestration-tool-handler.service.ts` | Agent 通过 MCP tool 调用编排 API 的处理器 |
| `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/tools/tool.service.ts` | 工具调度中心，`dispatchOrchestrationToolImplementation()` 方法路由到各编排工具 |
| `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts` | 内置工具注册表（定义了所有 `builtin.sys-mg.mcp.orchestration.*` 工具） |
| `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/tools/internal-api-client.service.ts` | Agent 服务调用 Legacy 服务的 HTTP 客户端 |
| `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent-orchestration-intent.service.ts` | 会议场景编排意图识别与强制触发 |
| `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent-mcp-profile.service.ts` | Agent MCP Profile 管理，工具 ID 别名映射 |

### Agent 消息构建与执行

| 文件 | 职责 |
|------|------|
| `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent.service.ts` | **Agent 核心服务**，`buildMessages()` 构建 system prompt，`executeTask()` 执行任务 |
| `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent-executor-runtime.service.ts` | 运行时执行上下文管理 |
| `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts` | Session 消息持久化，去重（`buildSystemContextKey`） |

### 前端

| 文件 | 职责 |
|------|------|
| `/Users/van/Workspace/harbin/frontend/src/services/orchestrationService.ts` | 前端 API 封装（createPlanFromPrompt, runPlan, reassignTask 等） |

---

## 3. Orchestration Plan 创建核心代码流程

### 入口：`POST /orchestration/plans/from-prompt`

```
[前端] orchestrationService.createPlanFromPrompt(payload)
  → [Controller] orchestration.controller.ts :: createPlanFromPrompt()
    → [Service] orchestration.service.ts :: createPlanFromPrompt(userId, dto)
```

### 创建流程（`orchestration.service.ts` L89-153）：

1. **创建 Plan 文档**（status = `drafting`）
   - 存入 `orchestration_plans` 集合
   - 包含 `strategy.plannerAgentId`, `strategy.mode`, `sourcePrompt`
   
2. **创建 PlanSession 文档**（用于状态追踪快照）

3. **发射 SSE 事件** `plan.status.changed`

4. **异步触发** `generatePlanTasksAsync(planId, dto)` — 使用 `setTimeout(fn, 0)` 非阻塞执行

5. **立即返回** Plan 对象给前端

### 异步任务生成（`generatePlanTasksAsync` L209-410）：

```
generatePlanTasksAsync(planId, dto)
  ├── 1. 调用 plannerService.planFromPrompt() 进行任务拆解
  │     ├── 优先使用 dto.plannerAgentId 指定的 Agent
  │     ├── 若无指定，使用数据库中第一个 active Agent
  │     └── 若 Agent 拆解失败，fallback 到启发式拆解 (planByHeuristic)
  │
  ├── 2. 遍历拆解结果的每个 task：
  │     ├── 调用 executorSelectionService.selectExecutor() 分配执行者
  │     ├── 创建 OrchestrationTask 文档
  │     ├── 设置 dependencyTaskIds（任务依赖关系）
  │     ├── 更新 Plan 的 taskIds 和 stats
  │     └── 发射 SSE 事件 task.created
  │
  ├── 3. 更新 Plan status → 'planned'
  │
  └── 4. 若 dto.autoRun === true，自动触发 runPlanAsync()
```

### PlannerService 拆解逻辑（`planner.service.ts`）：

**Agent 拆解**（`planByAgent`）：
- 构造一个 `AgentExecutionTask`，类型为 `planning`
- prompt 要求 Agent 输出 JSON：`{"mode":"...","tasks":[{"title","description","priority","dependencies"}]}`
- 限制 3-8 条任务
- 调用 `agentClientService.executeTask(plannerAgentId, task)` 执行
- 解析返回的 JSON，构造 `PlannerTaskDraft[]`
- 执行 `optimizeDependencies()` 优化邮件类任务的依赖关系

**启发式 fallback**（`planByHeuristic`）：
- 按中文/英文标点分割 prompt 为多个 block
- 每个 block 生成一个任务（sequential 依赖链）
- 若无法分割则使用默认 4 步骤模板

---

## 4. Task Executor 分配的具体逻辑

### 核心位置：`/Users/van/Workspace/harbin/backend/src/modules/orchestration/services/executor-selection.service.ts`

`selectExecutor(title, description)` 方法：

1. **任务分类**：
   - `TaskClassificationService.isEmailTask()` — 检测邮件任务（含 `send email`, `gmail`, `@` 等关键词）
   - `TaskClassificationService.isResearchTask()` — 检测调研任务（含 `research`, `search`, `调研` 等）

2. **收集候选者**：
   - 查询所有 `isActive: true` 的 Agent
   - 查询所有 `ACTIVE/PROBATION` 状态的 Employee

3. **能力路由矩阵**：

| 条件 | 分配策略 |
|------|----------|
| Email 任务 + 有 email tool 的 Agent | → `agent` (优先分配给有 gmail/email 工具的 Agent) |
| Email 任务 + 无 email tool Agent | → `employee` (HUMAN 类型) 或 `unassigned` |
| Research 任务 + 有 websearch/webfetch 工具的 Agent | → `agent` (研究型 Agent) |
| 通用任务 + Agent 关键词得分最高 | → `agent` (关键词匹配打分) |
| 通用任务 + Employee 得分更高 | → `employee` |
| 所有候选者得分为 0 | → 第一个 active Agent (fallback) 或 `unassigned` |

4. **关键词打分算法**：
   - 将 task title + description 提取关键词（按非字母数字中文分割，取前20个）
   - 对每个 Agent/Employee 的 `name + description + capabilities` 文本进行关键词匹配计数
   - 按得分排序，最高分者获胜

5. **Email 能力检测**（`hasEmailExecutionCapability`）：
   - 查询 Agent 绑定的 Tool
   - 检查 tool 的 id/name/description/category 是否包含 `gmail`/`email`/`mail`

### 执行阶段的额外检查（`orchestration.service.ts :: executeTaskNode` L1277-1414）：

- 若 `executorType === 'employee'` → 直接标记 `waiting_human`
- 若 `executorType !== 'agent'` 且是外部动作 → 标记 `waiting_human`
- 若 Agent 分配但缺少 email 能力 → 降级为 `waiting_human`
- 正常 Agent 执行 → 创建 async agent task 并等待结果

---

## 5. Skill 技能系统加载/注入机制

### Skill 数据模型

| 文件 | 说明 |
|------|------|
| `/Users/van/Workspace/harbin/backend/apps/agents/src/schemas/agent-skill.schema.ts` | Skill MongoDB Schema（collection: `agent_skills`） |
| `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/skills/skill.service.ts` | Skill CRUD 服务 |
| `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/skills/skill.module.ts` | Skill 模块注册 |

### Agent 与 Skill 的关联

Agent Schema 中有 `skills?: string[]` 字段存储已启用的技能 ID 列表。

### Skill 加载流程（`agent.service.ts :: getEnabledSkillsForAgent` L1453-1505）：

```
getEnabledSkillsForAgent(agent, agentId)
  ├── 1. 检查 Redis 缓存 key: `agent:enabled-skills:${agentId}`
  │     └── 若命中 → 直接返回缓存中的 EnabledAgentSkillContext[]
  │
  ├── 2. 从 agent.skills[] 获取技能 ID 列表
  │
  ├── 3. 查询 MongoDB: agent_skills 集合
  │     └── 条件: id in skillIds, status in ['active', 'experimental']
  │
  ├── 4. 构造 EnabledAgentSkillContext[]
  │     └── { id, name, description, tags, proficiencyLevel: 'beginner' }
  │
  └── 5. 写入 Redis 缓存（TTL 由 AGENT_ENABLED_SKILL_CACHE_TTL_SECONDS 控制）
```

### Skill 注入到 Prompt（`agent.service.ts :: buildMessages` L1344-1359）：

```typescript
if (enabledSkills.length > 0) {
  const skillLines = enabledSkills
    .map(skill => `- ${skill.name} (id=${skill.id}, proficiency=${skill.proficiencyLevel}) | description=${skill.description} | tags=${skill.tags.join(', ')}`)
    .join('\n');

  messages.push({
    role: 'system',
    content: `Enabled Skills for this agent:\n${skillLines}\n\n请优先基于以上已启用技能的能力边界来拆解与执行任务，并在输出中体现对应技能的方法论。`,
  });
}
```

### Skill 缓存失效

缓存 key: `agent:enabled-skills:${agentId}`  
失效方式：在 `skill.service.ts` (L668) 中也定义了同样的缓存 key，技能变更时会清除缓存。

---

## 6. Session/Task 消息构建逻辑

### 核心问题：为什么 prompt 会重复出现？

消息构建发生在 `agent.service.ts :: buildMessages()` (L1313-1427)。该方法构建的消息序列如下：

```
buildMessages(agent, task, context, enabledSkills)
  ├── [system] agent.systemPrompt                          # Agent 系统提示
  ├── [system] 任务信息: 标题/描述/类型/优先级              # 任务上下文
  ├── [system] 团队上下文: JSON                             # 团队上下文（若有）
  ├── [system] Enabled Skills for this agent: ...          # 技能清单（若有）
  ├── [system] 你可以调用以下工具: JSON + 调用格式说明       # 工具声明
  ├── [system] 工具使用优先提示                              # 工具使用策略
  ├── [system] 工具使用策略（${toolId}）: prompt            # 各工具的 prompt（可能多条）
  ├── [system] 备忘录中检索到的相关记忆                     # Memory 上下文（若有）
  ├── [system] 身份与职责: identityMemos                   # 身份备忘录（若有）
  └── [...] context.previousMessages                       # 历史消息
```

**prompt 可能重复的原因分析**：

1. **`appendSystemMessagesToSession`** (`agent-executor-runtime.service.ts` L54-71)：在 `startRuntimeExecution` 之后，会将所有 system messages 再次追加到 Session 中。如果 Session 被复用（同一个 `sessionId`），历史中已有的 system messages 会与新追加的重叠。

2. **`runtime-persistence.service.ts :: buildSystemContextKey`** (L32-57)：这个方法尝试通过 content 生成去重 key，但仅处理了 `团队上下文:` 和会议标题两种模式，**大部分 system message（如工具声明、技能列表、任务描述）没有去重 key**，因此不会被去重。

3. **编排任务执行时的 prompt 构建**（`orchestration.service.ts :: buildTaskDescription` L1790-1834）：编排服务在执行 task 时会构建一个增强版 prompt（含依赖上下文、输出契约等），这个 prompt 作为 `taskPrompt` 传入 Agent。Agent 内部 `buildMessages()` 又会把 `task.description` 作为单独的 system message 注入，导致描述信息出现两次——一次在 task 描述中，一次在增强 prompt 中。

4. **工具 prompt 重复**：`buildToolPromptMessages()` (L1429-1451) 虽然做了 `seen` Set 去重，但如果同一个工具被多次注册（通过不同 canonical ID），仍可能产生重复。

### Orchestration Task Prompt 构建流程

```
orchestration.service.ts :: executeTaskNode()
  ├── buildDependencyContext()        # 收集前置任务的输出作为上下文
  ├── getRetryFailureHint()           # 获取上次失败的错误提示
  └── buildTaskDescription()          # 组装最终 prompt
        ├── baseDescription           # task.description 原文
        ├── + Dependency context      # 前置任务输出
        ├── + Previous failed hint    # 重试提示
        ├── + Research output contract # 调研任务输出契约（若是调研任务）
        ├── + Review output contract  # 审校任务输出契约（若是审校任务）
        └── + External action proof   # 外部动作证明要求（若是邮件等外部任务）
```

这个组装好的 `taskPrompt` 通过 `agentClientService.createAsyncAgentTask()` 作为 `prompt` 字段传给 Agent 服务。Agent 服务收到后，又在 `buildMessages()` 中把 `task.title` 和 `task.description` 作为 system message 再注入一遍，从而造成内容重复。

---

## 7. 关键流程总结图

```
用户 → 前端 → POST /orchestration/plans/from-prompt
                    │
                    ▼
         OrchestrationController.createPlanFromPrompt()
                    │
                    ▼
         OrchestrationService.createPlanFromPrompt()
          ├── 创建 Plan (status=drafting)
          ├── 创建 PlanSession
          └── setTimeout → generatePlanTasksAsync()
                              │
                              ▼
                    PlannerService.planFromPrompt()
                     ├── planByAgent() ─ Agent 拆解
                     │    └── agentClientService.executeTask()
                     │         └── AgentService.executeTask()
                     │              └── buildMessages() ← 注入 skills/tools/memory
                     └── planByHeuristic() ─ 启发式 fallback
                              │
                              ▼
                    循环每个 task:
                     ├── ExecutorSelectionService.selectExecutor()
                     │    ├── TaskClassification 分类
                     │    ├── 关键词打分
                     │    └── 能力路由 (email/research/通用)
                     ├── 创建 OrchestrationTask
                     └── SSE 推送 task.created
                              │
                              ▼
                    Plan status → planned
                    (若 autoRun) → runPlanAsync()
                                    │
                                    ▼
                              循环执行 task:
                               ├── buildTaskDescription() ← 组装增强 prompt
                               ├── executeTaskNode()
                               │    ├── employee → waiting_human
                               │    ├── agent → createAsyncAgentTask()
                               │    │            └── AgentService → buildMessages() ← 再次注入 skills/tools
                               │    └── 等待结果 (SSE/Polling)
                               └── 验证输出 (email proof / research proof)
```

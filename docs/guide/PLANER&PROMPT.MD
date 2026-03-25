# [TODO 重新整理] PLANER&PROMPT

> 状态：待重新整理（2026-03-24）
>
> 说明：本文为历史分析草稿，结构与内容需要按当前实现重新梳理后再作为正式参考。
>
> 当前实现参考：`docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD`、`docs/feature/ORCHETRATION_TASK.md`、`docs/feature/ORCHETRATION_SCHEDULER.md`。
---
探索 /Users/van/Workspace/harbin 项目中与 planner agent 任务拆解和 prompt 构建相关的代码。我需要了解：

1. planner agent 如何将用户需求拆解为 tasks（搜索 task decomposition, planner, plan task）
2. planner 输出的 JSON 如何被解析并转化为实际的 orchestration plan tasks（搜索 parse, JSON, tasks 创建）
3. 当 plan 被创建后，每个 task 的 executor 是怎么确定的（是 planner 指定的还是系统自动分配的）
4. session 消息组装逻辑 —— 用户消息和系统消息是怎么构建的，为什么 prompt 会在两个地方重复出现（搜索 buildMessages, prepareMessages, system prompt, user message 构建相关）
5. skill 的方法论/规则是如何注入到 LLM prompt 中的（搜索 skill inject, skill prompt, skill content）

请返回：
- 关键文件路径和行号
- 核心代码片段（特别是 executor 分配逻辑和 prompt 去重相关的代码）
- skill 注入的完整流程

搜索深度：very thorough
---

# Planner Agent 任务拆解 & Prompt 构建完整分析报告

## 完整分析报告

### 1. Planner Agent 任务拆解流程

#### 核心文件
- `/Users/van/Workspace/harbin/backend/src/modules/orchestration/planner.service.ts` (全文 221 行)

#### 流程概述

`PlannerService.planFromPrompt()` (L29-52) 是任务拆解的入口，采用三级降级策略：

1. **指定 planner agent** (L36-41)：如果传入了 `plannerAgentId`，调用 `planByAgent()` 让该 agent 通过 LLM 拆解任务
2. **默认 agent 降级** (L43-49)：没有指定 planner 时，查找最早创建的活跃 agent 作为 planner
3. **启发式降级** (L51)：如果 agent 均不可用，用 `planByHeuristic()` 按标点符号拆分

#### planner prompt 构造 (L60-80)

```typescript
// /Users/van/Workspace/harbin/backend/src/modules/orchestration/planner.service.ts L60-80
const task: AgentExecutionTask = {
  title: 'Planner agent task decomposition',
  description: [
    '将用户需求拆解为可执行任务清单并返回 JSON。',
    `需求: ${prompt}`,
    '输出规则:',
    '1) 仅输出 JSON，不要附加解释。',
    '2) JSON 结构: {"mode":"sequential|parallel|hybrid","tasks":[{"title":"","description":"","priority":"low|medium|high|urgent","dependencies":[0]}]}',
    '3) tasks 数量 3-8 条。',
    '4) dependencies 为当前任务依赖的前置任务索引数组。',
    `5) mode 优先使用 ${mode}。`,
    requirementId ? `5.1) 来源需求ID: ${requirementId}，请确保任务拆解围绕该需求交付闭环。` : '...',
    '6) 若存在发送邮件/外部动作任务，优先依赖"邮件草稿/内容生成"任务...',
  ].join('\n'),
  type: 'planning',
  priority: 'high',
  status: 'pending',
  assignedAgents: [plannerAgentId],
  teamId: 'orchestration',
  messages: [],
};
```

关键点：prompt 要求 LLM **只输出 JSON**，JSON 结构为 `{mode, tasks[{title, description, priority, dependencies}]}`，任务数限制 3-8 条。

---

### 2. JSON 解析 & Plan Tasks 创建

#### JSON 解析 (planner.service.ts L146-175)

`tryParseJson()` 方法采用三级解析策略：
1. 直接 `JSON.parse()`
2. 提取 ````json ... ``` `` 代码块内容再解析
3. 查找第一个 `{` 到最后一个 `}` 之间的内容再解析

#### 解析后的标准化 (L94-103)

```typescript
// /Users/van/Workspace/harbin/backend/src/modules/orchestration/planner.service.ts L94-103
const tasks: PlannerTaskDraft[] = parsed.tasks.slice(0, 8).map((item: any, index: number) => ({
  title: String(item.title || `子任务 ${index + 1}`).slice(0, 120),
  description: String(item.description || item.title || '').slice(0, 1000),
  priority: this.normalizePriority(item.priority),
  dependencies: Array.isArray(item.dependencies)
    ? item.dependencies.filter((dep: any) => Number.isInteger(dep) && dep >= 0)
    : index > 0 ? [index - 1] : [],  // 默认依赖前一个任务
}));
```

#### 依赖优化 (L191-220)

`optimizeDependencies()` 特别处理邮件场景：如果存在"邮件草稿"任务和"发送邮件"任务，则让"发送"直接依赖"草稿"，而非依赖"校对/润色"。

#### Plan Tasks 持久化 (orchestration.service.ts L259-353)

```typescript
// /Users/van/Workspace/harbin/backend/src/modules/orchestration/orchestration.service.ts L262-302
for (let i = 0; i < planningResult.tasks.length; i++) {
  const planningTask = planningResult.tasks[i];
  // executor 自动分配（见下节）
  const assignment = await this.executorSelectionService.selectExecutor(
    planningTask.title, planningTask.description
  );

  const createdTask = await new this.orchestrationTaskModel({
    mode: 'plan',
    planId,
    title: planningTask.title,
    description: planningTask.description,
    priority: planningTask.priority,
    status: assignment.executorType === 'unassigned' ? 'pending' : 'assigned',
    order: i,
    dependencyTaskIds: [],  // 先创建，后回填
    assignment,
    ...
  }).save();

  // 将 planner 返回的索引依赖转为实际的 MongoDB ObjectId 依赖
  const deps = (planningTask.dependencies || [])
    .map((depIndex) => idByIndex[depIndex])
    .filter(Boolean);
  if (deps.length) {
    await this.orchestrationTaskModel
      .updateOne({ _id: createdTask._id }, { $set: { dependencyTaskIds: deps } })
      .exec();
  }
}
```

---

### 3. Executor 分配逻辑

#### 核心文件
- `/Users/van/Workspace/harbin/backend/src/modules/orchestration/services/executor-selection.service.ts` (全文 193 行)
- `/Users/van/Workspace/harbin/backend/src/modules/orchestration/services/task-classification.service.ts` (全文 101 行)

#### 关键结论：**Executor 不是 planner 指定的，而是系统自动分配的。**

Planner 的输出 JSON 中没有 executor 字段。每个 task 创建后，`ExecutorSelectionService.selectExecutor()` 根据任务的 title 和 description 自动匹配。

#### 分配算法 (executor-selection.service.ts L26-133)

```typescript
// /Users/van/Workspace/harbin/backend/src/modules/orchestration/services/executor-selection.service.ts L26-133
async selectExecutor(title: string, description: string):
  Promise<{ executorType: 'agent' | 'employee' | 'unassigned'; executorId?: string; reason: string }>
{
  // 1. 任务分类
  const emailTask = this.taskClassificationService.isEmailTask(title, description);
  const researchTask = this.taskClassificationService.isResearchTask(title, description);

  // 2. 关键词提取 (中英文)
  const keywords = text.split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/).filter(item => item.length >= 2).slice(0, 20);

  // 3. 并行加载所有活跃 agents 和 employees
  const [agents, employees] = await Promise.all([
    this.agentModel.find({ isActive: true }).exec(),
    this.employeeModel.find({ status: { $in: ['ACTIVE', 'PROBATION'] } }).exec(),
  ]);

  // 4. 基于关键词匹配打分
  const agentCandidates = agents.map(agent => {
    const context = `${agent.name} ${agent.description} ${(agent.capabilities || []).join(' ')}`.toLowerCase();
    const score = keywords.reduce((acc, kw) => context.includes(kw) ? acc + 1 : acc, 0);
    return { id: agent._id.toString(), score };
  }).sort((a, b) => b.score - a.score);

  // 5. 优先级路由：
  //    - 邮件任务 -> 有邮件工具的 agent -> 人类 employee -> unassigned
  //    - 研究任务 -> 有 websearch/webfetch 工具的 agent
  //    - 通用任务 -> 关键词分数最高的 agent/employee
  //    - 全部零分 -> 第一个活跃 agent（fallback）
  //    - 没有任何 agent -> unassigned
}
```

#### 任务分类 (task-classification.service.ts)

基于关键词匹配分类：
- **邮件任务**：包含 `send email`, `发送邮件`, `gmail`, `@` 等
- **研究任务**：包含 `research`, `search`, `调研`, `检索` 等
- **代码任务**：包含 `code`, `implement`, `开发`, `fix` 等
- **审核任务**：包含 `review`, `校对`, `润色` 等

---

### 4. Session 消息组装逻辑 & Prompt "两处出现" 的原因

#### 核心文件
- `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent.service.ts` L1313-1427 (`buildMessages`)
- `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent-executor-runtime.service.ts` L54-72 (`appendSystemMessagesToSession`)
- `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts` L364-441 (`appendSystemMessagesToSession` + 去重逻辑)

#### buildMessages 完整流程 (agent.service.ts L1313-1427)

`buildMessages()` 构建发送给 LLM 的完整消息数组，按顺序拼装：

1. **System Prompt** (L1322-1326)：agent 的 `systemPrompt`
2. **任务上下文** (L1329-1333)：标题、描述、类型、优先级
3. **团队上下文** (L1336-1342)：如果存在 teamContext
4. **已启用技能摘要** (L1344-1358)：skill 名称、描述、proficiency（详见第5点）
5. **工具规格** (L1361-1391)：可用工具列表 + 调用格式说明
6. **工具使用策略** (L1383-1391)：每个工具的 prompt（去重后注入）
7. **记忆上下文** (L1393-1405)：从备忘录检索的相关记忆
8. **身份定义** (L1407-1421)：identity memos
9. **历史消息** (L1424)：`context.previousMessages`

#### 为什么 prompt 在两处出现

Prompt 出现在两个地方是**设计行为而非 bug**：

**第一处**：`buildMessages()` 构建的 messages 数组直接发送给 LLM API（`modelService.chat()` 或 `modelService.streamingChat()`）。这是 LLM 实际执行所需的输入。

**第二处**：`appendSystemMessagesToSession()` (agent.service.ts L827, L1053) 将同样的 system messages 持久化到 AgentSession 中。这是为了：
- Runtime 审计/追溯
- 会议场景中的 session 连续性
- 跨 run 的上下文回溯

```typescript
// /Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent.service.ts L825-827
// 发送给 LLM 后，也持久化到 session
await this.agentExecutionService.appendSystemMessagesToSession(
  runtimeContext, messages, agent.id || agentId
);
```

#### Session 层去重逻辑 (runtime-persistence.service.ts L364-441)

为了避免重复 run 时 session 中堆积重复的 system messages，`appendSystemMessagesToSession` 内置了去重：

```typescript
// /Users/van/Workspace/harbin/backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts L380-411
const existingSystemContents = new Set<string>();
const existingContextKeys = new Set<string>();

// 对已有消息建立去重集
for (const msg of existingMessages) {
  if (msg?.role === 'system') {
    const normalized = this.normalizeSystemContent(msg.content); // 压缩空白
    existingSystemContents.add(normalized);
    const contextKey = this.buildSystemContextKey(msg.content); // 结构化 key
    if (contextKey) existingContextKeys.add(contextKey);
  }
}

// 过滤新消息
const dedupedMessages = messages.filter((msg) => {
  const normalized = this.normalizeSystemContent(msg.content);
  if (!normalized) return false;
  if (existingSystemContents.has(normalized)) return false;  // 内容完全重复
  const contextKey = this.buildSystemContextKey(msg.content);
  if (contextKey && existingContextKeys.has(contextKey)) return false; // 语义重复
  return true;
});
```

去重手段：
- **`normalizeSystemContent`** (L21-23)：将所有空白压缩为单空格后比较
- **`buildSystemContextKey`** (L32-57)：对特定结构化内容（如团队上下文、会议 brief）提取语义 key 进行去重，如 `team_context:{meetingId}` 或 `meeting_brief:{title}`

---

### 5. Skill 注入 LLM Prompt 的完整流程

#### 核心文件
- `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent.service.ts` L1453-1505 (`getEnabledSkillsForAgent`)
- `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent.service.ts` L1344-1358 (skill 消息注入)
- `/Users/van/Workspace/harbin/backend/apps/agents/src/schemas/agent-skill.schema.ts` (Skill 数据模型)
- `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/skills/skill.service.ts` L180-228 (`getSkillContentById`)

#### 完整流程

**Step 1：获取 Agent 已启用的 Skills** (agent.service.ts L1453-1505)

```typescript
private async getEnabledSkillsForAgent(agent: Agent, agentId: string): Promise<EnabledAgentSkillContext[]> {
  // 1. 先查 Redis 缓存（key: agent:enabled-skills:{agentId}）
  // 2. 缓存未命中 -> 从 agent.skills[] 获取 skillId 列表
  //    -> 查 DB：status in ['active', 'experimental']
  // 3. 构建 context（只包含元数据，不含 content）
  const contexts = skills.map(skill => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    tags: skill.tags || [],
    proficiencyLevel: 'beginner',  // 硬编码为 beginner
  }));
  // 4. 写入 Redis 缓存（TTL 由 AGENT_ENABLED_SKILL_CACHE_TTL_SECONDS 控制）
}
```

**Step 2：注入到 System Prompt** (agent.service.ts L1344-1358)

```typescript
// /Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent.service.ts L1344-1358
if (enabledSkills.length > 0) {
  const skillLines = enabledSkills
    .map(skill =>
      `- ${skill.name} (id=${skill.id}, proficiency=${skill.proficiencyLevel}) | description=${skill.description} | tags=${(skill.tags || []).join(', ') || 'N/A'}`
    )
    .join('\n');

  messages.push({
    role: 'system',
    content:
      `Enabled Skills for this agent:\n${skillLines}\n\n` +
      '请优先基于以上已启用技能的能力边界来拆解与执行任务，并在输出中体现对应技能的方法论。',
    timestamp: new Date(),
  });
}
```

#### 关键发现：Skill 的 `content`（方法论/规则的全文）**不会**被注入到 LLM prompt 中

当前的注入逻辑只传递了 skill 的**元数据**（name, id, description, tags, proficiencyLevel），而 Skill Schema 中定义的 `content` 字段（存储 markdown 格式的方法论文档）**没有被加载到 `EnabledAgentSkillContext` 中，也没有被注入到 prompt**。

- `EnabledAgentSkillContext` 接口 (L113-119) 不含 `content` 字段
- `getEnabledSkillsForAgent()` (L1481-1487) 构建的 context 也不含 content
- Skill 的 `content` 只能通过 `SkillService.getSkillContentById()` (skill.service.ts L180-228) 单独获取，用于 API 读取和文档同步，不参与 prompt 注入

**注入的 prompt 指令是**：`"请优先基于以上已启用技能的能力边界来拆解与执行任务，并在输出中体现对应技能的方法论。"` -- 这依赖 LLM 从 skill 的 name 和 description 中"推断"方法论，而非将实际方法论文档注入。

#### Skill 内容的存储架构 (skill.service.ts)

```
Skill (MongoDB)
  ├── id, name, slug, description   ← 注入到 prompt
  ├── tags, category, status        ← 注入到 prompt
  ├── content (string, markdown)    ← 仅存储，不注入 prompt
  ├── contentType, contentHash      ← 用于缓存管理
  └── contentSize, contentUpdatedAt
```

Skill content 通过两级缓存管理：
- Redis key `skill:content:latest:{skillId}` -> contentHash
- Redis key `skill:content:{skillId}:{contentHash}` -> JSON(content, contentType, ...)
- TTL 默认 900 秒（15 分钟），可通过 `SKILL_CONTENT_CACHE_TTL_SECONDS` 配置

---

### 关键文件索引

| 功能 | 文件路径 | 关键行号 |
|------|---------|---------|
| Planner 入口 | `/Users/van/Workspace/harbin/backend/src/modules/orchestration/planner.service.ts` | L29-52 |
| Planner prompt 构造 | 同上 | L60-80 |
| JSON 解析 | 同上 | L146-175 |
| 依赖优化 | 同上 | L191-220 |
| 启发式降级 | 同上 | L116-135 |
| Plan 创建 & tasks 持久化 | `/Users/van/Workspace/harbin/backend/src/modules/orchestration/orchestration.service.ts` | L226-353 |
| Replan 逻辑 | 同上 | L413-640 |
| Task 执行调度 | 同上 | L1277-1460 |
| Task 描述增强 | 同上 | L1790-1834 |
| 依赖上下文构建 | 同上 | L1921-1951 |
| Executor 自动分配 | `/Users/van/Workspace/harbin/backend/src/modules/orchestration/services/executor-selection.service.ts` | L26-133 |
| 任务分类 | `/Users/van/Workspace/harbin/backend/src/modules/orchestration/services/task-classification.service.ts` | L1-101 |
| buildMessages (LLM prompt 组装) | `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent.service.ts` | L1313-1427 |
| Skill 获取 & 注入 | 同上 | L1344-1358, L1453-1505 |
| resolveLatestUserContent | 同上 | L1937-1943 |
| Session 消息去重 | `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts` | L364-441 |
| 去重辅助方法 | 同上 | L21-57 |
| appendSystemMessagesToSession (bridge) | `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent-executor-runtime.service.ts` | L54-72 |
| Skill Schema | `/Users/van/Workspace/harbin/backend/apps/agents/src/schemas/agent-skill.schema.ts` | L1-87 |
| Skill Content 读取 | `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/skills/skill.service.ts` | L180-228 |
| Orchestration 任务 Schema | `/Users/van/Workspace/harbin/backend/src/shared/schemas/orchestration-task.schema.ts` | L54-60 |

---

## 已知缺陷：Agent Manifest 截断导致执行者不可见（2026-03-24）

### 问题

`planning-context.service.ts` 的 `buildAgentManifest` 将所有活跃 Agent 的信息拼为纯文本，然后以 `AGENT_MANIFEST_MAX_LENGTH`（默认 2000 字符，`PLANNER_AGENT_MANIFEST_MAX_LENGTH` 环境变量可调）做硬截断后注入 Planner Prompt。

当 Agent 数量增多时，排序靠后但具备关键工具的 Agent 会被截断，导致 Planner 在规划阶段无法发现正确的执行者，产生反复分配失败与死循环。

### 实际案例

计划 `69c181d953a3c074f2eca7f6`（Prompt 全量导入）要求 `repo-writer` + `save-prompt-template`。数据库中 Docter-W 和 Coder-T 均具备这两个工具，但因排序在第 11-12 位被截断，Planner 完全不可见，导致 3 次 replan、20+ 任务全部失败。

### 根本原因

Agent Manifest 作为**静态文本**注入 Planner Prompt 的架构设计存在缺陷。Planner Agent 本身具备 `list-agents` 工具，应该自行调用工具查询完整执行者清单，而非依赖系统预先塞入的截断文本。

### 排查教训

- **必须查数据库验证实际 Agent 工具配置**，不能只看种子文件代码（种子文件只是初始数据，运行时已被修改）
- Agent 工具来源有两处需同时检查：`agents.tools`（Agent 文档直接存储）和 `agent_profiles.tools`（通过 roleId → roleCode 关联的角色配置），`buildAgentManifest` 仅读取前者

### 详细分析

见 `docs/issue/fix/2026-03-24-planner-agent-manifest-truncation-deadloop.md`
# Session 与 Context 组装架构技术文档

## 1. 概述

本文档描述 Agent Runtime 中 Session 管理与 Context 组装的目标架构设计，作为 `AGENT_SESSION_CONTEXT_ARCHITECTURE_PLAN` 的技术参考。

## 2. 核心概念

### 2.1 Agent 工作场景分类

Agent 存在三种工作场景，各场景的上下文需求差异显著：

| 场景 | 本质 | 上下文特征 |
|------|------|-----------|
| **计划编排（Orchestration）** | 多 agent 协作完成专业流程，类比多员工分工合作 | 重度任务链上下文、业务领域知识、协作关系 |
| **1v1 聊天（Chat）** | 临时性即时交互——测试能力、查询状态、快速执行小任务 | 轻量、即时、对话内容自带上下文 |
| **多人会议（Meeting）** | 讨论、信息同步、共识达成 | 多方发言追踪、会议主题演进、参与者角色 |

### 2.2 六层上下文模型

所有场景共享统一的 6 层上下文模型，但每层在不同场景下的注入策略不同。

```
┌──────────────────────────────────────────────────┐
│  L1  Agent Identity          我是谁              │  ← Session 级
├──────────────────────────────────────────────────┤
│  L2  Toolset & Skills        我能做什么           │  ← Session 级
├──────────────────────────────────────────────────┤
│  L3  Business Domain Context 我在什么领域工作      │  ← Plan/Session 级
├──────────────────────────────────────────────────┤
│  L4  Collaboration Context   我和谁怎么配合        │  ← 场景差异化
├──────────────────────────────────────────────────┤
│  L5  Task Context            我当前要做什么        │  ← Run/Task 级
├──────────────────────────────────────────────────┤
│  L6  Working Memory          我记得什么            │  ← Session 级，逐 Run 积累
└──────────────────────────────────────────────────┘
```

## 3. 各层详细定义

### 3.1 L1 — Agent Identity（我是谁）

**职责**：定义 agent 的角色身份、职责边界和行为准则。

**内容组成**：
- 基础角色定义（角色名、职责描述）
- 自定义 system prompt（agent 级别的个性化指令）
- 工作准则（agentWorkingGuideline prompt）

**注入时机**：Session 首次 run 时全量注入，后续 run 通过指纹比对进行增量更新或跳过。

**与当前实现的差异**：
- 精简 identity memo 内容——去掉"技能矩阵"、"工作风格评分"等对 LLM 决策无帮助的信息
- identity 仅保留：角色名、角色描述、系统提示词、核心职责边界
- 技能信息归入 L2，不在 identity 中重复

### 3.2 L2 — Toolset & Skills（我能做什么）

**职责**：声明 agent 的能力边界。

**内容组成**：
- 已授权工具清单 + 工具 spec
- 工具使用策略（toolStrategyWrapper prompt）
- 已启用技能元数据索引（name/id/description/tags/proficiencyLevel）
- 按需激活的技能全文（`shouldActivateSkillContent` 判定后注入）

**注入时机**：Session 首次 run 时全量注入。工具或技能变更时增量更新。

**与当前实现的差异**：基本保持不变，主要是从 buildMessages 中独立为 `ToolsetContextBuilder`。

### 3.3 L3 — Business Domain Context（我在什么领域工作）🆕

**职责**：描述当前工作所处的业务场景和领域，提供领域知识与约束。这是当前完全缺失的一层。

**内容组成**：
```typescript
interface BusinessDomainContext {
  /** 业务场景类型标识 */
  domainType: string;  // e.g. 'development', 'research', 'product-planning', 'data-collection'
  
  /** 领域描述——对当前业务场景的自然语言说明 */
  description: string;
  
  /** 领域约束规则——该场景下需要遵循的规则或限制 */
  constraints?: string[];
  
  /** 领域知识引用——相关文档/资源的引用（不是全文，仅引用标识） */
  knowledgeRefs?: string[];
  
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
}
```

**典型场景示例**：

| domainType | description | constraints 示例 |
|-----------|-------------|-----------------|
| `development` | "基于 Nest.js + React + MongoDB 的 SaaS 平台研发" | ["遵循 TypeScript 严格模式", "API 变更需同步更新文档"] |
| `research` | "竞品调研——对比 5 款同类 AI Agent 平台" | ["信息来源需标注出处", "结论需附数据支撑"] |
| `product-planning` | "下季度产品路线图规划" | ["功能需关联用户反馈", "排期需考虑技术债务"] |
| `data-collection` | "整理团队周报数据" | ["数据格式统一为 Markdown 表格", "截止时间为每周五"] |

**数据来源**：
- 编排模式：挂在 OrchestrationPlan 级别，创建计划时由用户指定或 planner 自动从需求描述中提取
- 1v1 聊天：通常不需要，可选由用户手动设置
- 多人会议：可选，从会议描述/议程中提取

**注入时机**：Session 创建时注入一次，全程有效。Plan 级上下文，不随 task 切换变化。

### 3.4 L4 — Collaboration Context（我和谁怎么配合）

**职责**：替代当前的"团队上下文"，描述在当前场景中的协作关系。

**内容组成（按场景差异化）**：

#### 编排模式

```typescript
interface OrchestrationCollaborationContext {
  /** 当前 agent 在团队中的层级 */
  agentTier: 'leadership' | 'operations' | 'temporary';
  
  /** 当前 agent 的角色定位 */
  roleInPlan: string;  // e.g. "负责架构设计与代码审查"
  
  /** 协作者信息（仅与当前 agent 有协作关系的） */
  collaborators: {
    agentId: string;
    name: string;
    tier: 'leadership' | 'operations' | 'temporary';
    roleInPlan: string;
    relationship: 'upstream' | 'downstream' | 'parallel';
  }[];
  
  /** 分派约束（来自三层治理架构） */
  delegationRules: {
    canDelegateTo: string[];   // 允许分派的层级
    cannotDelegateTo: string[]; // 禁止分派的层级
  };
  
  /** 上游任务的关键产出摘要（来自 runSummaries） */
  upstreamOutputs?: {
    taskTitle: string;
    agentName: string;
    outputSummary: string;
  }[];
}
```

#### 多人会议模式

```typescript
interface MeetingCollaborationContext {
  /** 会议主题与目标 */
  meetingTitle: string;
  meetingObjective: string;  // '讨论' | '信息同步' | '决策' | '共识达成'
  agenda?: string[];
  
  /** 参与者及其角色 */
  participants: {
    id: string;
    name: string;
    type: 'employee' | 'agent';
    tier?: 'leadership' | 'operations' | 'temporary';
    role: 'host' | 'participant';
    isExclusiveAssistant?: boolean;
    assistantForEmployeeId?: string;
  }[];
  
  /** 指令优先级声明（来自三层治理架构） */
  commandPriority: {
    highestAuthority: string;  // 当前会议中最高权限者
    exclusiveAssistantOverride: boolean;  // 是否有专属助理的增强话语权
  };
}
```

#### 1v1 聊天模式

通常为空，或仅包含对话发起人信息：

```typescript
interface ChatCollaborationContext {
  initiator: {
    id: string;
    name: string;
    type: 'employee' | 'agent';
  };
}
```

**与当前实现的差异**：
- 当前 teamContext 在编排模式下只有 `{mode:'planning', format:'json'}`，几乎无信息量 → 重构为完整的协作链信息
- 当前 teamContext 在会议模式下是参与者列表的 JSON 直接序列化 → 重构为结构化的会议协作上下文
- 新增：三层治理架构的层级标识和分派约束注入

### 3.5 L5 — Task Context（我当前要做什么）

**职责**：描述当前具体的任务目标和执行要求。仅关注"做什么"，不涉及"在什么领域"（那是 L3 的职责）。

**内容组成**：
```typescript
interface TaskContext {
  /** 任务元信息 */
  title: string;
  description: string;
  type: string;
  priority: string;
  
  /** 编排模式下的任务依赖产出（简化版，详细协作信息在 L4） */
  dependencyOutputs?: string;
  
  /** 重试提示（如果是重试执行） */
  retryHint?: string;
  
  /** 会议模式下的执行规范 */
  meetingExecutionPolicy?: string;
}
```

**注入时机**：每个 run 开始时注入。在 plan 级 session 中，每次 task 切换时更新此层。

**与当前实现的差异**：基本保持现有 task 信息块的结构，主要调整为：
- 与 L3（业务领域）解耦——task context 不再承载领域描述
- 与 L4（协作）解耦——依赖上下文的详细协作信息移至 L4，task 层仅保留简要引用

### 3.6 L6 — Working Memory（我记得什么）

**职责**：提供与当前工作相关的记忆和经验积累。

**内容组成**：
```typescript
interface WorkingMemoryContext {
  /** 前序 run 的结构化摘要（plan 级 session 中积累） */
  runSummaries: {
    runId: string;
    taskTitle: string;
    objective: string;
    outcome: string;       // 执行结果摘要
    keyOutputs: string[];  // 关键产出物
    openIssues?: string[]; // 遗留问题
    completedAt: string;
  }[];
  
  /** 按需检索的相关记忆（来自 memo 系统） */
  relevantMemos?: string;
}
```

**注入时机**：
- `runSummaries`：每个新 run 开始时，从 session 中读取前序 run 的摘要注入
- `relevantMemos`：按需检索，当记忆系统可用时启用

**Run Summary 生成机制**：
- 每个 run 完成后（`run.completed`），取该 run 内的 assistant 最终回复 + tool call 结果
- 通过规则引擎或 LLM 生成结构化摘要（控制在 200-500 字）
- 存入 session 的 `runSummaries` 数组
- 后续 run 的 L6 从中读取，不需要加载前序 run 的原始消息

## 4. AgentSession Schema 优化设计

### 4.1 当前 Schema 问题

```typescript
// 当前问题标注
sessionType: 'meeting' | 'task';           // ❌ 缺少 chat 类型
planContext: {
  linkedPlanId?: string;
  linkedTaskId?: string;                    // ❌ 绑定到 task 级，不支持 plan 级 session
  latestTaskInput?: string;
  latestTaskOutput?: string;
  lastRunId?: string;
};
meetingContext: {
  meetingId?: string;
  agendaId?: string;
  latestSummary?: string;                   // ❌ 信息量不足
};
// ❌ 缺少 domainContext
// ❌ 缺少 collaborationContext
// ❌ 缺少 runSummaries
// ❌ messages 数组无 run 边界标记（runId 可选但未被编排流程使用）
```

### 4.2 目标 Schema 设计

```typescript
@Schema({ timestamps: true, collection: 'agent_sessions' })
export class AgentSession {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ enum: ['meeting', 'task', 'chat'], required: true })
  sessionType: 'meeting' | 'task' | 'chat';

  @Prop({ enum: ['agent', 'employee', 'system'], default: 'agent' })
  ownerType: 'agent' | 'employee' | 'system';

  @Prop({ required: true })
  ownerId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ enum: ['active', 'archived', 'closed'], default: 'active' })
  status: 'active' | 'archived' | 'closed';

  @Prop({ type: [String], default: [] })
  runIds: string[];

  @Prop({ type: [String], default: [] })
  memoIds: string[];

  // ============ 场景上下文（持久化） ============

  /** 编排计划关联——改为 plan 级绑定 */
  @Prop(raw({
    linkedPlanId: { type: String },
    currentTaskId: { type: String },       // 当前正在执行的 taskId（动态更新）
    completedTaskIds: [{ type: String }],   // 已完成的 taskId 列表
    lastRunId: { type: String },
  }))
  planContext?: {
    linkedPlanId?: string;
    currentTaskId?: string;
    completedTaskIds?: string[];
    lastRunId?: string;
  };

  /** 会议关联 */
  @Prop(raw({
    meetingId: { type: String },
    agendaId: { type: String },
    meetingType: { type: String },          // 新增：区分会议类型
    latestSummary: { type: String },
  }))
  meetingContext?: {
    meetingId?: string;
    agendaId?: string;
    meetingType?: string;
    latestSummary?: string;
  };

  /** 业务领域上下文（L3 持久化） */
  @Prop(raw({
    domainType: { type: String },
    description: { type: String },
    constraints: [{ type: String }],
    knowledgeRefs: [{ type: String }],
    metadata: { type: Object },
  }))
  domainContext?: {
    domainType?: string;
    description?: string;
    constraints?: string[];
    knowledgeRefs?: string[];
    metadata?: Record<string, unknown>;
  };

  /** 协作上下文（L4 持久化） */
  @Prop({ type: Object })
  collaborationContext?: Record<string, unknown>;

  // ============ 消息与摘要 ============

  @Prop({
    type: [{
      id: { type: String },
      runId: { type: String },              // run 边界标记
      taskId: { type: String },             // 关联的 taskId
      role: { type: String, enum: ['system', 'user', 'assistant', 'tool'], required: true },
      content: { type: String, required: true },
      status: { type: String, enum: ['pending', 'streaming', 'completed', 'error'], default: 'completed' },
      metadata: { type: Object },
      timestamp: { type: Date, default: Date.now },
    }],
    default: [],
  })
  messages: {
    id?: string;
    runId?: string;
    taskId?: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    status?: 'pending' | 'streaming' | 'completed' | 'error';
    metadata?: Record<string, unknown>;
    timestamp: Date;
  }[];

  /** Run 结构化摘要（L6 数据源） */
  @Prop({
    type: [{
      runId: { type: String, required: true },
      taskId: { type: String },
      taskTitle: { type: String },
      objective: { type: String },
      outcome: { type: String },
      keyOutputs: [{ type: String }],
      openIssues: [{ type: String }],
      completedAt: { type: Date },
    }],
    default: [],
  })
  runSummaries: {
    runId: string;
    taskId?: string;
    taskTitle?: string;
    objective?: string;
    outcome?: string;
    keyOutputs?: string[];
    openIssues?: string[];
    completedAt?: Date;
  }[];

  // ============ 其他字段 ============

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;

  @Prop({ default: Date.now })
  lastActiveAt: Date;

  @Prop({ type: Object })
  memoSnapshot?: {
    agentId: string;
    refreshedAt: string;
    identity: Array<{ id: string; memoKind: string; title: string; slug?: string; content: string; updatedAt?: string; }>;
    todo:     Array<{ id: string; memoKind: string; title: string; slug?: string; content: string; updatedAt?: string; }>;
    topic:    Array<{ id: string; memoKind: string; title: string; slug?: string; content: string; updatedAt?: string; }>;
  };
}
```

### 4.3 Schema 变更对照

| 字段 | 当前 | 目标 | 变更说明 |
|------|------|------|---------|
| `sessionType` | `meeting \| task` | `meeting \| task \| chat` | 新增 chat 类型 |
| `planContext.linkedTaskId` | 绑定单个 taskId | 移除，改为 `currentTaskId` + `completedTaskIds` | 支持 plan 级 session 跟踪多 task |
| `planContext.latestTaskInput/Output` | 存在 | 移除 | 由 `runSummaries` 替代 |
| `meetingContext.meetingType` | 不存在 | 新增 | 区分会议类型 |
| `domainContext` | 不存在 | 新增 | L3 业务领域上下文持久化 |
| `collaborationContext` | 不存在 | 新增 | L4 协作上下文持久化 |
| `runSummaries` | 不存在 | 新增 | L6 Working Memory 的数据源 |

## 5. Session 生命周期管理

### 5.1 编排模式 — Plan 级 Session

```
Plan 创建
  │
  ├─ Agent A 首次被分配任务
  │   └─ getOrCreatePlanSession(planId, agentId)
  │       → 创建 session: plan-{planId}-{agentId}
  │       → 注入 L1(Identity) + L2(Toolset) + L3(DomainContext)
  │
  ├─ Agent A 执行 Task #1 (Run #1)
  │   └─ 更新 planContext.currentTaskId = task1Id
  │   └─ 注入 L4(Collaboration for task1) + L5(Task1 Context)
  │   └─ Run 完成 → 生成 runSummary → 存入 session.runSummaries
  │   └─ 更新 planContext.completedTaskIds += task1Id
  │
  ├─ Agent A 执行 Task #3 (Run #2)
  │   └─ 更新 planContext.currentTaskId = task3Id
  │   └─ 注入 L4(Collaboration for task3) + L5(Task3 Context)
  │   └─ 注入 L6(Working Memory: Run #1 summary)
  │   └─ Run 完成 → 生成 runSummary → 追加到 session.runSummaries
  │
  └─ Plan 完成 → session.status = 'closed'
```

### 5.2 会议模式 — Meeting 级 Session（保持不变）

```
Meeting 创建
  │
  ├─ Agent 入场
  │   └─ getOrCreateMeetingSession(meetingId, agentId)
  │       → 创建或复用 session: meeting-{meetingId}-{agentId}
  │       → 注入 L1 + L2 + L4(Meeting Collaboration)
  │
  ├─ 每次被 @ 或需要发言 (Run #N)
  │   └─ 注入 L5(Meeting Execution Policy)
  │   └─ 复用 session 内历史消息
  │
  └─ Meeting 结束 → session.status = 'closed'
```

### 5.3 1v1 聊天模式 — Chat Session（新增）

```
用户发起聊天
  │
  └─ 创建 session: chat-{agentId}-{timestamp}
      → 注入 L1(Identity) + L2(Toolset)
      → L3/L4 通常为空
      → 每轮对话为一个 Run
```

## 6. Context Assembler 架构

### 6.1 设计目标

将当前 `buildMessages` 中的 12 阶段硬编码拆分为可组合的 Context Block Builder，由统一的 `ContextAssembler` 按场景策略编排。**整个 context 组装逻辑从 `agent-executor.service.ts` 中独立为单独模块**，降低 executor 的职责负担，提升可测试性和可维护性。

### 6.2 文件拆分结构

```
modules/agents/context/
  ├── context-block-builder.interface.ts      // ContextBlockBuilder 接口 + ContextBuildInput 类型 + 公共常量
  ├── context-assembler.service.ts            // 统一编排入口（NestJS Injectable）
  ├── identity-context.builder.ts             // L1 — 身份与职责
  ├── toolset-context.builder.ts              // L2 — 工具与技能
  ├── domain-context.builder.ts               // L3 — 业务领域
  ├── collaboration-context.builder.ts        // L4 — 协作关系
  ├── task-context.builder.ts                 // L5 — 任务目标
  ├── memory-context.builder.ts               // L6 — 工作记忆
  ├── context-fingerprint.util.ts             // 指纹缓存 + 增量更新通用能力（从 executor 迁出）
  └── context.module.ts                       // NestJS Module 注册
```

**各文件职责说明**：

| 文件 | 职责 | 从哪里迁移 |
|------|------|-----------|
| `context-block-builder.interface.ts` | 定义 `ContextBlockBuilder` 接口、`ContextBuildInput` 类型、`ScenarioType` 枚举、`ContextLayer` 枚举 | 新增 |
| `context-assembler.service.ts` | 注入所有 Builder，按序执行 `shouldInject` → `build`，追加历史消息（去重） | 从 `agent-executor.service.ts` 的 `buildMessages` 主体逻辑迁出 |
| `identity-context.builder.ts` | L1：角色定义 + system prompt + 工作准则 + identity memo 注入 | 从 `buildMessages` 阶段 1-3 迁出 |
| `toolset-context.builder.ts` | L2：工具声明 + 工具策略 + 技能索引 + 技能全文激活 | 从 `buildMessages` 阶段 5-6 迁出 |
| `domain-context.builder.ts` | L3：从 session.domainContext 读取并格式化注入 | 新增 |
| `collaboration-context.builder.ts` | L4：根据 scenarioType 构建差异化协作上下文（编排/会议/聊天） | 从 `buildMessages` 阶段 7（teamContext）重构迁出 |
| `task-context.builder.ts` | L5：任务信息块 + 会议执行规范 | 从 `buildMessages` 阶段 4、8 迁出 |
| `memory-context.builder.ts` | L6：runSummaries 读取 + memo 按需检索 | 从 `buildMessages` 阶段 11（已注释的 memo 逻辑）重构 |
| `context-fingerprint.util.ts` | `resolveSystemContextBlockContent`、`normalizeSystemContent`、`buildSystemContextKey`、`buildTaskInfoDelta`、`buildIdentityMemoDelta` 等通用方法 | 从 `agent-executor.service.ts` L1756-1891 迁出 |
| `context.module.ts` | 注册 `ContextAssemblerService` 及所有 Builder 为 NestJS providers | 新增 |

**迁移后 `agent-executor.service.ts` 的变化**：

```typescript
// Before（~300 行 buildMessages 逻辑）
async buildMessages(agent, task, context, enabledSkills): Promise<ChatMessage[]> {
  // 12 个阶段的硬编码组装...
}

// After（单行调用）
async buildMessages(agent, task, context, enabledSkills): Promise<ChatMessage[]> {
  return this.contextAssembler.assemble({
    agent,
    task,
    session: context.session,
    context,
    enabledSkills,
    scenarioType: this.resolveScenarioType(task, context),
  });
}
```

### 6.3 核心接口定义

```typescript
// context-block-builder.interface.ts

/** 场景类型 */
export type ScenarioType = 'orchestration' | 'meeting' | 'chat';

/** 上下文层标识 */
export type ContextLayer = 'identity' | 'toolset' | 'domain' | 'collaboration' | 'task' | 'memory';

/** Builder 输入 */
export interface ContextBuildInput {
  agent: Agent;
  task: Task;
  session: AgentSession;
  context: AgentContext;
  enabledSkills: EnabledAgentSkillContext[];
  scenarioType: ScenarioType;
}

/** 上下文块构建器接口 */
export interface ContextBlockBuilder {
  /** 上下文层标识 */
  readonly layer: ContextLayer;

  /** 判断该层在当前场景下是否需要注入 */
  shouldInject(input: ContextBuildInput): boolean;

  /** 构建该层的 system messages */
  build(input: ContextBuildInput): Promise<ChatMessage[]>;
}
```

```typescript
// context-assembler.service.ts

@Injectable()
export class ContextAssemblerService {
  constructor(
    private readonly identityBuilder: IdentityContextBuilder,
    private readonly toolsetBuilder: ToolsetContextBuilder,
    private readonly domainBuilder: DomainContextBuilder,
    private readonly collaborationBuilder: CollaborationContextBuilder,
    private readonly taskBuilder: TaskContextBuilder,
    private readonly memoryBuilder: MemoryContextBuilder,
  ) {}

  /** 所有 Builder 按层序排列 */
  private get builders(): ContextBlockBuilder[] {
    return [
      this.identityBuilder,      // L1
      this.toolsetBuilder,       // L2
      this.domainBuilder,        // L3
      this.collaborationBuilder, // L4
      this.taskBuilder,          // L5
      this.memoryBuilder,        // L6
    ];
  }

  async assemble(input: ContextBuildInput): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];

    for (const builder of this.builders) {
      if (builder.shouldInject(input)) {
        const blockMessages = await builder.build(input);
        messages.push(...blockMessages);
      }
    }

    // 追加历史 system 消息（去重）
    const dedupedHistorySystem = this.deduplicateHistorySystemMessages(
      input.context.previousMessages, messages,
    );
    messages.push(...dedupedHistorySystem);

    // 追加非 system 历史消息
    const historyNonSystem = (input.context.previousMessages || [])
      .filter(msg => msg?.role !== 'system');
    messages.push(...historyNonSystem);

    return messages;
  }
}
```

### 6.4 各 Builder 的 shouldInject 策略

| Builder | orchestration | meeting | chat |
|---------|:------------:|:-------:|:----:|
| IdentityContextBuilder | ✅ 必须 | ✅ 必须 | ✅ 必须 |
| ToolsetContextBuilder | ✅ 必须 | ✅ 必须（精简模式） | ✅ 必须 |
| DomainContextBuilder | ✅ 必须 | ⚪ 可选 | ⚪ 可选 |
| CollaborationContextBuilder | ✅ 必须 | ✅ 必须 | ⚪ 通常跳过 |
| TaskContextBuilder | ✅ 必须 | ✅ 必须 | ⚪ 由对话自带 |
| MemoryContextBuilder | ✅ 有摘要时注入 | ⚪ 按需 | ⚪ 按需 |

### 6.5 Builder 内部依赖关系

```
IdentityContextBuilder
  └─ 依赖: MemoService (getIdentityMemos)、PromptResolverService、ContextFingerprintUtil

ToolsetContextBuilder
  └─ 依赖: ToolService (getAllowedToolIds, getToolSpecs)、PromptResolverService、SkillService

DomainContextBuilder
  └─ 依赖: 无外部服务依赖，直接从 session.domainContext 读取

CollaborationContextBuilder
  └─ 依赖: AgentService (getAgentById, 获取协作者信息)、RoleService (层级推断)

TaskContextBuilder
  └─ 依赖: PromptResolverService、ContextFingerprintUtil

MemoryContextBuilder
  └─ 依赖: MemoService (getTaskMemoryContext)、session.runSummaries 读取
```

## 7. 三层治理架构与 Context 的集成

基于 `agent-team-architecture-skill.md` 中定义的三层角色治理架构（高管/执行层/临时工），在 L4 Collaboration Context 中集成以下信息：

### 7.1 层级标识注入

每个 agent 在协作上下文中携带自身层级标识：

```typescript
{
  agentTier: 'leadership' | 'operations' | 'temporary',
  tierSource: 'role-based',  // 层级来源（基于角色自动推断）
}
```

推断规则：
- `leadership`：roleId 为 CTO/CEO 或 isExclusiveAssistant=true 的专属助理
- `temporary`：roleId 为 temporary-worker 或 agent 标记为临时工
- `operations`：其余所有角色

### 7.2 分派约束注入

在编排模式的 L4 中注入分派方向约束，防止 agent 在 tool call 中发起违规分派：

```
你的层级为「执行层」。你可以向「临时工」分派子任务，但不可以向「高管层」分派。
```

### 7.3 指令优先级声明

在会议模式的 L4 中注入指令优先级，帮助 agent 正确处理多方指令冲突：

```
指令优先级（从高到低）：1. 安全与合规约束  2. 人类高管专属助理授权指令  3. 既定计划规则  4. 其他高管协商结果
```

## 8. 并行任务隔离策略

当同一 agent 在同一 plan 中有并行任务时：

### 8.1 方案：Run 级隔离 + 延迟合并

- 并行 task 各自创建独立的 run，共享同一个 session
- 并行 run 执行时，各自只能看到"已完成的 runSummaries"，看不到正在并行执行的其他 run 的实时消息
- 并行 run 全部完成后，各自的 summary 才合并到 session 的 runSummaries 中
- 后续串行 task 可以看到所有已完成 run 的 summary

### 8.2 消息写入隔离

并行 run 的消息通过 `runId` 区分，写入同一个 session 的 messages 数组，但 `buildMessages` 时只读取当前 runId 的消息 + 历史 runSummaries，不读取并行 run 的原始消息。

## 9. 迁移兼容策略

### 9.1 分阶段实施

- **Phase 1**：Schema 扩展（新增字段、保留旧字段兼容）+ Context Builder 框架搭建
- **Phase 2**：编排模式迁移到 plan 级 session + DomainContext/CollaborationContext 实现
- **Phase 3**：Run Summary 机制 + Working Memory 启用
- **Phase 4**：清理旧字段、移除兼容代码

### 9.2 旧字段兼容

- `planContext.linkedTaskId`：Phase 1-2 期间保留，Phase 4 移除
- `planContext.latestTaskInput/latestTaskOutput`：Phase 1-2 期间保留，Phase 4 移除
- `getOrCreateTaskSession`：Phase 1-2 期间保留原方法不删除，新增 `getOrCreatePlanSession`；Phase 4 评估是否移除

## 10. 关键代码文件索引

| 文件 | 当前职责 | 需变更内容 |
|------|---------|-----------|
| `apps/agents/src/schemas/agent-session.schema.ts` | Session Schema | 新增字段、调整 planContext 结构 |
| `apps/agents/src/modules/agents/context/` | **新增目录** | Context 组装独立模块（Assembler + 6 Builders + 接口 + 工具） |
| `apps/agents/src/modules/agents/agent-executor.service.ts` | buildMessages (~300行) | 迁出组装逻辑到 context/ 模块，简化为 `contextAssembler.assemble()` 单行调用 |
| `apps/agents/src/modules/runtime/runtime-persistence.service.ts` | Session CRUD | 新增 getOrCreatePlanSession、Run Summary 写入 |
| `apps/agents/src/modules/runtime/runtime-orchestrator.service.ts` | Session 路由 | 新增 plan session 分支 |
| `src/modules/orchestration/orchestration.service.ts` | 编排执行 | sessionId 规则调整、domainContext 透传 |
| `src/modules/orchestration/planner.service.ts` | 计划创建 | teamContext → collaborationContext |
| `src/modules/meetings/meeting.service.ts` | 会议 agent 调用 | teamContext 重构 |
| `src/modules/agents-client/agent-client.service.ts` | Agent 远程调用 | 新增 plan session API |
| `apps/agents/src/modules/runtime/runtime.controller.ts` | Session API | 新增 plan session endpoint |

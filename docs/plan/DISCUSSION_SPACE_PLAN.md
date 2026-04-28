# Plan: DISCUSSION_SPACE_PLAN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | DISCUSSION_SPACE（新增，待创建功能文档） |
| 需求管理 ID | |
| 所属项目 | |
| OpenCode Session | |
| 状态 | in-progress |
| 优先级 | high |
| 创建日期 | 2026-04-28 |

## 2. 背景

### 2.1 问题

当前项目的聊天功能（Meeting）和外部工具（OpenCode/Codex）均为线性一问一答模式，存在以下局限：

1. **对话结构单一**：无法围绕某个话题点深入展开讨论，话题跑偏后难以回溯
2. **知识无法沉淀**：讨论过程中产生的洞察散落在聊天记录中，无法结构化复用
3. **缺少多角色协作**：无法在同一讨论中按需引入不同视角的参与者（真人或 AI 专家）
4. **无文档产出能力**：讨论结束后需手动整理，无法自动沉淀为结构化文档

### 2.2 目标场景

以"财经博主希望系统性跟踪全球能源公司动态"为典型场景：
- 用户提出初始想法 → AI 给出框架性引导
- 用户对"信息检索工程化"感兴趣 → **分叉为子讨论线**深入
- 讨论中需要技术可行性评估 → **@CTO（真人）** 异步参与
- 讨论中需要能源领域专业知识 → **@能源Owner（AI Agent）** 即时回复，并**实时搜索积累领域知识**
- 讨论成熟后 → **自动沉淀为结构化文档**

## 3. 目标

1. 新增独立的 **Discussion Space（讨论空间）** 模块，提供树状对话能力
2. 支持对话分叉（用户主动 + AI 建议），支持无限深度分叉、回溯、讨论线切换
3. 支持多角色参与：默认主 AI Agent + @ 唤醒多个真人/AI 角色
4. AI Agent 具备**讨论驱动的动态知识积累**能力（搜索 → 文档化 → 标签化 → 可信度评估 → 复用）
5. 支持讨论成果的文档沉淀（手动触发 + 实时沉淀两种模式，可在讨论中切换）
6. 讨论线之间支持交叉引用

## 4. 执行步骤

1. [x] **数据模型设计与 Schema 实现**：设计并实现 Discussion Space 全部 Schema（Space、Thread、Message、Participant、KnowledgeEntry）+ 索引
2. [x] **后端核心模块**：在 `apps/agents/` 下新增 `discussion` 模块，实现 Space / Thread / Message / Participant CRUD 及生命周期管理
3. [x] **树状对话与分叉引擎**：实现用户主动分叉 + AI 分叉建议生成 + 分叉上下文摘要传递 + 无限深度支持
4. [x] **多角色参与与 @ 唤醒机制**：实现 AI Agent 即时 @ 响应（含独立知识库检索）+ 真人异步通知（WebSocket + MessageCenter）
5. [x] **Agent 知识积累引擎**：实现搜索 → 文档化 → 标签化 → 可信度评估 → 知识库管理 → 跨讨论复用的完整链路
6. [x] **文档沉淀系统**：实现手动触发沉淀 + 实时沉淀（AI 维护文档大纲）+ 模式切换 + 文档导出
7. [ ] **讨论线交叉引用**：实现跨 Thread 引用机制，含引用解析、上下文注入、引用展示
8. [ ] **上下文压缩与 Token 管理**：实现多线程场景下的 prompt 压缩策略，含摘要生成、知识库 RAG 检索、滑动窗口
9. [x] **前端页面开发**：讨论空间列表页 + 详情页（三栏布局）+ 树状导航 + 分叉交互 + @ 提及 + 文档沉淀面板 + 知识库面板
10. [ ] **API 接口联调与测试**
11. [ ] **文档更新**：功能文档、API 文档、技术设计文档

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-001 | 讨论空间核心数据模型、Schema、后端 CRUD + 树状对话分叉引擎 | [链接](../requirement/DISCUSSION_SPACE_REQ-001_CORE_MODEL_AND_BRANCHING.md) | in-progress |
| REQ-002 | 多角色参与、@ 唤醒机制 + Agent 知识积累引擎 + 文档沉淀系统 | [链接](../requirement/DISCUSSION_SPACE_REQ-002_ROLES_KNOWLEDGE_SEDIMENT.md) | in-progress |
| REQ-003 | 前端完整页面（列表 + 详情三栏 + 全部交互）+ API 联调 | [链接](../requirement/DISCUSSION_SPACE_REQ-003_FRONTEND_INTEGRATION.md) | in-progress |

## 6. 关键影响点

- **后端**：`apps/agents/` 新增 `discussion` 模块（controller / services x7 / schemas x5 / dto x8 / types），约 25-30 个新文件
- **前端**：`frontend/src/pages/` 新增讨论空间页面 + 10+ 组件；`App.tsx` 新增路由；`Layout.tsx` 新增导航项；`services/` 新增 `discussionService.ts`；`stores/` 新增 `discussionStore.ts`
- **数据库**：MongoDB 新增 5 个 Collection（discussion_spaces / discussion_threads / discussion_messages / discussion_participants / discussion_knowledge_entries）
- **API**：新增约 20 个 REST 端点 + 2 个 SSE 端点（AI 流式回复 + 实时沉淀推送）
- **基础设施**：复用现有 Redis（通知/事件/知识缓存）、WebSocket（实时推送）、MinIO（沉淀文档导出存储）
- **文档**：新增功能文档、API 文档、技术设计文档

## 7. 技术方案

### 7.1 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                           Frontend                               │
│  ┌───────────────┐ ┌────────────────────┐ ┌───────────────────┐ │
│  │ Space List    │ │ Discussion Detail   │ │ Context Panel     │ │
│  │ /discussions  │ │ /discussions/:id    │ │ (右侧面板)         │ │
│  │               │ │ ┌────────────────┐ │ │ ┌───────────────┐ │ │
│  │ · 创建空间    │ │ │ Thread Tree    │ │ │ │ 文档沉淀面板  │ │ │
│  │ · 空间列表    │ │ │ (左侧导航)     │ │ │ │ (实时/手动)   │ │ │
│  │ · 搜索/过滤   │ │ ├────────────────┤ │ │ ├───────────────┤ │ │
│  │               │ │ │ Chat View      │ │ │ │ 知识库面板    │ │ │
│  │               │ │ │ (中央对话区)   │ │ │ │ (标签/可信度) │ │ │
│  │               │ │ ├────────────────┤ │ │ ├───────────────┤ │ │
│  │               │ │ │ Input + @提及  │ │ │ │ 参与者面板    │ │ │
│  └───────────────┘ │ └────────────────┘ │ │ └───────────────┘ │ │
│                    └────────────────────┘ └───────────────────┘ │
└──────────────────────────┬───────────────────────────────────────┘
                           │ REST + SSE + WebSocket
┌──────────────────────────▼───────────────────────────────────────┐
│                       apps/agents                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                   Discussion Module                         │ │
│  │                                                             │ │
│  │  ┌───────────────┐  ┌───────────────┐  ┌────────────────┐ │ │
│  │  │ Space         │  │ Thread &      │  │ Message        │ │ │
│  │  │ Service       │  │ Branching     │  │ Service        │ │ │
│  │  │ (生命周期)     │  │ Service       │  │ (收发+序列)    │ │ │
│  │  └───────────────┘  │ (分叉+摘要)   │  └────────────────┘ │ │
│  │                     └───────────────┘                      │ │
│  │  ┌───────────────┐  ┌───────────────┐  ┌────────────────┐ │ │
│  │  │ Participant   │  │ Knowledge     │  │ AI Response    │ │ │
│  │  │ Service       │  │ Accumulation  │  │ Service        │ │ │
│  │  │ (@唤醒+通知)   │  │ Engine        │  │ (SSE+分叉建议) │ │ │
│  │  └───────────────┘  │ (搜索→标签化  │  └────────────────┘ │ │
│  │                     │  →可信度→复用) │                     │ │
│  │  ┌───────────────┐  └───────────────┘  ┌────────────────┐ │ │
│  │  │ Sediment      │                     │ Context        │ │ │
│  │  │ Service       │                     │ Compression    │ │ │
│  │  │ (手动+实时    │                     │ Service        │ │ │
│  │  │  +导出)       │                     │ (Token管理)    │ │ │
│  │  └───────────────┘                     └────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─ 复用现有能力 ──────────────────────────────────────────────┐ │
│  │ AgentExecutor │ ModelRegistry │ ToolService │ MemoService  │ │
│  │ Redis Bus     │ WS Service   │ MessageCenter│ MinIO        │ │
│  └─────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
         │                    │                    │
    ┌────▼────┐         ┌────▼────┐          ┌────▼────┐
    │ MongoDB │         │  Redis  │          │   WS    │
    │ 5 集合   │         │ 事件/缓存│          │ 实时推送 │
    └─────────┘         └─────────┘          └─────────┘
```

### 7.2 数据模型设计

#### 7.2.1 DiscussionSpace（讨论空间）

```typescript
@Schema({ timestamps: true, collection: 'discussion_spaces' })
export class DiscussionSpace {
  @Prop({ required: true })
  title: string;                           // 讨论主题

  @Prop()
  description: string;                     // 讨论描述

  @Prop({ required: true })
  creatorId: string;                       // 创建者 userId

  @Prop({ type: String, enum: ['active', 'paused', 'archived'], default: 'active' })
  status: string;

  @Prop({ type: String, enum: ['manual', 'realtime'], default: 'manual' })
  sedimentMode: string;                    // 文档沉淀模式（可在讨论中切换）

  @Prop({ type: [String], default: [] })
  tags: string[];                          // 讨论标签

  @Prop()
  rootThreadId: string;                    // 根讨论线 ID

  @Prop({ type: Object })
  documentOutline: Record<string, any>;    // 实时沉淀的文档大纲（realtime 模式下 AI 维护）

  @Prop({ type: [Object], default: [] })
  sedimentHistory: Array<{                 // 沉淀历史（支持多次沉淀）
    version: number;
    content: string;                       // Markdown
    threadScope: string[];                 // 本次沉淀包含的讨论线
    createdAt: Date;
  }>;

  @Prop()
  latestSedimentedDocument: string;        // 最新沉淀文档内容（Markdown）

  @Prop()
  projectId: string;                       // 关联项目（可选）

  @Prop({ type: Object })
  settings: {
    maxBranchDepth?: number;               // 分叉深度上限（默认不限，可按需配置）
    knowledgeAutoAccumulate?: boolean;      // 是否自动积累知识（默认 true）
    branchSuggestionEnabled?: boolean;      // 是否开启 AI 分叉建议（默认 true）
  };

  @Prop({ type: Object })
  statistics: {
    totalThreads: number;
    totalMessages: number;
    totalKnowledgeEntries: number;
    totalTokensConsumed: number;
    totalCost: number;
  };
}

// 索引
DiscussionSpaceSchema.index({ creatorId: 1, status: 1 });
DiscussionSpaceSchema.index({ projectId: 1 });
DiscussionSpaceSchema.index({ tags: 1 });
```

#### 7.2.2 DiscussionThread（讨论线）

```typescript
@Schema({ timestamps: true, collection: 'discussion_threads' })
export class DiscussionThread {
  @Prop({ required: true })
  spaceId: string;                         // 所属讨论空间

  @Prop()
  parentThreadId: string;                  // 父讨论线（null 表示根线）

  @Prop()
  branchFromMessageId: string;             // 从哪条消息分叉出来的

  @Prop({ type: String, enum: ['user', 'ai_suggestion'], default: 'user' })
  branchOrigin: string;                    // 分叉来源（用户主动 / AI 建议采纳）

  @Prop({ required: true })
  title: string;                           // 讨论线标题

  @Prop()
  summary: string;                         // AI 自动生成的讨论线摘要

  @Prop()
  contextSummary: string;                  // 分叉时从父线继承的上下文摘要

  @Prop({ type: String, enum: ['active', 'concluded', 'archived'], default: 'active' })
  status: string;

  @Prop({ type: Number, default: 0 })
  depth: number;                           // 分叉深度（根线 = 0）

  @Prop({ type: [String], default: [] })
  childThreadIds: string[];                // 子讨论线 ID 列表（方便树状渲染）

  @Prop({ type: Number, default: 0 })
  messageCount: number;

  @Prop({ type: [String], default: [] })
  activeParticipantIds: string[];          // 在此线中活跃过的参与者
}

// 索引
DiscussionThreadSchema.index({ spaceId: 1, parentThreadId: 1 });
DiscussionThreadSchema.index({ spaceId: 1, depth: 1 });
DiscussionThreadSchema.index({ branchFromMessageId: 1 });
```

#### 7.2.3 DiscussionMessage（讨论消息）

```typescript
@Schema({ timestamps: true, collection: 'discussion_messages' })
export class DiscussionMessage {
  @Prop({ required: true })
  spaceId: string;

  @Prop({ required: true })
  threadId: string;                        // 所属讨论线

  @Prop({ required: true })
  participantId: string;                   // 发送者 participant ID

  @Prop({ type: String, enum: ['user', 'ai', 'system'], required: true })
  senderType: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: String, enum: ['text', 'branch_context', 'sediment_snapshot', 'cross_reference'], default: 'text' })
  messageType: string;                     // 消息类型

  @Prop({ type: Number })
  sequence: number;                        // 线内消息序号

  @Prop({ type: [Object], default: [] })
  branchSuggestions: Array<{               // AI 建议的分叉点
    id: string;                            // 建议 ID（用于前端标识）
    topic: string;
    reason: string;
    status: 'pending' | 'accepted' | 'dismissed';
  }>;

  @Prop({ type: [Object], default: [] })
  mentions: Array<{                        // @ 提及记录
    participantId: string;
    displayName: string;
    offset: number;                        // 在 content 中的位置
  }>;

  @Prop({ type: [Object], default: [] })
  crossReferences: Array<{                 // 交叉引用
    threadId: string;
    threadTitle: string;
    messageId: string;
    summary: string;
  }>;

  @Prop({ type: [String], default: [] })
  knowledgeEntryIds: string[];             // 本次回复引用/产生的知识条目

  @Prop({ type: Object })
  metadata: {
    tokens?: number;
    cost?: number;
    model?: string;
    agentId?: string;                      // AI Agent 回复时的 agent ID
    searchesPerformed?: number;
    knowledgeHits?: number;                // 知识库命中数
    contextCompressionApplied?: boolean;   // 是否触发了上下文压缩
  };
}

// 索引
DiscussionMessageSchema.index({ threadId: 1, sequence: 1 });
DiscussionMessageSchema.index({ spaceId: 1, createdAt: -1 });
DiscussionMessageSchema.index({ participantId: 1 });
DiscussionMessageSchema.index({ 'mentions.participantId': 1 });
```

#### 7.2.4 DiscussionParticipant（讨论参与者）

```typescript
@Schema({ timestamps: true, collection: 'discussion_participants' })
export class DiscussionParticipant {
  @Prop({ required: true })
  spaceId: string;

  @Prop({ type: String, enum: ['human', 'ai_agent'], required: true })
  type: string;

  @Prop()
  userId: string;                          // 真人：关联 user/employee ID

  @Prop()
  agentId: string;                         // AI Agent：关联 agent ID

  @Prop({ required: true })
  displayName: string;                     // 显示名称

  @Prop()
  avatar: string;                          // 头像 URL（可选）

  @Prop({ type: String, enum: ['primary', 'on_demand'], required: true })
  role: string;                            // primary = 默认始终响应, on_demand = @ 时响应

  @Prop()
  expertise: string;                       // 专业领域描述（AI Agent 用于 system prompt 注入）

  @Prop({ type: [String], default: [] })
  expertiseTags: string[];                 // 专业领域标签（用于 AI 自动判断是否建议 @）

  @Prop({ type: String, enum: ['online', 'offline', 'idle'], default: 'offline' })
  presence: string;

  @Prop({ type: Date })
  lastActiveAt: Date;

  @Prop({ type: Number, default: 0 })
  messageCount: number;                    // 在此空间中的发言数

  @Prop({ type: Number, default: 0 })
  knowledgeContribution: number;           // 贡献的知识条目数（仅 AI Agent）
}

// 索引
DiscussionParticipantSchema.index({ spaceId: 1, role: 1 });
DiscussionParticipantSchema.index({ userId: 1 });
DiscussionParticipantSchema.index({ agentId: 1 });
```

#### 7.2.5 DiscussionKnowledgeEntry（知识条目）

```typescript
@Schema({ timestamps: true, collection: 'discussion_knowledge_entries' })
export class DiscussionKnowledgeEntry {
  @Prop({ required: true })
  spaceId: string;

  @Prop({ required: true })
  participantId: string;                   // 由哪个 AI Agent 积累

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;                         // 知识内容（Markdown）

  @Prop({ required: true })
  summary: string;                         // 一句话摘要（用于快速检索展示）

  @Prop()
  sourceUrl: string;                       // 来源 URL

  @Prop({ type: String, enum: ['web_search', 'api', 'document', 'user_input', 'discussion_derived'], required: true })
  sourceType: string;

  @Prop()
  sourceName: string;                      // 来源名称（如 "IEA", "Reuters"）

  @Prop({ type: [String], default: [] })
  domainTags: string[];                    // 领域标签（如 "能源", "原油", "新能源"）

  @Prop({ type: [String], default: [] })
  topicTags: string[];                     // 话题标签（如 "信息检索", "OPEC减产"）

  @Prop({ type: [String], default: [] })
  keywordTags: string[];                   // 关键词标签（自动提取）

  @Prop({ type: String, enum: ['high', 'medium', 'low', 'unverified'], default: 'unverified' })
  credibility: string;

  @Prop({ type: Object })
  credibilityDetail: {
    sourceAuthority: 'high' | 'medium' | 'low' | 'unknown';  // 来源权威性
    contentFreshness: 'current' | 'recent' | 'dated';         // 内容时效性
    crossValidated: boolean;               // 是否有交叉验证
    userOverride: boolean;                 // 用户是否手动修正过
    lastAssessedAt: Date;
  };

  @Prop()
  threadId: string;                        // 在哪个讨论线中积累

  @Prop()
  messageId: string;                       // 关联到具体哪条消息

  @Prop({ type: Number, default: 0 })
  referenceCount: number;                  // 被后续讨论引用的次数

  @Prop({ type: Date })
  contentDate: Date;                       // 知识内容的时间（如新闻日期）

  @Prop({ type: Boolean, default: true })
  isActive: boolean;                       // 是否有效（用户可标记为过时）
}

// 索引
DiscussionKnowledgeEntrySchema.index({ spaceId: 1, isActive: 1 });
DiscussionKnowledgeEntrySchema.index({ participantId: 1 });
DiscussionKnowledgeEntrySchema.index({ domainTags: 1 });
DiscussionKnowledgeEntrySchema.index({ topicTags: 1 });
DiscussionKnowledgeEntrySchema.index({ keywordTags: 1 });
DiscussionKnowledgeEntrySchema.index({ credibility: 1, referenceCount: -1 });
DiscussionKnowledgeEntrySchema.index({ spaceId: 1, '$**': 'text' }, { name: 'knowledge_text_search' }); // 全文搜索
```

### 7.3 后端模块设计

#### 7.3.1 模块结构

```
apps/agents/src/modules/discussion/
├── discussion.module.ts
├── discussion.controller.ts                  # Space CRUD + 全局操作
├── discussion-thread.controller.ts           # Thread + Message 操作
├── discussion-knowledge.controller.ts        # 知识库操作
├── services/
│   ├── discussion-space.service.ts           # Space 生命周期管理
│   ├── discussion-thread.service.ts          # Thread 创建、分叉、切换、树构建
│   ├── discussion-message.service.ts         # 消息收发、序列管理
│   ├── discussion-participant.service.ts     # 参与者管理、@ 解析与路由
│   ├── discussion-knowledge.service.ts       # 知识积累引擎（搜索→文档化→标签化→可信度）
│   ├── discussion-sediment.service.ts        # 文档沉淀（手动+实时+导出）
│   ├── discussion-ai-response.service.ts     # AI 回复生成（含分叉建议、知识检索、上下文构建）
│   └── discussion-context-compression.service.ts  # 上下文压缩与 Token 管理
├── dto/
│   ├── create-space.dto.ts
│   ├── update-space.dto.ts
│   ├── create-thread.dto.ts
│   ├── branch-thread.dto.ts
│   ├── send-message.dto.ts
│   ├── add-participant.dto.ts
│   ├── sediment-document.dto.ts
│   ├── update-knowledge.dto.ts
│   └── query-knowledge.dto.ts
└── types/
    └── discussion.types.ts
```

#### 7.3.2 核心 API 设计

**Space 管理**

| Method | Path | 说明 |
|--------|------|------|
| POST | `/discussions` | 创建讨论空间（含初始参与者配置） |
| GET | `/discussions` | 列表查询（支持 status / tags / creatorId 过滤） |
| GET | `/discussions/:spaceId` | 获取详情（含完整线程树 + 参与者列表 + 统计） |
| PUT | `/discussions/:spaceId` | 更新设置（含沉淀模式切换、分叉深度配置等） |
| PUT | `/discussions/:spaceId/status` | 更新状态（active / paused / archived） |
| DELETE | `/discussions/:spaceId` | 归档讨论空间 |

**Thread 管理**

| Method | Path | 说明 |
|--------|------|------|
| POST | `/discussions/:spaceId/threads` | 创建讨论线（分叉，含 branchFromMessageId + contextSummary 自动生成） |
| GET | `/discussions/:spaceId/threads` | 获取讨论线树（完整层级结构） |
| GET | `/discussions/:spaceId/threads/:threadId` | 获取单条讨论线详情 + 摘要 |
| PUT | `/discussions/:spaceId/threads/:threadId` | 更新讨论线（标题、摘要、状态） |
| POST | `/discussions/:spaceId/threads/:threadId/conclude` | 结束讨论线（触发 AI 生成最终摘要） |

**消息**

| Method | Path | 说明 |
|--------|------|------|
| POST | `/discussions/:spaceId/threads/:threadId/messages` | 发送消息（自动解析 @ 提及、触发 AI 响应） |
| GET | `/discussions/:spaceId/threads/:threadId/messages` | 获取消息列表（分页、含交叉引用展开） |
| GET | `/discussions/:spaceId/threads/:threadId/messages/stream` | SSE 流式获取 AI 回复（含分叉建议、知识引用） |
| POST | `/discussions/:spaceId/threads/:threadId/messages/:messageId/branch` | 从指定消息创建分叉 |
| PUT | `/discussions/:spaceId/threads/:threadId/messages/:messageId/branch-suggestions/:sugId` | 处理 AI 分叉建议（accept / dismiss） |
| POST | `/discussions/:spaceId/threads/:threadId/messages/:messageId/cross-reference` | 添加交叉引用 |

**参与者**

| Method | Path | 说明 |
|--------|------|------|
| POST | `/discussions/:spaceId/participants` | 添加参与者（真人/AI Agent） |
| GET | `/discussions/:spaceId/participants` | 获取参与者列表（含在线状态、发言统计） |
| PUT | `/discussions/:spaceId/participants/:participantId` | 更新参与者（角色、专业领域等） |
| DELETE | `/discussions/:spaceId/participants/:participantId` | 移除参与者 |

**知识库**

| Method | Path | 说明 |
|--------|------|------|
| GET | `/discussions/:spaceId/knowledge` | 获取知识条目列表（支持 domainTags / topicTags / credibility / 全文搜索） |
| GET | `/discussions/:spaceId/knowledge/:entryId` | 获取知识条目详情 |
| PUT | `/discussions/:spaceId/knowledge/:entryId` | 修正知识条目（可信度、标签、内容、isActive） |
| DELETE | `/discussions/:spaceId/knowledge/:entryId` | 删除知识条目 |
| GET | `/discussions/:spaceId/knowledge/stats` | 知识库统计（按标签分布、可信度分布、来源分布） |

**文档沉淀**

| Method | Path | 说明 |
|--------|------|------|
| POST | `/discussions/:spaceId/sediment` | 手动触发沉淀（可指定讨论线范围、沉淀深度） |
| GET | `/discussions/:spaceId/sediment` | 获取最新沉淀文档 |
| GET | `/discussions/:spaceId/sediment/history` | 获取沉淀历史版本列表 |
| GET | `/discussions/:spaceId/sediment/history/:version` | 获取指定版本沉淀文档 |
| GET | `/discussions/:spaceId/sediment/outline` | 获取实时文档大纲（realtime 模式） |
| GET | `/discussions/:spaceId/sediment/outline/stream` | SSE 实时推送大纲更新 |
| POST | `/discussions/:spaceId/sediment/export` | 导出沉淀文档（Markdown 文件） |

### 7.4 核心机制设计

#### 7.4.1 对话分叉机制

**用户主动分叉**：
```
用户选中某条消息 → "从这里分叉讨论" → 输入子话题标题
  → 后端创建子 Thread：
      1. 设置 parentThreadId、branchFromMessageId、depth = parent.depth + 1
      2. AI 自动生成 contextSummary：将父线从开头到分叉点的对话压缩为摘要
      3. contextSummary 作为子 Thread 的首条 system message 注入
      4. 更新父 Thread.childThreadIds
  → 前端切换到新 Thread，左侧树状导航更新
```

**AI 分叉建议**：
```
AI 生成回复时 → 分析回复内容 → 识别可独立展开的子话题
  → 生成 branchSuggestions：
      每个建议包含 { id, topic, reason, status: 'pending' }
  → 前端在 AI 回复下方渲染建议标签
  → 用户点击"采纳" → 自动创建子 Thread（branchOrigin = 'ai_suggestion'）
  → 用户点击"忽略" → 标记 status = 'dismissed'

AI 分叉建议的 prompt 策略：
  在 AI response 的 system prompt 中追加指令：
  "分析你的回复内容，识别其中值得独立深入讨论的子话题（最多 2 个）。
   对每个子话题给出 topic（5-15 字标题）和 reason（为什么值得展开）。
   仅在话题确实有足够深度值得独立讨论时才建议分叉。"
```

**分叉上下文传递策略**：
```
父线消息: [M1, M2, M3, M4, M5(分叉点), M6, M7...]
                          ↓
子线收到的上下文:
  [SystemMessage: "以下是父讨论线的背景摘要：{AI 生成的 M1-M5 摘要}"]
  [SystemMessage: "本讨论线聚焦话题：{子线标题}"]
  → 然后用户/AI 在子线中继续对话
```

#### 7.4.2 AI Agent 知识积累引擎

**完整链路**：

```
Step 1: 知识需求判断
  AI Response Service 收到用户消息 →
  构建 prompt 时追加指令：
    "判断是否需要外部信息来回答用户问题。
     如果需要，输出 [SEARCH_NEEDED: {query}] 标记。"
  → 解析 AI 输出中的搜索标记

Step 2: 知识库优先检索
  → Knowledge Service 根据当前话题的关键词 + 标签
  → 在 discussion_knowledge_entries 中检索：
      a) 精确标签匹配（domainTags + topicTags）
      b) 全文搜索（MongoDB text index）
      c) 按 credibility DESC, referenceCount DESC 排序
  → 命中足够数量（≥3 条相关知识） → 直接使用，跳过搜索
  → 命中不足 → 进入外部搜索

Step 3: 外部搜索
  → 复用 Agent Tool 体系调用搜索工具（web_search 等）
  → 搜索结果返回

Step 4: 文档化
  → 对每条搜索结果：
      提取标题、核心内容（去噪）、来源 URL、来源名称
      AI 生成 summary（一句话摘要）
      生成 Markdown 格式的 content

Step 5: 标签化
  → AI 自动打标签：
      domainTags: 基于讨论空间主题 + 内容语义分析
      topicTags: 基于所在讨论线标题 + 内容关键词
      keywordTags: 基于 NLP 关键词提取（TF-IDF 风格）

Step 6: 可信度评估
  → credibilityDetail 自动填充：
      sourceAuthority: 预置权威来源白名单（IEA/OPEC/Reuters/Bloomberg → high）
      contentFreshness: 根据 contentDate 与当前日期差值判断
      crossValidated: 同一事实是否有多个来源佐证
  → 综合评分映射为 credibility 等级

Step 7: 入库
  → 创建 DiscussionKnowledgeEntry
  → 关联 threadId / messageId / participantId
  → 更新 Space.statistics.totalKnowledgeEntries

Step 8: 回复生成
  → 将已有知识 + 新搜索知识注入 AI prompt 上下文
  → 生成回复时在 metadata 中记录 knowledgeEntryIds
  → 更新被引用知识条目的 referenceCount
```

**知识跨讨论复用**：
- 同一 Space 内所有 Thread 共享知识库
- 检索时不限定 threadId，按标签 + 相关性排序
- 高 referenceCount 的知识条目优先展示

#### 7.4.3 多角色 @ 唤醒机制

```
用户输入 "@能源Owner 帮我分析一下OPEC最新的减产决策" →

Step 1: @ 解析
  → Message Service 解析消息中的 @mentions
  → 匹配 DiscussionParticipant.displayName
  → 填充 message.mentions[]

Step 2: 路由分发
  → Participant Service 根据 participant.type 路由：

  ┌→ type = 'ai_agent'（即时响应）:
  │   → 加载 Agent 配置（model、systemPrompt）
  │   → 注入 participant.expertise 到 system prompt
  │   → 注入该 Agent 积累的知识库条目（按相关性 top-K）
  │   → 通过 AgentExecutor 生成回复
  │   → 回复的 metadata.agentId 标记为该 Agent
  │   → SSE 流式推送到前端
  │
  └→ type = 'human'（异步通知）:
      → WebSocket 推送实时通知到该用户前端
      → MessageCenter 发送通知（支持离线查看）
      → 通知内容包含：讨论空间标题、讨论线标题、消息摘要、跳转链接
      → 真人回复时：
          自动关联到对应 threadId
          消息 senderType = 'user'
          触发默认主 Agent 的后续响应（如有需要）
```

**多 AI Agent 同时 @ 场景**：
```
用户: "@能源Owner @CTO 你们分别从业务和技术角度评估一下这个方案"
  → 解析出 2 个 AI mentions
  → 按 mention 顺序依次触发（非并行，避免上下文冲突）
  → 每个 Agent 的回复作为独立消息，各自标记发送者
  → 后一个 Agent 可看到前一个 Agent 的回复作为上下文
```

#### 7.4.4 文档沉淀机制

**手动触发沉淀**：
```
用户触发 POST /discussions/:spaceId/sediment
  Body: {
    threadScope: ['thread-1', 'thread-2'],  // 可选，指定讨论线范围（默认全部）
    includeKnowledge: true,                 // 是否包含知识库引用
    format: 'comprehensive' | 'summary'     // 详尽版 / 摘要版
  }

→ Sediment Service:
  1. 收集目标讨论线的全部消息
  2. 收集相关知识条目（被引用的）
  3. 构建沉淀 prompt，指导 AI 整理为：
     ## 讨论主题
     ## 背景
     ## 各讨论线核心结论
       ### 讨论线 A: {title}
       - 核心结论
       - 关键论据（引用知识条目）
       ### 讨论线 B: {title}
       - ...
     ## 知识库摘要
       - 高可信度知识点列表
     ## 待解决问题
     ## 行动项
     ## 参与者贡献摘要
  4. 存入 sedimentHistory[]，更新 latestSedimentedDocument
  5. 返回沉淀文档内容
```

**实时沉淀模式**：
```
Space.sedimentMode = 'realtime' 时：

每次 AI 回复后 → Sediment Service 异步触发：
  1. 分析新消息是否包含可沉淀内容：
     - 新结论/观点
     - 新事实/数据
     - 新问题/待办
     - 新知识引用
  2. 更新 documentOutline（JSON 结构）：
     {
       sections: [
         { title: "...", points: [...], threadId: "..." },
         ...
       ],
       openQuestions: [...],
       actionItems: [...],
       lastUpdatedAt: Date
     }
  3. 通过 SSE (sediment/outline/stream) 推送大纲更新到前端
  4. 前端右侧面板实时刷新大纲
  5. 用户可在面板中编辑大纲（PUT 更新）
```

**文档导出**：
```
POST /discussions/:spaceId/sediment/export
  → 将 latestSedimentedDocument 生成 .md 文件
  → 上传到 MinIO
  → 返回下载链接
```

#### 7.4.5 上下文压缩与 Token 管理

```
讨论深入后，单次 AI 回复需要的上下文可能包括：
  - 当前 Thread 的历史消息
  - 父 Thread 的上下文摘要（contextSummary）
  - 交叉引用的其他 Thread 内容
  - 知识库检索结果
  - 参与者 expertise 描述
  → 可能远超单次 prompt 的 token 限制

Context Compression Service 策略：

1. 消息滑动窗口
   → 当前 Thread 保留最近 N 条完整消息（N 根据 model maxTokens 动态计算）
   → 更早的消息压缩为摘要（AI 生成 thread summary）

2. 分层摘要
   → 父线上下文：使用 contextSummary（创建子线时已生成）
   → 交叉引用：仅注入引用的 summary 字段，不注入全文

3. 知识库 RAG
   → 不全量注入知识库，而是根据当前消息做相关性检索
   → 取 top-K 条（K 根据剩余 token 预算动态调整）
   → 按 credibility + referenceCount 加权排序

4. Token 预算分配
   → 总预算 = model.maxTokens - 预留回复 token
   → system prompt: 15%
   → 知识库注入: 20%
   → 当前 Thread 消息: 50%
   → 父线摘要 + 交叉引用: 15%
   → 动态调整：知识库命中少时让渡给消息窗口
```

#### 7.4.6 讨论线交叉引用

```
用户在 Thread B 中想引用 Thread A 的某个结论：

方式 1: 手动引用
  → 用户在 Thread B 输入框中选择 "引用其他讨论线"
  → 弹出选择器：展示所有 Thread 列表 + 搜索
  → 选择 Thread A 的某条消息
  → 系统自动：
      a) 在 Thread B 当前消息中添加 crossReferences[]
      b) 将 Thread A 被引用消息的摘要注入到 Thread B 的 AI 上下文

方式 2: AI 自动引用
  → AI 回复时判断其他 Thread 中有相关结论
  → 在回复中自动标注引用来源：
     "根据在「信息检索工程化」讨论线中的结论..."
  → crossReferences 自动填充

前端展示：
  → 交叉引用在消息中渲染为可点击的引用卡片
  → 点击跳转到源 Thread 的对应消息
  → 引用卡片显示：源线标题 + 消息摘要
```

### 7.5 前端页面设计

#### 7.5.1 页面路由

```
/discussions                           → 讨论空间列表页
/discussions/:spaceId                  → 讨论空间详情页（三栏布局）
```

#### 7.5.2 组件结构

```
frontend/src/
├── pages/
│   ├── Discussions.tsx                 # 列表页
│   └── discussions/
│       └── DiscussionDetail.tsx        # 详情页（三栏布局容器）
├── components/
│   └── discussion/
│       ├── SpaceList.tsx               # 空间列表（含创建、搜索、过滤）
│       ├── SpaceCreateModal.tsx        # 创建空间弹窗（含参与者配置）
│       ├── ThreadTree.tsx              # 左侧：讨论线树状导航
│       ├── ThreadTreeNode.tsx          # 树节点组件（递归渲染）
│       ├── ChatView.tsx               # 中央：对话视图
│       ├── MessageBubble.tsx          # 消息气泡（含分叉建议、交叉引用）
│       ├── BranchSuggestionTag.tsx    # AI 分叉建议标签
│       ├── CrossReferenceCard.tsx     # 交叉引用卡片
│       ├── MessageInput.tsx           # 输入框（含 @ 提及）
│       ├── MentionSelector.tsx        # @ 提及参与者选择器
│       ├── BranchModal.tsx            # 分叉弹窗（输入子话题标题）
│       ├── ContextPanel.tsx           # 右侧：上下文面板容器
│       ├── SedimentPanel.tsx          # 文档沉淀面板
│       ├── SedimentOutline.tsx        # 实时大纲组件
│       ├── KnowledgePanel.tsx         # 知识库面板
│       ├── KnowledgeEntryCard.tsx     # 知识条目卡片
│       ├── KnowledgeEditModal.tsx     # 知识条目编辑弹窗
│       ├── ParticipantPanel.tsx       # 参与者面板
│       ├── ParticipantAvatar.tsx      # 参与者头像（含在线状态）
│       └── SpaceSettingsDrawer.tsx    # 空间设置抽屉
├── services/
│   └── discussionService.ts           # API 服务层
├── stores/
│   └── discussionStore.ts             # Zustand store
└── hooks/
    ├── useDiscussionSSE.ts            # AI 回复 SSE hook
    ├── useDiscussionSedimentSSE.ts    # 实时沉淀 SSE hook
    └── useDiscussionWebSocket.ts      # 实时通知 WebSocket hook
```

#### 7.5.3 详情页三栏布局

```
┌──────────────────┬───────────────────────────────┬────────────────────┐
│    左侧 (250px)  │         中央 (flex-1)          │   右侧 (320px)     │
│                  │                               │                    │
│  ┌────────────┐  │  ┌─────────────────────────┐  │  [Tab: 文档|知识|人]│
│  │ 讨论线树    │  │  │                         │  │                    │
│  │            │  │  │  💬 你: 我想系统性地跟   │  │  ┌──────────────┐ │
│  │  📋 主线   │  │  │     踪全球能源公司动态   │  │  │ 📄 文档沉淀  │ │
│  │  ├─ 🔀 信息│  │  │                         │  │  │              │ │
│  │  │  检索工程│  │  │  🤖 主Agent: 可以从以下 │  │  │ 模式: [手动] │ │
│  │  │  ├─ 数据 │  │  │     几个维度入手...     │  │  │ [实时沉淀 ○] │ │
│  │  │  │ 管道  │  │  │                         │  │  │              │ │
│  │  │  └─ API  │  │  │  💡 建议展开:           │  │  │ ▸ 讨论主题   │ │
│  │  │   集成   │  │  │    「信息检索工程化」    │  │  │ ▸ 核心结论   │ │
│  │  └─ 🔀 内容│  │  │    「内容分类体系」     │  │  │ ▸ 待解决问题 │ │
│  │     分类    │  │  │                         │  │  │              │ │
│  │            │  │  │  👤 你: @能源Owner       │  │  │ [沉淀文档]   │ │
│  ├────────────┤  │  │     帮我分析一下OPEC...  │  │  │ [导出]       │ │
│  │ 参与者      │  │  │                         │  │  ├──────────────┤ │
│  │ 🟢 你      │  │  │  🌐 能源Owner:          │  │  │ 📚 知识库    │ │
│  │ 🟢 主Agent │  │  │     (搜索中...)          │  │  │ (12 条)      │ │
│  │ ⚫ CTO     │  │  │     根据IEA最新报告...   │  │  │              │ │
│  │ 🟢 能源Own │  │  │     📎 引用知识: IEA报告 │  │  │ 🏷 能源(8)   │ │
│  │            │  │  │                         │  │  │ 🏷 原油(5)   │ │
│  ├────────────┤  │  └─────────────────────────┘  │  │ 🏷 OPEC(3)  │ │
│  │ ⚙ 设置    │  │  ┌─────────────────────────┐  │  │              │ │
│  │ 沉淀模式   │  │  │ @ 输入消息...           │  │  │ ▸ IEA 月报   │ │
│  │ AI分叉建议 │  │  │ [发送]                  │  │  │   ⭐ high    │ │
│  │ 知识自动积累│  │  └─────────────────────────┘  │  │ ▸ OPEC 减产  │ │
│  └────────────┘  │                               │  │   ⭐ medium  │ │
│                  │                               │  └──────────────┘ │
└──────────────────┴───────────────────────────────┴────────────────────┘
```

### 7.6 与现有系统的复用关系

| 现有能力 | 复用方式 |
|----------|----------|
| AgentExecutor + Engine | AI 回复生成复用现有 Agent 执行引擎（native-streaming） |
| ModelRegistry | 模型选择复用现有模型注册中心 |
| Tool 体系 | 知识积累的外部搜索复用现有 Tool 执行链路（web_search 等工具） |
| WebSocket (ws app) | 真人 @ 通知、实时消息推送复用 ws 服务 |
| MessageCenter | 真人 @ 离线通知复用消息中心 |
| AgentMemo | 知识积累与 Memo 系统可选互通（高价值知识可同步为 Memo） |
| Redis 事件总线 | 跨服务事件通信复用 @libs/infra Redis 服务 |
| MinIO | 沉淀文档导出存储 |
| SSE stream.controller | AI 流式回复复用现有 SSE 推送模式 |

### 7.7 技术选型决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 模块归属 | `apps/agents/` | Discussion Space 核心是 AI Agent 驱动的对话，与 agents 服务内聚 |
| 树状对话存储 | 扁平 Collection + parentThreadId + childThreadIds 双向引用 | 比嵌套文档更灵活，支持无限深度分叉，双向引用加速树构建 |
| 知识库存储 | 独立 Collection + MongoDB text index | 与 AgentMemo 分离（知识有来源、可信度等独立属性），text index 支持全文检索 |
| 知识标签体系 | 三层标签（domain / topic / keyword） | 分层标签支持粗粒度浏览（domain）到细粒度检索（keyword） |
| AI 回复流式 | SSE | 与项目现有 SSE 方案一致 |
| 实时沉淀推送 | 独立 SSE 端点 | 文档大纲更新频率低于消息流，独立端点避免混合 |
| 前端状态管理 | react-query（服务端数据）+ Zustand（UI 状态） | 与项目现有方案一致 |
| 上下文压缩 | 分层摘要 + 滑动窗口 + 动态 token 预算 | 平衡信息完整度和 token 消耗 |

## 8. 风险与依赖

### 风险

1. **前端交互复杂度**：树状对话 UI + 三栏布局 + 实时更新是最大的前端挑战，需要仔细设计"我在哪条线上"的视觉指引和动画过渡，避免用户迷失
2. **知识质量管控**：Agent 搜索积累的知识可能不准确，可信度评估算法需要持续调优，用户审核/修正机制是关键兜底手段
3. **上下文窗口管理**：多讨论线 + 交叉引用 + 知识库 RAG 会显著增加 prompt token 消耗，上下文压缩策略需要在信息完整度和成本之间找到平衡
4. **AI 分叉建议质量**：建议过多会干扰用户，建议不准会降低信任度，需要调优 prompt 策略和建议频率
5. **多 Agent 上下文一致性**：多个 AI Agent 在同一讨论线中发言时，需要确保各自的上下文视图一致且不冲突
6. **实时沉淀性能**：realtime 模式下每条消息都触发大纲更新，需要异步处理 + 防抖，避免阻塞主对话流

### 依赖

1. 依赖现有 Agent 执行引擎（AgentExecutor）的稳定性和流式输出能力
2. 依赖现有 Tool 体系支持搜索类工具（web_search 等）
3. 依赖 WebSocket 服务（ws app）的通知推送能力
4. 依赖 MessageCenter 的通知分发能力
5. 真人参与者需要已有系统账号（Employee/User）
6. 依赖 MinIO 用于文档导出存储

## 9. 备注

- 本功能为全新独立模块，不改造现有 Meeting/Chat 功能
- 前端新增路由：`/discussions`、`/discussions/:spaceId`，归属侧边栏新分组"讨论空间"
- 研发智能边界红线：前端保留在主应用 `frontend/` 内，不新增独立前端工程
- `organizationId` 禁止项：本模块不引入 organizationId
- 分叉深度不设硬限制，但在 Space.settings 中提供可配置的 maxBranchDepth 供用户按需设置
- 知识库设计为 Space 级别隔离，后续可考虑跨 Space 知识共享（需单独评估）

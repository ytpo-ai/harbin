# Plan: DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md)、[PROJECT_INCUBATION](../feature/PROJECT_%20INCUBATION.md) |
| 需求管理 ID | — |
| 所属项目 | — |
| OpenCode Session | — |
| 状态 | approved |
| 优先级 | high |
| 创建日期 | 2026-04-30 |

## 2. 背景

### 2.1 业务驱动

系统已具备两个核心能力：
- **讨论空间**：树状分叉讨论、多角色协作、知识沉淀、文档沉淀
- **工程智能**：项目管理、需求管理、编排执行、定时调度、OpenCode 同步

后续系统将孵化**行业观察类项目**（如区块链 Web3、能源、AI 等），核心需求是：
1. 在讨论空间完成头脑风暴和项目规划（大纲生成、知识库丰富）
2. 根据讨论结论识别需要通过脚本定期采集的结构化数据
3. 通过工程智能完成采集脚本开发、定时执行、数据存储与展示
4. 采集到的新数据反哺讨论空间，形成持续的分析和知识更新

这要求**讨论空间与工程智能完美协作**，形成"讨论驱动开发，开发反哺讨论"的闭环。

### 2.2 现状问题

#### 问题 1：讨论空间缺少分类概念
- 创建空间时只有主题、描述、标签、关联项目、初始 Agent，没有空间分类/类型
- 无法基于分类触发不同的初始化行为（如"行业观察"类自动生成大纲）

#### 问题 2：知识库与沉淀文档的能力边界模糊
- **知识库**（`discussion_knowledge_entries`）：独立集合，结构化条目，但缺乏主动积累能力（Agent 不会自主搜索补充）
- **沉淀文档**（`sedimentHistory`）：嵌入 Space 文档的 Markdown 文本，但只是讨论摘要，没有大纲驱动能力
- 两者缺乏明确的**生产关系**：大纲应指导知识积累方向，知识应充实大纲内容

#### 问题 3：讨论空间与工程智能零交互
- EI 服务中没有对 Discussion 模块的任何引用
- Discussion 服务中没有对 EI 的任何引用
- 孵化项目聚合查询中不包含讨论空间
- `discussion_spaces.projectId` 字段存在但未与孵化项目建立实际关联

### 2.3 典型场景

以"区块链 Web3 行业观察"为例：
```
1. 创建孵化项目"Web3行业观察"
2. 在讨论空间中创建"行业观察"类讨论，关联该项目
3. Agent 自动生成 Web3 行业观察大纲（行业脉络、TOP公司、关键人物、趋势叙事...）
4. 人类与 Agent 在讨论中完善大纲，Agent 按大纲章节主动搜索并积累知识
5. 讨论中识别出需要定期采集的数据维度（如 DeFi TVL、交易所交易量...）
6. 将数据采集需求转为 EI 需求条目，由工程智能完成脚本开发和定时采集
7. 采集到的新数据自动推送回讨论空间，更新知识库，触发新一轮分析
```

## 3. 目标

### 3.1 总体目标
打通"讨论空间 ↔ 工程智能"的完整协作闭环，使系统具备孵化行业观察类项目的端到端能力。

### 3.2 分阶段目标

| Phase | 目标 | 交付物 |
|-------|------|--------|
| Phase 0 | 讨论空间分类、大纲驱动、知识库/沉淀职责重定义 | 讨论空间能力升级 |
| Phase 1 | 孵化项目与讨论空间基础连接 | 聚合查询、前端 Tab |
| Phase 2 | 讨论 → 需求/任务的转化能力 | 转需求动作、来源追溯 |
| Phase 3 | 数据采集框架 | 数据源管理、采集执行、数据存储与展示 |
| Phase 4 | 闭环协作（讨论 ↔ 数据双向流动） | 数据回灌讨论、大纲模板 |

## 4. 执行步骤

### Phase 0：讨论空间分类与大纲驱动能力

> **目标**：让讨论空间具备"分类 → 大纲 → 知识积累 → 文档产出"的结构化能力。

#### 0.1 空间分类（Space Category）

**Schema 改动**：在 `discussion-space.schema.ts` 中新增 `category` 字段。

```typescript
@Prop({
  type: String,
  enum: ['general', 'industry_observation', 'product_discussion', 'technical_design'],
  default: 'general'
})
category: string;
```

| 分类值 | 含义 | 初始化行为 |
|--------|------|-----------|
| `general` | 通用讨论（默认） | 无特殊初始化，保持当前行为 |
| `industry_observation` | 行业观察 | 自动生成行业观察大纲，初始化知识积累框架 |
| `product_discussion` | 产品讨论 | 预留，后续可定义产品讨论模板 |
| `technical_design` | 技术方案 | 预留，后续可定义技术评审模板 |

**前端改动**：`SpaceCreateModal.tsx` 中新增分类选择器。

- 分类选择放在主题输入之前，作为空间创建的首要决策
- 选择不同分类后，表单下方展示该分类的简要说明
- `industry_observation` 分类选中后，可额外输入"观察行业"（如"区块链Web3"、"新能源"），用于 Agent 生成大纲时的行业上下文

**后端改动**：
- `CreateSpaceDto` 新增 `category` 和 `industryContext`（可选，仅 `industry_observation` 时填写）字段
- `discussion-space.service.ts` 的 `createSpace` 方法根据 `category` 分发初始化策略
- 新增索引 `{ category: 1, status: 1 }`

#### 0.2 文档大纲升级为空间核心骨架（Document Outline）

**现状**：`documentOutline` 字段已存在于 `DiscussionSpace` schema，但结构不明确（`Record<string, any>`），仅在实时沉淀中简单使用。

**升级目标**：将 `documentOutline` 定义为结构化的大纲模型，作为空间的内容骨架。

**新的 DocumentOutline 类型定义**：

```typescript
interface OutlineSection {
  id: string;                        // UUID，章节唯一标识
  title: string;                     // 章节标题
  description?: string;              // 章节说明（指导知识积累方向）
  parentSectionId?: string;          // 父章节 ID（支持多层嵌套）
  order: number;                     // 排序序号
  depth: number;                     // 嵌套层级（0=顶级）
  status: 'draft' | 'enriching' | 'sufficient' | 'review';
                                     // 章节知识积累状态
  knowledgeCount: number;            // 关联知识条目数（冗余，便于统计）
  childSectionIds: string[];         // 子章节 ID 列表
  metadata?: {
    suggestedDataSources?: string[]; // 建议的数据源（Agent 生成）
    collectFrequency?: string;       // 建议采集频率（daily/weekly/monthly）
    isStructuredData?: boolean;      // 是否建议通过脚本结构化采集
  };
}

interface DocumentOutline {
  version: number;                   // 大纲版本号
  title: string;                     // 大纲总标题
  sections: OutlineSection[];        // 所有章节（扁平数组，通过 parentSectionId 构建树）
  createdAt: Date;
  updatedAt: Date;
  generatedBy: 'agent' | 'human' | 'hybrid';  // 大纲生成方式
  agentId?: string;                  // 生成大纲的 Agent ID
  runId?: string;                    // 生成大纲的 Agent Run ID
  sessionId?: string;                // 生成大纲的 Agent Session ID
}
```

**前端大纲视图**：
- 在右侧面板增加"大纲"Tab（与"沉淀"、"知识"、"参与者"并列）
- 大纲以树状结构展示，每个章节显示：
  - 标题 + 描述
  - 知识积累状态徽标（`draft`=灰色、`enriching`=蓝色、`sufficient`=绿色、`review`=橙色）
  - 关联知识条目数
  - 点击章节可展开查看该章节下的知识条目
- 支持大纲编辑：修改标题/描述、调整排序、增删章节
- 支持"让 Agent 丰富此章节"快捷操作

#### 0.3 知识库与沉淀文档的职责重定义

**核心理念**：
- **知识库** = 原子化知识积累池（事实、数据点、观点、引用）
- **沉淀文档** = 结构化文档产出（基于大纲 + 知识自动组装的报告/方案/分析）
- **大纲** = 两者之间的桥梁（指导知识积累方向，组织沉淀文档结构）

**知识条目 Schema 改动**：

在 `discussion-knowledge-entry.schema.ts` 中新增字段：

```typescript
@Prop()
outlineSectionId?: string;           // 归属的大纲章节 ID

@Prop({ type: String, enum: ['fact', 'data_point', 'opinion', 'source_reference', 'analysis', 'action_item'], default: 'fact' })
entryType?: string;                  // 知识条目类型

@Prop({ type: Object })
structuredData?: {                   // 结构化数据（如果是数据点类型）
  value?: string | number;
  unit?: string;
  measureDate?: Date;
  compareTo?: {
    value: string | number;
    period: string;
    changePercent?: number;
  };
};
```

新增索引：`{ spaceId: 1, outlineSectionId: 1 }`

**知识条目类型说明**：

| 类型 | 含义 | 典型内容 |
|------|------|---------|
| `fact` | 确定事实 | "2026年Q1以太坊完成Proto-Danksharding升级" |
| `data_point` | 数据点 | "DeFi TVL 达到 1500 亿美元，同比增长 45%" |
| `opinion` | 观点/预测 | "Vitalik 认为 ZK-Rollups 将在 2026 年成为主流" |
| `source_reference` | 来源引用 | 某份研究报告的摘要和链接 |
| `analysis` | 分析结论 | 从讨论中派生的分析性结论 |
| `action_item` | 待办事项 | "需要定期采集 DeFiLlama TVL 数据" |

**沉淀文档生成逻辑改造**：

现有 `discussion-sediment.service.ts` 中的 `generateSediment` 方法改造：

1. **检测是否存在大纲**：
   - 如果空间有 `documentOutline`，按大纲结构组织沉淀文档
   - 如果没有大纲，保持原有的"讨论摘要"模式（向后兼容）

2. **大纲驱动的沉淀生成流程**：
   ```
   大纲结构 → 遍历每个章节 → 检索该章节关联的知识条目
     → 结合该章节相关的讨论消息 → Agent 生成章节内容
     → 组装为完整文档 → 写入 sedimentHistory
   ```

3. **沉淀 Prompt 改造**：
   ```
   你是行业研究助手，请基于以下大纲结构和知识积累，生成结构化的行业观察文档。
   
   ## 大纲
   {documentOutline 序列化}
   
   ## 各章节知识积累
   ### 章节: {section.title}
   - 知识条目 1: {title} ({credibility}) - {summary}
   - 知识条目 2: ...
   
   ## 讨论中的关键结论
   {从讨论消息中提取的结论}
   
   要求：
   1. 严格按大纲章节结构组织文档
   2. 每个章节引用相关知识条目作为论据，标注来源和可信度
   3. 标注知识积累不足的章节为"待补充"
   4. 在文末列出"数据采集建议"和"待深入讨论的问题"
   ```

**知识积累覆盖度统计**：

新增 API `GET /discussions/:spaceId/knowledge/coverage`，返回：
```typescript
{
  totalSections: number;
  coveredSections: number;         // 至少有 1 条知识的章节数
  sufficientSections: number;      // status=sufficient 的章节数
  coverage: number;                // coveredSections / totalSections
  sectionDetails: Array<{
    sectionId: string;
    sectionTitle: string;
    knowledgeCount: number;
    status: string;
    latestEntryDate?: Date;
  }>;
}
```

前端大纲视图中展示覆盖度进度条，直观呈现"哪些章节已有足够知识，哪些需要补充"。

#### 0.4 Agent 自动大纲生成与知识丰富

**大纲生成流程**：

当创建 `industry_observation` 分类的讨论空间时：

```
1. 空间创建完成（Space + Root Thread + Creator Participant 已创建）
2. 触发大纲生成：
   a. 识别空间的默认回复 Agent（或使用系统默认的行业研究 Agent）
   b. 构建大纲生成 Prompt：
      "你是行业研究专家。用户希望对 {industryContext} 行业进行系统性观察。
       请生成一份结构化的行业观察大纲，包含以下维度（可根据行业特点调整）：
       1. 行业发展脉络与重要节点
       2. 行业 TOP N 公司图谱
       3. 行业关键影响力人物
       4. 最新趋势与核心叙事
       5. 数据验证与交叉确认机制
       6. 输出格式与更新节奏
       
       对每个维度提供 2-4 个子章节，并为每个子章节标注：
       - 建议的数据源
       - 建议的数据采集频率（daily/weekly/monthly）
       - 是否建议通过脚本结构化采集
       
       输出格式为 JSON：{sections: [{id, title, description, parentSectionId, order, depth, metadata}]}"
   c. 通过 Agent Runtime 执行生成任务
   d. 解析 Agent 输出为 OutlineSection[]
   e. 写入 space.documentOutline
   f. 在根线程发送 system 消息："已生成行业观察大纲，请在右侧面板查看并修改"
   g. SSE 推送大纲更新事件到前端
```

**大纲生成的异步任务化**：
- 大纲生成通过异步任务执行，避免阻塞空间创建
- 复用现有的 SSE 任务事件模式（类似沉淀任务）
- 任务事件类型：
  - `discussion.outline.task.queued`
  - `discussion.outline.task.running`
  - `discussion.outline.task.succeeded`
  - `discussion.outline.task.failed`

**Agent 主动知识丰富流程**：

用户或系统触发"丰富章节"操作时：

```
1. 前端触发 POST /discussions/:spaceId/outline/sections/:sectionId/enrich
2. 后端：
   a. 获取目标章节信息（title, description, metadata.suggestedDataSources）
   b. 获取该章节已有知识条目（避免重复积累）
   c. 构建知识丰富 Prompt：
      "你是行业研究助手。请针对以下研究维度搜索并整理相关知识：
       
       ## 研究维度
       章节标题: {section.title}
       章节说明: {section.description}
       建议数据源: {section.metadata.suggestedDataSources}
       
       ## 已有知识（避免重复）
       {existingEntries.map(e => e.title + ': ' + e.summary)}
       
       要求：
       1. 每条知识独立输出，格式为 JSON 数组
       2. 区分事实(fact)、数据点(data_point)、观点(opinion)、来源引用(source_reference)
       3. 对每条知识标注来源 URL、来源名称、可信度评估
       4. 数据点类型请提供 structuredData（值、单位、对比基准）
       5. 搜索至少 3 个独立来源进行交叉验证"
   d. 通过 Agent Runtime 执行（Agent 可调用 web_search 等工具）
   e. 解析输出为知识条目，批量写入 discussion_knowledge_entries
   f. 更新章节的 knowledgeCount 和 status
   g. 在讨论空间发送 system 消息通知丰富结果
```

**批量丰富**：支持一键丰富所有 `draft` 状态的章节，按顺序逐章节执行。

**后端新增 API**：

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/discussions/:spaceId/outline/generate` | 触发大纲生成（异步任务） |
| `GET` | `/discussions/:spaceId/outline` | 获取当前大纲 |
| `PUT` | `/discussions/:spaceId/outline` | 更新大纲（人工编辑） |
| `PUT` | `/discussions/:spaceId/outline/sections/:sectionId` | 更新单个章节 |
| `POST` | `/discussions/:spaceId/outline/sections` | 新增章节 |
| `DELETE` | `/discussions/:spaceId/outline/sections/:sectionId` | 删除章节 |
| `POST` | `/discussions/:spaceId/outline/sections/:sectionId/enrich` | 触发章节知识丰富（异步任务） |
| `POST` | `/discussions/:spaceId/outline/enrich-all` | 批量丰富所有 draft 章节 |
| `GET` | `/discussions/:spaceId/outline/tasks/:taskId/events` | 大纲任务 SSE 事件流 |
| `GET` | `/discussions/:spaceId/knowledge/coverage` | 知识积累覆盖度统计 |

---

### Phase 1：孵化项目与讨论空间打通（基础连接）

> **目标**：在孵化项目详情中可查看和管理关联的讨论空间。

#### 1.1 聚合查询扩展

**后端改动**：`incubation-project-aggregation.service.ts`

1. 注入 `DiscussionSpace` model（通过 `MongooseModule.forFeature` 在 EI app module 中注册 shared schema）
2. 新增 `getProjectDiscussionSpaces(projectId: string)` 方法：
   ```typescript
   async getProjectDiscussionSpaces(projectId: string) {
     return this.discussionSpaceModel.find(
       { projectId, status: { $ne: 'archived' } },
       { title: 1, category: 1, status: 1, tags: 1, 'statistics.totalMessages': 1,
         'statistics.totalKnowledgeEntries': 1, createdAt: 1, updatedAt: 1 }
     ).sort({ updatedAt: -1 }).lean();
   }
   ```

3. 更新 `getProjectStats` 方法，新增 `discussions` 统计：
   ```typescript
   discussions: {
     total: await this.discussionSpaceModel.countDocuments({ projectId }),
     byCategory: { /* 按分类聚合 */ }
   }
   ```

#### 1.2 Controller 端点

**后端改动**：`incubation-projects.controller.ts`

新增端点：
```typescript
@Get(':id/discussions')
@ApiBearerAuth()
async getProjectDiscussions(@Param('id') id: string) {
  return this.aggregationService.getProjectDiscussionSpaces(id);
}
```

#### 1.3 前端详情页扩展

**前端改动**：`IncubationProjectDetail.tsx`

1. Tab 栏新增"讨论空间"Tab
2. 讨论空间 Tab 内容：
   - 讨论空间卡片列表（标题、分类标签、状态、消息数、知识条目数、更新时间）
   - 每张卡片可点击跳转到讨论空间详情页 `/discussions/:spaceId`
   - 卡片上显示分类标签（通用/行业观察/产品讨论/技术方案）
   - 空状态引导："暂无讨论空间，前往讨论空间页面创建并关联此项目"
3. Stats 卡片中新增"讨论空间"数量

**前端改动**：`incubationProjectService.ts`

新增方法：
```typescript
async getProjectDiscussions(projectId: string) {
  const res = await api.get(`/ei/incubation-projects/${projectId}/discussions`);
  return this.toList(res.data);
}
```

#### 1.4 创建讨论空间时的项目关联优化

**前端改动**：`SpaceCreateModal.tsx`

- 如果从孵化项目详情页的"讨论空间"Tab 中点击"创建"，自动填充 `projectId`
- 关联项目选择器从文本输入改为下拉选择（拉取孵化项目列表）

---

### Phase 2：讨论 → 需求/任务的转化能力

> **目标**：讨论中的结论和待办可直接转化为 EI 需求条目，形成从讨论到开发的桥梁。

#### 2.1 讨论消息"转为需求"动作

**前端改动**：`MessageBubble.tsx`

在消息气泡的操作菜单中（现有"复制"按钮旁），新增"转为需求"按钮：
- 点击后弹出"转需求"弹窗
- 弹窗内容：
  - 需求标题（默认从消息内容提取前 50 字符）
  - 需求描述（默认为消息完整内容）
  - 优先级选择（low/medium/high/critical）
  - 关联项目（自动填充空间的 `projectId`，如有）
  - 来源信息（自动填充：讨论空间名称、讨论线标题、消息 ID）

**后端改动**：新增跨服务接口

由于讨论空间在 Legacy 服务，需求管理在 EI 服务，需要跨服务调用：

方案：讨论服务通过 HTTP 调用 EI 的需求创建接口（复用 Gateway 已有的服务间签名机制）

```typescript
// discussion-requirement-bridge.service.ts（新增，在 Legacy 服务中）
@Injectable()
export class DiscussionRequirementBridgeService {
  async createRequirementFromDiscussion(dto: {
    title: string;
    description: string;
    priority: string;
    projectId?: string;
    sourceSpaceId: string;
    sourceThreadId: string;
    sourceMessageId: string;
    createdBy: string;
  }) {
    // HTTP 调用 EI 服务 POST /ei/requirements
    // 携带 x-user-context + x-user-signature 签名头
  }
}
```

新增 API：
```
POST /discussions/:spaceId/threads/:threadId/messages/:messageId/to-requirement
```

#### 2.2 需求来源追溯

**Schema 改动**：`ei-requirement.schema.ts` 新增字段

```typescript
@Prop({ type: Object })
discussionSource?: {
  spaceId: string;
  spaceTitle: string;
  threadId: string;
  threadTitle: string;
  messageId: string;
  messagePreview: string;           // 消息内容前 200 字符
};
```

**前端改动**：`EngineeringRequirementDetail.tsx`

如果需求有 `discussionSource`，在需求详情页展示"来源讨论"卡片，点击可跳转回讨论空间对应消息。

#### 2.3 知识条目"标记为待开发"能力

**Schema 改动**：`discussion-knowledge-entry.schema.ts`

`entryType` 枚举已在 Phase 0 中新增 `action_item` 类型。

当知识条目的 `entryType` 为 `action_item` 且 `metadata` 中包含 `isStructuredData: true` 时，前端知识面板中该条目展示"转为数据采集需求"快捷操作，执行与 2.1 类似的转需求流程。

#### 2.4 讨论沉淀文档中的"数据采集建议"提取

沉淀文档生成时（Phase 0 中已改造 Prompt），Agent 会在文末输出"数据采集建议"章节。前端沉淀面板中，该章节内的每个建议项旁边展示"转为需求"按钮。

---

### Phase 3：数据采集框架（工程智能侧）

> **目标**：在 EI 服务中建立数据源管理和采集数据存储能力，由编排 + 定时调度驱动采集执行。

#### 3.1 数据源管理

**新增 Schema**：`ei-data-source.schema.ts`

```typescript
@Schema({ timestamps: true, collection: 'ei_data_sources' })
export class EiDataSource {
  @Prop({ required: true })
  name: string;                        // 数据源名称（如"DeFiLlama TVL API"）

  @Prop()
  description: string;

  @Prop({ required: true })
  projectId: string;                   // 所属孵化项目

  @Prop({ type: String, enum: ['api', 'rss', 'web_scrape', 'manual'], required: true })
  sourceType: string;                  // 数据源类型

  @Prop({ type: Object, required: true })
  config: {
    url?: string;                      // 目标 URL / API 端点
    method?: string;                   // HTTP 方法（GET/POST）
    headers?: Record<string, string>;  // 请求头
    params?: Record<string, string>;   // 查询参数
    body?: any;                        // 请求体
    selector?: string;                 // CSS 选择器（web_scrape 时）
    dataMapping?: Record<string, string>;  // 响应字段映射
  };

  @Prop({ type: String, enum: ['hourly', 'daily', 'weekly', 'monthly'], default: 'daily' })
  collectFrequency: string;            // 采集频率

  @Prop()
  cronExpression?: string;             // 自定义 cron 表达式（优先于 collectFrequency）

  @Prop()
  scheduleId?: string;                 // 关联的 orchestration_schedule ID

  @Prop({ type: String, enum: ['active', 'paused', 'error', 'archived'], default: 'active' })
  status: string;

  @Prop()
  lastCollectedAt?: Date;

  @Prop()
  lastError?: string;

  @Prop()
  requirementId?: string;             // 来源需求 ID（追溯）

  @Prop()
  outlineSectionId?: string;          // 关联的大纲章节 ID（追溯到讨论大纲）

  @Prop()
  discussionSpaceId?: string;         // 来源讨论空间 ID

  @Prop({ type: Object })
  statistics: {
    totalCollections: number;
    successCount: number;
    errorCount: number;
    lastSuccessAt?: Date;
  };
}

// 索引
EiDataSourceSchema.index({ projectId: 1, status: 1 });
EiDataSourceSchema.index({ scheduleId: 1 });
EiDataSourceSchema.index({ collectFrequency: 1, status: 1 });
```

**新增 API**：

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/ei/data-sources` | 创建数据源 |
| `GET` | `/ei/data-sources?projectId=` | 列表查询 |
| `GET` | `/ei/data-sources/:id` | 详情 |
| `PUT` | `/ei/data-sources/:id` | 更新配置 |
| `DELETE` | `/ei/data-sources/:id` | 删除 |
| `POST` | `/ei/data-sources/:id/test` | 测试采集（执行一次但不存储结果） |
| `POST` | `/ei/data-sources/:id/collect` | 手动触发采集 |

#### 3.2 采集数据存储

**新增 Schema**：`ei-data-record.schema.ts`

```typescript
@Schema({ timestamps: true, collection: 'ei_data_records' })
export class EiDataRecord {
  @Prop({ required: true })
  dataSourceId: string;                // 所属数据源

  @Prop({ required: true })
  projectId: string;                   // 所属项目（冗余，加速查询）

  @Prop({ required: true, type: Object })
  data: Record<string, any>;           // 采集到的结构化数据

  @Prop()
  rawData?: string;                    // 原始响应（用于调试和重新解析）

  @Prop({ required: true })
  collectedAt: Date;                   // 采集时间

  @Prop()
  periodStart?: Date;                  // 数据覆盖的时间段起点
  
  @Prop()
  periodEnd?: Date;                    // 数据覆盖的时间段终点

  @Prop({ type: String, enum: ['success', 'partial', 'error'], default: 'success' })
  status: string;

  @Prop()
  error?: string;

  @Prop({ type: [String], default: [] })
  tags: string[];                      // 数据标签（继承自数据源配置或大纲章节）

  @Prop()
  outlineSectionId?: string;           // 关联大纲章节

  @Prop()
  discussionSpaceId?: string;          // 来源讨论空间

  @Prop({ type: String, enum: ['industry_timeline', 'company_profile', 'person_profile', 'trend_data', 'market_data', 'regulation', 'general'], default: 'general' })
  dataCategory: string;                // 数据分类维度
}

// 索引
EiDataRecordSchema.index({ dataSourceId: 1, collectedAt: -1 });
EiDataRecordSchema.index({ projectId: 1, dataCategory: 1, collectedAt: -1 });
EiDataRecordSchema.index({ projectId: 1, tags: 1 });
EiDataRecordSchema.index({ outlineSectionId: 1, collectedAt: -1 });
```

**新增 API**：

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/ei/data-records?projectId=&dataSourceId=&dataCategory=&startDate=&endDate=` | 列表查询 |
| `GET` | `/ei/data-records/:id` | 详情 |
| `GET` | `/ei/data-records/aggregate?projectId=&dataCategory=&groupBy=` | 聚合统计（按时间/分类/标签） |
| `DELETE` | `/ei/data-records/:id` | 删除单条 |
| `DELETE` | `/ei/data-records?dataSourceId=&before=` | 批量清理过期数据 |

#### 3.3 采集执行与 Schedule 集成

**执行方式**：每个数据源对应一个 `orchestration_schedule`。

创建数据源时自动创建 Schedule 的流程：
```
1. 创建数据源 (POST /ei/data-sources)
2. 后端自动创建 orchestration_schedule：
   - name: "数据采集: {dataSource.name}"
   - cronExpression: 根据 collectFrequency 计算或使用自定义 cron
   - projectId: dataSource.projectId
   - executorAgentId: 项目的数据采集 Agent
   - sourcePrompt: "执行数据采集任务，数据源配置如下：{config JSON}"
3. 将 schedule._id 回写到 dataSource.scheduleId
```

Schedule 执行时通过编排系统触发 Agent 执行采集脚本，采集结果写入 `ei_data_records`。

**采集 Agent 的能力要求**：
- 能够根据数据源配置执行 HTTP 请求
- 能够解析响应并按 `dataMapping` 提取结构化数据
- 能够处理分页、认证、错误重试
- 采集完成后通过 MCP 工具写入 `ei_data_records`

**新增 MCP 工具**：
- `builtin.sys-mg.mcp.data-collection.write-record`：写入采集记录
- `builtin.sys-mg.mcp.data-collection.get-source-config`：获取数据源配置

#### 3.4 数据展示页面

**前端新增页面**：`DataDashboard.tsx`（路由 `/ei/incubation/:id/data`）

页面结构：
1. **数据源管理区**：数据源列表（名称、类型、频率、状态、最近采集时间、成功率）
2. **数据看板区**：
   - 按数据分类维度（`dataCategory`）展示 Tab
   - 每个 Tab 内按时间线展示数据记录卡片
   - 支持时间范围筛选
   - 关键数据点以简单图表展示（趋势线、对比柱状图）
3. **大纲关联视图**：按大纲章节组织展示采集数据，与讨论空间大纲一一对应

**前端路由调整**：
- 孵化项目详情页 Tab 新增"数据看板"
- 或独立路由 `/ei/incubation/:id/data`

---

### Phase 4：闭环协作（讨论 ↔ 数据双向流动）

> **目标**：采集的数据自动回灌讨论空间，形成"讨论 → 开发 → 采集 → 讨论"的完整闭环。

#### 4.1 数据回灌讨论空间

**触发机制**：数据采集完成后，自动检查是否有关联的讨论空间。

```
采集记录写入 ei_data_records
  → 检查 dataSource.discussionSpaceId 是否存在
  → 如果存在：
    a. 将采集数据转化为知识条目（entryType=data_point）
       - 自动填充 outlineSectionId（从 dataSource 继承）
       - sourceType = 'api'
       - credibility = 根据数据源可靠性评估
    b. 写入 discussion_knowledge_entries
    c. 更新大纲章节的 knowledgeCount 和 status
    d. 可选：在讨论空间根线程发送 system 消息通知
       "数据采集更新：{dataSource.name} 新增 {count} 条数据记录"
```

**回灌频率控制**：
- 配置项 `dataSource.notifyDiscussion: boolean`（是否推送到讨论空间）
- 配置项 `dataSource.notifyThreshold: number`（累积多少条新数据后触发一次通知，避免过于频繁）

**后端改动**：
- `ei-data-collection.service.ts` 中采集完成后调用回灌逻辑
- 回灌逻辑需要跨服务调用讨论空间的知识创建 API

#### 4.2 讨论空间中的数据引用

**前端改动**：`MessageInput.tsx`

在输入框中支持插入数据引用的快捷方式：
- 输入 `#data:` 触发数据搜索弹窗
- 搜索并选择采集的数据记录
- 插入为格式化的数据引用块（如"根据 DeFiLlama 数据，当前 DeFi TVL 为 $150B，同比增长 45%"）

**后端改动**：`discussion-message.schema.ts`

消息中新增 `dataReferences` 字段：
```typescript
@Prop({ type: [Object], default: [] })
dataReferences: Array<{
  dataRecordId: string;
  dataSourceName: string;
  dataPreview: string;               // 数据摘要
  collectedAt: Date;
}>;
```

#### 4.3 行业观察大纲模板

**模板存储**：`ei-outline-template.schema.ts`（新增 Collection）

```typescript
@Schema({ timestamps: true, collection: 'ei_outline_templates' })
export class EiOutlineTemplate {
  @Prop({ required: true })
  name: string;                        // 模板名称（如"行业观察通用模板"）

  @Prop()
  description: string;

  @Prop({ type: String, enum: ['industry_observation', 'product_analysis', 'technical_review'], required: true })
  templateType: string;

  @Prop({ type: [String], default: [] })
  applicableIndustries: string[];      // 适用行业（空=通用）

  @Prop({ type: Object, required: true })
  outlineTemplate: {                   // 模板大纲结构
    sections: Array<{
      title: string;
      description: string;
      order: number;
      depth: number;
      childSections?: any[];
      metadata?: {
        suggestedDataSources?: string[];
        collectFrequency?: string;
        isStructuredData?: boolean;
      };
    }>;
  };

  @Prop({ type: [Object], default: [] })
  suggestedDataSources: Array<{        // 建议预配置的数据源
    name: string;
    sourceType: string;
    config: Record<string, any>;
    collectFrequency: string;
  }>;

  @Prop({ type: Boolean, default: false })
  isSystem: boolean;                   // 是否为系统内置模板

  @Prop()
  createdBy?: string;
}

// 索引
EiOutlineTemplateSchema.index({ templateType: 1, isSystem: 1 });
EiOutlineTemplateSchema.index({ applicableIndustries: 1 });
```

**模板使用流程**：
1. 创建"行业观察"类讨论空间时，可选择已有模板
2. 选择模板后：
   - 大纲结构从模板导入（Agent 可在此基础上根据具体行业定制）
   - 建议的数据源配置自动预填到数据源管理
3. 系统内置一个"行业观察通用模板"（基于用户提供的 Web3 大纲结构抽象）

**新增 API**：

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/ei/outline-templates?type=` | 列表查询模板 |
| `GET` | `/ei/outline-templates/:id` | 模板详情 |
| `POST` | `/ei/outline-templates` | 创建模板 |
| `PUT` | `/ei/outline-templates/:id` | 更新模板 |
| `DELETE` | `/ei/outline-templates/:id` | 删除模板 |
| `POST` | `/ei/outline-templates/:id/apply` | 将模板应用到指定讨论空间 |

#### 4.4 Agent 基于数据的深度分析触发

**场景**：当某个大纲章节的知识积累达到 `sufficient` 状态，且有新的采集数据进入时，系统可自动触发 Agent 在讨论空间中发起分析讨论。

**流程**：
```
数据回灌完成 → 检查章节 status
  → 如果 status=sufficient 且新数据与旧数据有显著变化（变化率 > 阈值）
  → 自动在讨论空间的对应线程中发送 Agent 消息：
    "数据更新提醒：{section.title} 相关数据有新变化。
     新数据：{新采集数据摘要}
     变化分析：{同比/环比变化}
     建议关注：{变化可能的影响}"
  → 人类可以在讨论中进一步深入分析
```

此能力为**可选配置**，通过 `space.settings.autoAnalysisOnDataUpdate: boolean` 控制。

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 | 所属 Phase |
|------|----------|------|------|-----------|
| REQ-009 | 讨论空间分类（category）+ 创建弹窗改造 | [链接](../requirement/DISCUSSION_SPACE_REQ-009_SPACE_CATEGORY.md) | done | Phase 0 |
| REQ-010 | 文档大纲升级（结构化 DocumentOutline）+ 大纲视图 + Agent 自动生成 | [链接](../requirement/DISCUSSION_SPACE_REQ-010_DOCUMENT_OUTLINE_UPGRADE.md) | done | Phase 0 |
| REQ-011 | 知识库增强（outlineSectionId + entryType + 覆盖度统计）+ 沉淀文档大纲驱动改造 | [链接](../requirement/DISCUSSION_SPACE_REQ-011_KNOWLEDGE_OUTLINE_DRIVEN.md) | done | Phase 0 |
| REQ-012 | 孵化项目与讨论空间聚合打通 | [链接](../requirement/DISCUSSION_SPACE_REQ-012_INCUBATION_DISCUSSION_LINK.md) | done | Phase 1 |
| REQ-013 | 讨论消息"转为需求"能力 + 需求来源追溯 | [链接](../requirement/DISCUSSION_SPACE_REQ-013_DISCUSSION_TO_REQUIREMENT.md) | done | Phase 2 |
| REQ-014 | 数据源管理 + 采集数据存储 + Schedule 集成 | [链接](../requirement/DISCUSSION_SPACE_REQ-014_DATA_COLLECTION_FRAMEWORK.md) | done | Phase 3 |
| REQ-015 | 数据回灌讨论 + 数据引用 + 大纲模板 + 自动分析触发 | [链接](../requirement/DISCUSSION_SPACE_REQ-015_DATA_DISCUSSION_CLOSED_LOOP.md) | done | Phase 4 |

## 6. 关键影响点

### 后端

| 服务 | 改动范围 |
|------|---------|
| Legacy (3001) | `discussion-space.schema` 新增字段、知识条目 schema 增强、大纲 CRUD 服务、沉淀生成逻辑改造、跨服务需求创建桥接 |
| EI (3004) | 聚合查询扩展、数据源 schema + service + controller、数据记录 schema + service + controller、大纲模板管理、数据回灌服务 |
| Agents (3002) | Agent Runtime 大纲生成/知识丰富任务支持（Prompt 层面，无核心代码改动） |

### 前端

| 页面/组件 | 改动 |
|----------|------|
| `SpaceCreateModal.tsx` | 新增分类选择器、行业上下文输入、模板选择 |
| `DiscussionDetail.tsx` | 右侧面板新增"大纲"Tab |
| `KnowledgePanel.tsx` | 知识条目展示增加章节归属、类型标签 |
| `SedimentPanel.tsx` | 沉淀生成按大纲驱动 |
| `MessageBubble.tsx` | 新增"转为需求"操作 |
| `IncubationProjectDetail.tsx` | 新增"讨论空间"Tab、"数据看板"Tab |
| `DataDashboard.tsx`（新增） | 数据源管理 + 数据看板 |
| 新增大纲相关组件 | `OutlinePanel.tsx`、`OutlineSectionCard.tsx`、`OutlineEditModal.tsx` |

### 数据库

| 操作 | Collection | Phase |
|------|-----------|-------|
| 字段新增 | `discussion_spaces`（category、documentOutline 升级） | 0 |
| 字段新增 | `discussion_knowledge_entries`（outlineSectionId、entryType、structuredData） | 0 |
| 字段新增 | `ei_requirements`（discussionSource） | 2 |
| 字段新增 | `discussion_messages`（dataReferences） | 4 |
| 新增集合 | `ei_data_sources` | 3 |
| 新增集合 | `ei_data_records` | 3 |
| 新增集合 | `ei_outline_templates` | 4 |

### API 端点汇总

| Phase | 新增端点数 | 主要端点 |
|-------|----------|---------|
| 0 | ~12 | 大纲 CRUD、大纲生成/丰富任务、知识覆盖度 |
| 1 | ~2 | 孵化项目讨论聚合 |
| 2 | ~2 | 消息转需求 |
| 3 | ~10 | 数据源 CRUD + 采集 + 数据记录查询 |
| 4 | ~8 | 大纲模板 CRUD + 模板应用 |

## 7. 风险与依赖

### 风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Agent 大纲生成质量不稳定 | 大纲可能偏离行业实际，影响后续知识积累方向 | Prompt 调优 + 人工审核修改机制 + 模板兜底 |
| 知识积累覆盖度低 | 大纲章节长期处于 `draft` 状态，文档产出质量受限 | Agent 批量丰富能力 + 人工补充入口 + 覆盖度看板预警 |
| 跨服务调用复杂度 | Legacy ↔ EI 跨服务调用增加延迟和错误风险 | 复用 Gateway 已有签名机制 + 异步任务化 + 重试兜底 |
| 数据采集稳定性 | 外部 API 变更、限流、下线导致采集失败 | 错误重试 + 告警通知 + 数据源健康度监控 |
| `documentOutline` 结构升级的兼容性 | 已有空间的 documentOutline 数据格式不一致 | 读取时做 undefined/旧格式兼容判断，不强制迁移 |
| 数据回灌频率过高 | 讨论空间被大量 system 消息淹没 | 通知阈值控制 + 聚合通知 + 可关闭开关 |

### 依赖

| 依赖项 | 说明 | 当前状态 |
|--------|------|---------|
| Agent Runtime | 大纲生成、知识丰富需要 Agent 执行能力 | 已就绪 |
| Gateway 签名机制 | 跨服务调用需要签名验证 | 已就绪 |
| 编排调度系统 | 数据采集需要 Schedule 驱动 | 已就绪 |
| MCP 工具体系 | 采集 Agent 需要数据写入工具 | 需新增工具 |
| 讨论空间基础能力 | Phase 0 依赖已有的讨论空间功能 | 已就绪（REQ-001~008 大部分完成） |

### Phase 间依赖关系

```
Phase 0 (讨论空间能力升级)
    ↓ 必须先完成
Phase 1 (孵化项目连接)     Phase 2 (讨论→需求转化)
    ↓                         ↓
    ↓ ─────────────────────────┘
    ↓ Phase 1+2 完成后
Phase 3 (数据采集框架)
    ↓ 必须先完成
Phase 4 (闭环协作)
```

- Phase 0 是所有后续 Phase 的基础
- Phase 1 和 Phase 2 可并行开发
- Phase 3 依赖 Phase 1+2 的完成
- Phase 4 依赖 Phase 3 的完成

## 8. 备注

### 8.1 开发优先级建议

建议按 Phase 顺序执行，每个 Phase 完成后进行验证：
- **Phase 0** 最重要，完成后讨论空间即具备独立的"行业观察"能力
- **Phase 1** 工作量小，可在 Phase 0 完成后快速推进
- **Phase 2** 是讨论→开发的桥梁，建议与 Phase 1 并行
- **Phase 3** 是整个数据采集基础设施，工作量较大，建议先用 MVP 验证一个行业
- **Phase 4** 是最终闭环，依赖前面所有 Phase

### 8.2 MVP 验证策略

建议以"区块链 Web3 行业观察"为首个 MVP 项目：
1. Phase 0 完成后，创建 Web3 行业观察讨论空间，验证大纲生成和知识丰富
2. Phase 1-2 完成后，验证讨论→需求转化流程
3. Phase 3 完成后，配置 2-3 个核心数据源（如 DeFiLlama TVL、CoinGecko 价格），验证采集和存储
4. Phase 4 完成后，验证数据回灌讨论的完整闭环

### 8.3 遵循的约束

- 研发智能边界红线：前端保留在主应用 `frontend/` 内
- `organizationId` 禁止项：不引入 organizationId
- 讨论空间归属 Legacy 服务，工程智能归属 EI 服务，跨服务调用通过 Gateway 签名机制
- 新增 Collection 和索引需在 `docs/technical/db_schema/` 中登记（如有该目录规范）

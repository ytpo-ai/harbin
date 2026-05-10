# Plan: DISCUSSION_SPACE_OUTLINE_SECTION_CHAT_PLAN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 需求管理 ID | — |
| 所属项目 | 69f096d658f9498921a8bd27 |
| OpenCode Session | — |
| 状态 | completed |
| 优先级 | high |
| 创建日期 | 2026-05-02 |

## 2. 背景

当前讨论大纲章节补充采用"一键 enrich"模式：用户点击按钮 → agent 黑盒执行 → 返回结果。这种模式存在三个核心问题：

1. **过程不可控**：agent 执行过程中用户无法干预。当 agent 理解偏差（如反问用户需要什么维度、时间范围）时，用户看不到中间状态，只得到空结果或低质量条目。
2. **结果不可修正**：产出的条目只能全盘接受或全部删除重来，无法逐条调整、补充或引导方向。
3. **交互断裂**：讨论空间本身已有完善的多轮对话能力（线程、消息、@mention、SSE 推送），但大纲章节补充完全没有复用这套交互体系，形成了一个孤立的"生成器"。

**核心思路**：将大纲章节补充从"一次性生成"升级为"围绕章节的多轮对话协作"，复用讨论空间现有的聊天交互能力。用户可以像使用 OpenCode 一样，与 agent 围绕某个章节持续交互，逐步达到满意的知识条目产出。

## 3. 目标

1. 用户可以"进入"某个大纲章节，开启围绕该章节主题的多轮对话。
2. 对话中 agent 产出的结构化知识条目自动关联到该章节（`outlineSectionId`）。
3. 用户可以在对话中自然语言指导 agent 调整方向（如"聚焦中国光伏"、"补一条关于碳交易的"、"这条太泛了换一个"）。
4. 保留原有"一键 enrich"作为快捷入口，点击后等价于在章节对话中自动发起一轮生成请求。
5. 不新增独立页面或独立聊天组件，复用现有 DiscussionDetail 的聊天 UI 和后端消息链路。

## 4. 执行步骤

1. [x] **后端：章节级线程自动创建与关联**
   - 在 `DiscussionThread` schema 中新增 `outlineSectionId` 可选字段，标识该线程关联的大纲章节。
   - 在 `DiscussionThreadService` 中新增 `getOrCreateSectionThread(spaceId, sectionId, sectionTitle)` 方法：查询是否已有关联该 section 的线程，有则返回，无则自动创建（title 为章节标题，parentThreadId 为 rootThreadId）。
   - 新增 API 端点 `POST /discussions/:spaceId/outline/sections/:sectionId/thread`，返回章节关联线程。

2. [x] **后端：章节对话上下文增强**
   - 修改 `DiscussionMentionDispatchService.generateAiMentionReply()` 中的 `buildMentionRuntimeTask()`：当线程关联了 `outlineSectionId` 时，在 agent prompt 中注入章节上下文（章节标题、说明、已有条目摘要、大纲框架），并追加 `collaborationContext.outlineSectionId`。
   - agent prompt 中明确指示：产出结构化知识条目 JSON 时，使用约定的 JSON code block 格式（```json\n[...]\n```），以便后端识别和自动入库。

3. [x] **后端：AI 回复中结构化条目自动入库**
   - 在 `DiscussionMessageService.generateAiMessagesAsync()` 中，当线程关联了 `outlineSectionId` 时，对 AI 回复内容调用 `parseEnrichmentPayload()` 尝试提取结构化条目。
   - 提取到的条目经 `normalizeRuntimeKnowledgeEntries()` 标准化和去重后，通过 `DiscussionKnowledgeService.createKnowledgeEntry()` 写入，关联 `outlineSectionId`。
   - AI 消息的 `metadata` 中记录 `{ generatedKnowledgeEntryIds, outlineSectionId }`，便于前端展示关联状态。

4. [x] **前端：章节卡片新增"讨论"入口**
   - 在 `OutlinePanel` 的每个章节卡片操作栏中，新增"讨论此章节"按钮（与"补充此章节"并列）。
   - 点击后：调用后端 `getOrCreateSectionThread` 获取章节线程 → `setSelectedThread(spaceId, threadId)` 切换到该线程 → 切换右侧面板 tab 到 `knowledge` 并按 `outlineSectionId` 筛选条目。
   - 用户在中间聊天区域即可与 agent 围绕章节主题对话。

5. [x] **前端：章节线程标识与消息中条目卡片展示**
   - 在 `ThreadTree` 中，对关联了 `outlineSectionId` 的线程显示章节图标标识，区分于普通讨论线。
   - 在 `MessageBubble` 中，当 AI 消息的 `metadata.generatedKnowledgeEntryIds` 存在时，在消息下方展示条目摘要卡片列表（标题 + 类型 + 可信度），用户可单独删除某条不满意的条目。

6. [x] **前端+"一键 enrich"语法糖改造**
   - 修改现有"补充此章节"按钮的行为：不再直接调用 `enrichOutlineSectionTask` API，而是：先 `getOrCreateSectionThread` → 切换到该线程 → 自动发送一条预设消息（如"请基于章节主题生成 3 条知识条目"）→ agent 在对话中回复并自动入库。
   - 用户可以在 agent 回复后继续追问调整，或直接离开。
   - 保留批量"一键补充 draft"能力，走原有 `enrichAllDraftSections` 链路不变（批量场景不需要交互）。

7. [x] **后端：enrichSection 兜底加强（附带修复）**
   - 在 `enrichSection` 中增加对 `need_user_input` / 澄清类回复的识别，自动用更强约束重跑一次（二次 prompt 追加"禁止提问，缺省假设全球范围+近20年"）。
   - fallback 条目数从硬编码 1 调整为与 `addCount` 对齐。
   - 此改动确保批量 enrich 场景和向后兼容性。

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-019 | 章节级线程创建与关联（后端） | [链接](../requirement/DISCUSSION_SPACE_REQ-019_OUTLINE_SECTION_THREAD.md) | completed |
| REQ-020 | 章节对话上下文增强与条目自动入库（后端） | [链接](../requirement/DISCUSSION_SPACE_REQ-020_SECTION_CHAT_CONTEXT_AND_AUTO_ARCHIVE.md) | completed |
| REQ-021 | 章节讨论前端交互（前端） | [链接](../requirement/DISCUSSION_SPACE_REQ-021_SECTION_CHAT_FRONTEND.md) | completed |
| REQ-022 | 一键 enrich 语法糖改造与 enrichSection 兜底加强 | [链接](../requirement/DISCUSSION_SPACE_REQ-022_ENRICH_SUGAR_AND_FALLBACK.md) | completed |

## 6. 关键影响点

- **后端**：`discussion-thread.service.ts`（新增 sectionThread 方法）、`discussion-message.service.ts`（AI 回复条目自动入库）、`discussion-mention-dispatch.service.ts`（章节上下文 prompt 注入）、`discussion-outline.service.ts`（enrichSection 兜底加强）、`discussion.controller.ts`（新增 API 端点）
- **前端**：`OutlinePanel.tsx`（新增"讨论"按钮）、`ThreadTree.tsx`（章节线程标识）、`MessageBubble.tsx`（条目卡片展示）、`DiscussionDetail.tsx`（章节线程切换逻辑、enrich 行为改造）
- **数据库**：`discussion-thread.schema.ts` 新增 `outlineSectionId` 可选字段（无破坏性变更）
- **API**：新增 `POST /discussions/:spaceId/outline/sections/:sectionId/thread`
- **文档**：plan/requirement/feature 追溯链路

## 7. 风险与依赖

- **风险**：AI 回复中 JSON 提取逻辑需要足够健壮，避免把普通对话内容误判为知识条目。现有 `parseEnrichmentPayload` + `looksLikeClarification` 过滤已有基础，需确保在对话场景下不会误提取。
- **风险**：章节线程如果积累大量消息，agent 上下文窗口可能不足。需控制注入的历史消息数量（复用现有 30 条上限）。
- **依赖**：现有 `DiscussionMessageService.generateAiMessagesAsync()` 的 fire-and-forget 异步回复机制 + SSE 推送机制稳定可用。
- **依赖**：现有 `parseEnrichmentPayload()` 和 `normalizeRuntimeKnowledgeEntries()` 可直接复用。

## 8. 备注

- 不新增专用 Agent，复用 space 的 defaultReplyAgent 或 @mention 指定的 agent。
- 不新增独立前端组件或页面，全部在现有 DiscussionDetail 三栏布局内完成。
- 批量 enrich 场景（enrichAllDraftSections）保持不变，因为批量场景用户不需要逐个交互。
- 不引入 `organizationId` 字段。

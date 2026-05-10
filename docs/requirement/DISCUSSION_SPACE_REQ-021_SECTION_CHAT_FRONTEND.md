# Requirement: DISCUSSION_SPACE_REQ-021_SECTION_CHAT_FRONTEND

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-021 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_OUTLINE_SECTION_CHAT_PLAN](../plan/DISCUSSION_SPACE_OUTLINE_SECTION_CHAT_PLAN.md) |
| 状态 | completed |
| 创建日期 | 2026-05-02 |
| 最后更新 | 2026-05-06 |

## 2. 需求描述

### 2.1 目标

1. 章节卡片新增“讨论此章节”入口。
2. 章节线程在树中可视化标识。
3. AI 消息下展示自动生成条目卡片并支持单条删除。

### 2.2 验收条件

- [x] `OutlinePanel` 提供“讨论此章节”入口；章节补充统一在章节讨论线中触发。
- [x] 点击章节讨论后自动切换线程，并把右侧切到知识库且按章节过滤。
- [x] `ThreadTree` 对章节线程显示标识。
- [x] `MessageBubble` 可展示 `generatedKnowledgeEntryIds` 对应条目摘要并支持删除。

## 3. 影响范围

- 前端：`frontend/src/pages/discussions/DiscussionDetail.tsx`
- 前端：`frontend/src/components/discussion/OutlinePanel.tsx`
- 前端：`frontend/src/components/discussion/ThreadTree.tsx`
- 前端：`frontend/src/components/discussion/MessageBubble.tsx`
- 前端：`frontend/src/services/discussionService.ts`

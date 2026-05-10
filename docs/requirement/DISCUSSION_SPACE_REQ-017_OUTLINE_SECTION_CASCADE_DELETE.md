# Requirement: DISCUSSION_SPACE_REQ-017_OUTLINE_SECTION_CASCADE_DELETE

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-017 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_OUTLINE_SECTION_CASCADE_DELETE_PLAN](../plan/DISCUSSION_SPACE_OUTLINE_SECTION_CASCADE_DELETE_PLAN.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | done |
| 创建日期 | 2026-05-02 |
| 最后更新 | 2026-05-02 |

## 2. 需求描述

### 2.1 背景

现有章节能力缺少“仅清空补充内容”动作。用户希望保留章节结构时，无法快速清理“补充此章节”自动生成的知识条目，导致知识面板噪声累积。

### 2.2 目标

1. 提供“清空章节补充内容”能力，仅删除当前章节自动补充生成的知识条目。
2. 清空接口返回清理统计数据，便于前端反馈。
3. 前端交互增加二次确认和风险提示，明确保留章节结构。
4. 清空后保证大纲、知识库、覆盖率展示一致。

### 2.3 验收条件

- [x] 提供清空章节补充内容接口，仅删除 `outline-enricher-*` 来源知识条目。
- [x] 清空接口返回 `clearedKnowledgeCount`。
- [x] 前端确认明确提示“保留章节，仅清空补充内容”。
- [x] 前端成功提示展示清空知识条数。
- [x] 删除后相关查询缓存（outline/knowledge/coverage/space-detail）一致刷新。
- [x] 后端单测覆盖“清空补充且保留章节”链路。

## 3. 技术方案摘要

在 `DiscussionOutlineService` 新增 `clearSectionEnrichment`，按 `spaceId + outlineSectionId + sourceName(^outline-enricher-)` 删除知识条目，并返回结构化清空结果；前端更新“删除”交互为“清空补充”并消费统计数据。

### 影响范围

- **后端**：`discussion-outline.service.ts`、`discussion.controller.ts`、`discussion.types.ts`
- **前端**：`discussionService.ts`、`DiscussionDetail.tsx`、`OutlinePanel.tsx`
- **数据库**：`discussion_knowledge_entries`（按 `spaceId + outlineSectionId` 物理删除）
- **API**：`DELETE /discussions/:spaceId/outline/sections/:sectionId/enrichments`

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-017_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| — | — | — |

## 5. 备注

- 本期采用物理删除，不提供回收站与恢复。
- 本期仅处理章节自动补充知识（`sourceName=outline-enricher-*`），不影响手工知识与其他来源知识。

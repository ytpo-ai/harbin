# Requirement: DISCUSSION_SPACE_REQ-020_SECTION_CHAT_CONTEXT_AND_AUTO_ARCHIVE

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-020 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_OUTLINE_SECTION_CHAT_PLAN](../plan/DISCUSSION_SPACE_OUTLINE_SECTION_CHAT_PLAN.md) |
| 状态 | completed |
| 创建日期 | 2026-05-02 |
| 最后更新 | 2026-05-02 |

## 2. 需求描述

### 2.1 目标

1. 章节线程触发 AI 回复时自动注入章节上下文。
2. AI 在章节对话中输出结构化 JSON 条目时，自动落库到章节知识。
3. 消息元数据回传落库条目 ID，供前端展示与操作。

### 2.2 验收条件

- [x] 章节线程 prompt 注入章节标题、说明、已有条目摘要与大纲结构。
- [x] `collaborationContext` 带上 `outlineSectionId`。
- [x] AI 回复可解析 JSON 条目时自动调用知识入库。
- [x] AI 消息 `metadata` 包含 `generatedKnowledgeEntryIds` 与 `outlineSectionId`。

## 3. 影响范围

- 后端：`backend/src/modules/discussions/services/discussion-message.service.ts`
- 后端：`backend/src/shared/schemas/discussion-message.schema.ts`

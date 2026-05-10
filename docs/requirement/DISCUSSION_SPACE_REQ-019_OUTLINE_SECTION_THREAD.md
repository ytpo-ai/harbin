# Requirement: DISCUSSION_SPACE_REQ-019_OUTLINE_SECTION_THREAD

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-019 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_OUTLINE_SECTION_CHAT_PLAN](../plan/DISCUSSION_SPACE_OUTLINE_SECTION_CHAT_PLAN.md) |
| 状态 | completed |
| 创建日期 | 2026-05-02 |
| 最后更新 | 2026-05-02 |

## 2. 需求描述

### 2.1 目标

1. 支持按 `spaceId + outlineSectionId` 获取或创建章节讨论线。
2. 章节讨论线可在树中识别并长期复用。
3. 新增标准 API 供前端进入章节讨论。

### 2.2 验收条件

- [x] `discussion_threads` 支持 `outlineSectionId` 字段。
- [x] 后端提供 `getOrCreateSectionThread(spaceId, sectionId, sectionTitle)`。
- [x] 新增 `POST /discussions/:spaceId/outline/sections/:sectionId/thread`。
- [x] 章节不存在时返回明确错误。

## 3. 影响范围

- 后端：`backend/src/shared/schemas/discussion-thread.schema.ts`
- 后端：`backend/src/modules/discussions/services/discussion-thread.service.ts`
- 后端：`backend/src/modules/discussions/discussion.controller.ts`

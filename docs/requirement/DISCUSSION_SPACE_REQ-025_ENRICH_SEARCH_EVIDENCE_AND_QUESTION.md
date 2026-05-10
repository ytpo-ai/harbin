# Requirement: DISCUSSION_SPACE_REQ-025_ENRICH_SEARCH_EVIDENCE_AND_QUESTION

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-025 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_ENRICH_SEARCH_AND_QUESTION_PLAN](../plan/DISCUSSION_SPACE_ENRICH_SEARCH_AND_QUESTION_PLAN.md) |
| 状态 | completed |
| 创建日期 | 2026-05-03 |
| 最后更新 | 2026-05-03 |

## 2. 需求描述

### 2.1 目标

1. 在“丰富此章节”链路中，Agent 优先检索后生成知识条目。
2. 在信息不足时允许 Agent 反问，避免硬性禁止澄清。
3. 将本轮检索来源与摘要回传并展示在前端消息区域。

### 2.2 验收条件

- [x] 章节 enrich 预置提示词明确要求先调用搜索工具并引用来源。
- [x] 后端章节协作 prompt 不再强制“不要反问我”。
- [x] AI 消息 metadata 包含可渲染的检索证据字段（兼容旧消息）。
- [x] 前端在消息气泡中可查看检索来源列表（来源名、URL、摘要、时间）。
- [x] 相关测试更新通过，不破坏批量 enrich 既有流程。

## 3. 影响范围

- 前端：`frontend/src/pages/discussions/DiscussionDetail.tsx`
- 前端：`frontend/src/components/discussion/MessageBubble.tsx`
- 前端：`frontend/src/services/discussionService.ts`
- 后端：`backend/src/modules/discussions/services/discussion-message.service.ts`
- 后端：`backend/src/modules/discussions/services/discussion-outline.service.ts`
- 后端：`backend/src/shared/schemas/discussion-message.schema.ts`

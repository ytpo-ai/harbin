# Requirement: DISCUSSION_SPACE_REQ-022_ENRICH_SUGAR_AND_FALLBACK

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-022 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_OUTLINE_SECTION_CHAT_PLAN](../plan/DISCUSSION_SPACE_OUTLINE_SECTION_CHAT_PLAN.md) |
| 状态 | completed |
| 创建日期 | 2026-05-02 |
| 最后更新 | 2026-05-02 |

## 2. 需求描述

### 2.1 目标

1. “补充此章节”改为章节线程语法糖（进入章节线程并自动发起一轮请求）。
2. 批量 enrich (`enrichAllDraftSections`) 保持原链路不变。
3. `enrichSection` 增加澄清型回复二次重跑与 fallback 数量对齐。

### 2.2 验收条件

- [x] 前端“补充此章节”不再直接调用 `enrichOutlineSectionTask`。
- [x] 章节补充自动消息使用 JSON code block 约束。
- [x] `enrichSection` 遇到澄清型回复时自动重跑一次（禁止提问 + 默认假设）。
- [x] fallback 生成数量与 `addCount` 对齐。
- [x] 相关单测已更新并通过。

## 3. 影响范围

- 前端：`frontend/src/pages/discussions/DiscussionDetail.tsx`
- 后端：`backend/src/modules/discussions/services/discussion-outline.service.ts`
- 测试：`backend/src/modules/discussions/services/discussion-outline.service.spec.ts`

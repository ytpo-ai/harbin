# Requirement: DISCUSSION_SPACE_REQ-023_SECTION_THREAD_ENRICH_ACTION

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-023 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_SECTION_THREAD_ENRICH_BUTTON_PLAN](../plan/DISCUSSION_SPACE_SECTION_THREAD_ENRICH_BUTTON_PLAN.md) |
| 状态 | completed |
| 创建日期 | 2026-05-02 |
| 最后更新 | 2026-05-02 |

## 2. 需求描述

### 2.1 目标

1. 当用户已进入某章节对应讨论线时，聊天区提供“丰富此章节”快捷按钮。
2. 点击后向当前章节线程发送预置 enrich 消息，触发 Agent 产出章节知识条目。
3. 保持“讨论此章节”仅切线程不自动发送消息的交互语义。

### 2.2 验收条件

- [x] 仅当 `selectedThread.outlineSectionId` 存在时展示“丰富此章节”按钮。
- [x] 点击按钮时复用当前线程发送消息能力，并展示处理中状态。
- [x] 成功后提示“已发起章节丰富请求”并刷新消息/知识相关查询。
- [x] 失败时展示可读错误，不影响当前线程与知识筛选状态。

## 3. 影响范围

- 前端：`frontend/src/pages/discussions/DiscussionDetail.tsx`

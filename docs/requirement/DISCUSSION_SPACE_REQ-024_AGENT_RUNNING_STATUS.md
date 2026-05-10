# Requirement: DISCUSSION_SPACE_REQ-024_AGENT_RUNNING_STATUS

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-024 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_AGENT_RUNNING_STATUS_PLAN](../plan/DISCUSSION_SPACE_AGENT_RUNNING_STATUS_PLAN.md) |
| 状态 | completed |
| 创建日期 | 2026-05-02 |
| 最后更新 | 2026-05-02 |

## 2. 需求描述

### 2.1 目标

1. 用户在讨论空间发送消息并唤醒 Agent 后，能够即时看到“执行中”状态。
2. 支持多 Agent 并发执行时分别展示状态，不互相覆盖。
3. Agent 完成或失败后，状态自动清理，不出现长期残留。

### 2.2 验收条件

- [x] 消息 SSE 支持 `discussion.agent.execution.status` 事件，状态含 `running/completed/failed`。
- [x] `running` 事件到达后，讨论详情页展示对应 Agent “执行中”标签。
- [x] 收到 `completed/failed` 后，对应执行中标签自动消失。
- [x] 收到 AI 消息创建事件时可兜底移除对应 Agent 执行状态。
- [x] 切换讨论线后，不会显示上一条讨论线的执行中状态。

## 3. 影响范围

- 后端：`backend/src/modules/discussions/services/discussion-message-stream.service.ts`
- 后端：`backend/src/modules/discussions/services/discussion-message.service.ts`
- 后端测试：`backend/src/modules/discussions/services/discussion-message-stream.service.spec.ts`
- 前端服务：`frontend/src/services/discussionService.ts`
- 前端页面：`frontend/src/pages/discussions/DiscussionDetail.tsx`

## 4. 交付物与追溯

- Development 文档：待补充（`docs/development/DISCUSSION_SPACE_REQ-024_DEVELOPMENT.md`）
- Fix 文档：—

## 5. 状态跟踪

- 2026-05-02：需求创建，进入开发中。
- 2026-05-02：后端消息 SSE 新增 Agent 执行状态事件，前端讨论详情页新增“执行中”状态标签，完成回归验证。

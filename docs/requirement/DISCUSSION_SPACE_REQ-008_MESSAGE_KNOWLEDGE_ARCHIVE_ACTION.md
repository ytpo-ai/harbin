# Requirement: DISCUSSION_SPACE_REQ-008_MESSAGE_KNOWLEDGE_ARCHIVE_ACTION

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-008 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | in-progress |
| 创建日期 | 2026-04-30 |
| 最后更新 | 2026-04-30 |

## 2. 需求描述

### 2.1 背景

当前讨论空间虽然已有知识库面板与知识新增接口，但缺少从“具体消息”直接落档的操作入口。用户在阅读消息时无法一键将该消息沉淀到知识库，也无法在同一步骤中选择“关联已有知识”或“新建知识条目”。

### 2.2 目标

- 在消息条目上新增“落档知识库”按钮
- 点击后可选择两种路径：
  - 关联已有知识条目到当前消息
  - 基于当前消息新建知识条目并自动关联
- 落档完成后，消息与知识面板数据保持一致刷新

### 2.3 验收条件

- [ ] 消息条目可触发“落档知识库”交互入口
- [ ] 支持检索并选择已有知识条目，提交后完成消息关联（幂等）
- [ ] 支持基于当前消息创建知识条目，创建成功后自动关联到消息
- [ ] 成功后消息 `knowledgeEntryIds` 与知识面板列表可见最新结果
- [ ] 失败时返回明确错误提示，不影响原消息展示

## 3. 技术方案摘要

- 后端新增消息-知识关联接口：对指定 message 关联一个或多个已有知识条目，复用 `$addToSet` 保证幂等。
- 前端在消息气泡组件增加“落档知识库”按钮；新增落档弹窗，包含“选择已有 / 新建条目”双模式。
- 新建条目模式复用 `createKnowledge` 接口，提交成功后调用关联接口建立 message ↔ knowledge 双向关系。
- 成功后统一失效 `discussion-messages` / `discussion-knowledge` / `discussion-space-detail` 查询，确保界面一致。

### 影响范围

- **后端**：`backend/src/modules/discussions/discussion.controller.ts`、`backend/src/modules/discussions/services/discussion-knowledge.service.ts`、`backend/src/modules/discussions/discussion.types.ts`
- **前端页面/组件**：`frontend/src/pages/discussions/DiscussionDetail.tsx`、`frontend/src/components/discussion/MessageBubble.tsx`
- **前端服务**：`frontend/src/services/discussionService.ts`

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-008_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

- 该需求优先落地“手动落档”链路；是否启用 AI 自动提炼落档不在本次范围。

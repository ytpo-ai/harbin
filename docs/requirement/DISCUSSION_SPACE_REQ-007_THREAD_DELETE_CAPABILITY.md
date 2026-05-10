# Requirement: DISCUSSION_SPACE_REQ-007_THREAD_DELETE_CAPABILITY

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-007 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | in-progress |
| 创建日期 | 2026-04-29 |
| 最后更新 | 2026-04-29 |

## 2. 需求描述

### 2.1 背景

讨论空间支持从消息分叉创建新讨论线，但当前缺少分支删除能力。用户在误创建或重复创建同名分支后，无法在界面中清理无效讨论线，导致左侧树结构噪音升高，影响后续导航与聚焦。

### 2.2 目标

- 提供讨论线删除能力，仅允许删除非主讨论线
- 删除时级联清理该讨论线及其子讨论线，避免保留孤儿节点
- 删除成功后保证前后端状态一致，当前选中线若被删除需自动回退主讨论线
- 删除交互具备明确确认提示，降低误删风险

### 2.3 验收条件

- [ ] 提供线程删除 API，支持按 `spaceId + threadId` 删除目标讨论线
- [ ] 删除主讨论线时返回明确业务错误，不执行删除
- [ ] 删除分支时级联删除子线及其消息、知识条目，并同步空间统计
- [ ] 前端左侧讨论线列表为非主讨论线提供删除入口与二次确认
- [ ] 当前选中线程被删除后，自动切回主讨论线并刷新详情/消息视图

## 3. 技术方案摘要

- 后端在 Thread Service 中新增子树收集与级联删除逻辑：删除目标线程及全部后代线程，联动清理 `discussion_messages`、`discussion_knowledge_entries`，并更新父节点 `childThreadIds`。
- 后端新增 `DELETE /discussions/:spaceId/threads/:threadId` 接口，执行主线保护、存在性校验与级联删除。
- 前端 `discussionService` 新增删除线程接口；`ThreadTree` 增加删除按钮（主线隐藏）；`DiscussionDetail` 增加删除 mutation 与选中态回退。
- 删除成功后通过 `react-query` 统一失效 `discussion-space-detail`、`discussion-messages`、`discussion-knowledge`，保证界面一致。

### 影响范围

- **后端**：`backend/src/modules/discussions/discussion.controller.ts`、`backend/src/modules/discussions/services/discussion-thread.service.ts`、`backend/src/modules/discussions/discussion.types.ts`
- **前端**：`frontend/src/components/discussion/ThreadTree.tsx`、`frontend/src/pages/discussions/DiscussionDetail.tsx`
- **前端服务**：`frontend/src/services/discussionService.ts`
- **数据库**：`discussion_threads`、`discussion_messages`、`discussion_knowledge_entries` 级联删除

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-007_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

- 本期采用物理删除策略，不支持回收站和恢复功能。

# Requirement: DISCUSSION_SPACE_REQ-006_SEDIMENT_HISTORY_DELETE

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-006 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | in-progress |
| 创建日期 | 2026-04-29 |
| 最后更新 | 2026-04-29 |

## 2. 需求描述

### 2.1 背景

当前讨论空间右侧文档沉淀面板支持查看历史版本，但历史内容会持续累积，缺少删除能力。用户在误触发沉淀、重复沉淀或阶段性清理时无法处理历史噪声，影响沉淀列表可读性与后续检索效率。

### 2.2 目标

- 在讨论空间中支持删除单条沉淀历史记录
- 采用软删除策略，保留审计可追溯能力，不做物理删除
- 增加权限校验，仅允许空间创建者删除（管理员保留扩展位）
- 删除后前端列表与详情视图即时同步，保证交互一致性

### 2.3 验收条件

- [ ] 提供沉淀历史删除 API，支持按 `spaceId + historyId` 删除目标记录
- [ ] 删除采用软删除字段标记，不破坏历史版本顺序和已有查询能力
- [ ] 非空间创建者调用删除接口时返回明确权限错误
- [ ] 前端沉淀历史列表提供删除入口与二次确认
- [ ] 删除成功后前端自动刷新沉淀历史与最新沉淀展示

## 3. 技术方案摘要

- 后端在沉淀历史条目中新增软删除元数据（`isDeleted/deletedAt/deletedBy`），并在列表查询中默认过滤已删除项。
- 后端新增 `DELETE /discussions/spaces/:spaceId/sediments/history/:historyId` 接口，调用沉淀服务完成权限校验与软删除。
- 前端 `discussionService` 增加删除接口封装，`SedimentPanel` 增加删除按钮与确认交互。
- 删除成功后通过现有刷新链路重拉 `latest/history`，避免本地状态与服务端状态不一致。

### 影响范围

- **后端**：`backend/src/modules/discussions/discussion.controller.ts`、`backend/src/modules/discussions/services/discussion-sediment.service.ts`、`backend/src/modules/discussions/discussion.types.ts`
- **前端**：`frontend/src/components/discussion/SedimentPanel.tsx`
- **前端服务**：`frontend/src/services/discussionService.ts`
- **数据库**：`discussion_spaces.sedimentHistory` 子文档字段扩展（软删除元数据）

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-006_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

- 本期默认仅支持单条删除，不引入批量删除与恢复功能。

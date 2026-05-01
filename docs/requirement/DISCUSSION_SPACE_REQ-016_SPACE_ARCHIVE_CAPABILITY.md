# Requirement: DISCUSSION_SPACE_REQ-016_SPACE_ARCHIVE_CAPABILITY

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-016 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_ARCHIVE_CAPABILITY_PLAN](../plan/DISCUSSION_SPACE_ARCHIVE_CAPABILITY_PLAN.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | done |
| 创建日期 | 2026-05-01 |
| 最后更新 | 2026-05-01 |

## 2. 需求描述

### 2.1 背景

讨论空间已有归档状态枚举，但缺少可用的前后端归档闭环，导致空间生命周期管理能力不完整。

### 2.2 目标

1. 支持讨论空间归档与取消归档
2. 默认列表不展示归档空间，支持显式查看
3. 归档空间进入只读状态，禁止发送新消息
4. 前端提供可见、可操作的归档交互

### 2.3 验收条件

- [x] `discussion-space.schema.ts` 增加 `archivedAt`、`archivedBy` 字段
- [x] 列表接口默认排除归档空间，支持通过参数包含归档空间
- [x] 新增 `POST /discussions/:spaceId/archive`、`POST /discussions/:spaceId/unarchive`
- [x] 归档后 `POST /discussions/:spaceId/threads/:threadId/messages` 返回禁止写入错误
- [x] 列表页可进行归档/取消归档操作，并支持筛选归档空间
- [x] 详情页展示归档状态，归档时输入区禁用并提示只读

## 3. 技术方案摘要

围绕 `DiscussionSpace.status` 建立完整状态流转闭环，并补充归档审计字段及查询规则。

### 影响范围

- **后端**：讨论空间查询过滤、归档状态流转接口、消息写入前状态校验
- **前端**：列表页归档操作、详情页只读提示、消息输入禁用
- **数据库**：`discussion_spaces` 归档审计字段扩展
- **API**：新增归档/取消归档端点，增强列表查询参数

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-016_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| — | — | — |

## 5. 备注

- 归档为软状态，不删除原始讨论数据
- 恢复（unarchive）后空间可继续写入消息

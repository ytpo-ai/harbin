# Requirement: DISCUSSION_SPACE_REQ-013_DISCUSSION_TO_REQUIREMENT

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-013 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | draft |
| 创建日期 | 2026-04-30 |
| 最后更新 | 2026-04-30 |

## 2. 需求描述

### 2.1 背景

讨论空间中经常产生可执行的结论和待办事项，目前需要人工手动在工程智能中创建需求条目。需要一个从讨论直接转化为需求的快捷通道，同时保持需求到讨论来源的可追溯。

### 2.2 目标

1. 讨论消息上新增"转为需求"操作，一键创建 EI 需求条目
2. EI 需求 Schema 新增 `discussionSource` 字段，记录需求来源讨论信息
3. 需求详情页展示讨论来源，支持跳转回讨论空间
4. 知识条目类型为 `action_item` 时展示"转为需求"快捷操作

### 2.3 验收条件

- [x] `ei-requirement.schema.ts` 新增 `discussionSource` 嵌入对象（spaceId/spaceTitle/threadId/threadTitle/messageId/messagePreview）
- [x] Legacy 服务新增 `discussion-requirement-bridge.service.ts`，实现跨服务需求创建
- [x] 新增 API `POST /discussions/:spaceId/threads/:threadId/messages/:messageId/to-requirement`
- [x] 前端 `MessageBubble.tsx` 操作菜单新增"转为需求"按钮
- [x] 转需求弹窗 UI 完成（标题/描述/优先级/关联项目/来源信息展示）
- [x] 前端 `EngineeringRequirementDetail.tsx` 中如有 `discussionSource` 展示"来源讨论"卡片
- [x] 来源讨论卡片点击跳转到讨论空间对应消息
- [x] 知识面板中 `action_item` 类型条目展示"转为需求"快捷操作

## 3. 技术方案摘要

详见 Plan 文档 [§4 Phase 2](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md)

### 影响范围

- **后端**：Legacy 新增桥接服务（跨服务 HTTP 调用 EI）、EI 的 `ei-requirement.schema.ts` 字段新增
- **前端**：`MessageBubble.tsx` 新增操作、转需求弹窗组件、`EngineeringRequirementDetail.tsx` 来源展示
- **数据库**：`ei_requirements` 新增 `discussionSource` 字段
- **API**：新增 1 个讨论转需求端点

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-013_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| — | — | — |

## 5. 备注

- 跨服务调用需复用 Gateway 已有的 `x-user-context` + `x-user-signature` 签名机制
- 转需求是单向操作，不建立双向同步（需求状态变更不回写讨论消息）
- 可与 Phase 1 的 REQ-012 并行开发

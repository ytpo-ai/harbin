# Requirement: DISCUSSION_SPACE_REQ-009_SPACE_CATEGORY

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-009 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | done |
| 创建日期 | 2026-04-30 |
| 最后更新 | 2026-05-01 |

## 2. 需求描述

### 2.1 背景

当前创建讨论空间时只有主题、描述、标签、关联项目、初始 Agent 等基础选项，没有空间分类的概念。不同类型的讨论（行业观察、产品讨论、技术方案等）需要不同的初始化策略和辅助行为，缺少分类导致无法基于场景差异化地服务用户。

### 2.2 目标

1. 在讨论空间 Schema 中新增 `category` 字段，支持 `general`、`industry_observation`、`product_discussion`、`technical_design` 四种分类
2. 前端创建弹窗增加分类选择器，选择 `industry_observation` 时可额外输入"观察行业"上下文
3. 后端创建空间时根据 `category` 分发不同的初始化策略（本 REQ 仅做字段落地和路由骨架，具体策略逻辑由 REQ-010 实现）

### 2.3 验收条件

- [x] `discussion-space.schema.ts` 新增 `category` 字段（enum，默认 `general`）
- [x] 新增索引 `{ category: 1, status: 1 }`
- [x] `CreateSpaceDto` 新增 `category` 和 `industryContext`（可选）字段
- [x] `discussion-space.service.ts` 的 `createSpace` 方法接收并持久化 `category` 字段
- [x] 前端 `SpaceCreateModal.tsx` 新增分类选择 UI（四个选项卡片式选择）
- [x] 选择 `industry_observation` 后展示"观察行业"输入框
- [x] 讨论空间列表页中展示分类标签
- [x] 已有讨论空间数据兼容（`category` 默认为 `general`）

## 3. 技术方案摘要

详见 Plan 文档 [§4 Phase 0.1](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md)

### 影响范围

- **后端**：`discussion-space.schema.ts` 字段新增、`CreateSpaceDto` 扩展、`discussion-space.service.ts` 创建逻辑调整
- **前端**：`SpaceCreateModal.tsx` 改造、`Discussions.tsx` 列表展示分类标签
- **数据库**：`discussion_spaces` 集合新增字段和索引
- **API**：`POST /discussions` 请求体新增 `category` 和 `industryContext` 字段

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-009_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| — | — | — |

## 5. 备注

- 本 REQ 仅做分类字段和 UI 的基础落地，不包含分类触发的具体初始化行为（如自动生成大纲）
- `industry_observation` 的 `industryContext` 字段存储在 `space.metadata.industryContext` 中
- 预留的 `product_discussion` 和 `technical_design` 分类暂无特殊行为，后续按需扩展

# Requirement: DISCUSSION_SPACE_REQ-012_INCUBATION_DISCUSSION_LINK

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-012 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md)、[PROJECT_INCUBATION](../feature/PROJECT_%20INCUBATION.md) |
| 所属 Plan | [DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | draft |
| 创建日期 | 2026-04-30 |
| 最后更新 | 2026-04-30 |

## 2. 需求描述

### 2.1 背景

`discussion_spaces` 已有 `projectId` 字段（含索引），但孵化项目的聚合查询服务（`incubation-project-aggregation.service.ts`）和前端详情页中均未包含讨论空间。需要打通两者的基础连接。

### 2.2 目标

1. 孵化项目聚合查询中新增讨论空间聚合
2. 前端孵化项目详情页新增"讨论空间"Tab
3. Stats 统计中包含讨论空间数量
4. 创建讨论空间时的项目关联优化（下拉选择代替文本输入）

### 2.3 验收条件

- [ ] `incubation-project-aggregation.service.ts` 注入 `DiscussionSpace` model
- [ ] 新增 `getProjectDiscussionSpaces(projectId)` 方法
- [ ] `getProjectStats` 返回值中新增 `discussions` 统计
- [ ] `incubation-projects.controller.ts` 新增 `GET :id/discussions` 端点
- [ ] 前端 `IncubationProjectDetail.tsx` Tab 栏新增"讨论空间"
- [ ] 讨论空间卡片展示标题、分类标签、状态、消息数、知识条目数、更新时间
- [ ] 点击卡片跳转到讨论空间详情页
- [ ] Stats 卡片区新增讨论空间数量
- [ ] 前端 `incubationProjectService.ts` 新增 `getProjectDiscussions` 方法
- [ ] `SpaceCreateModal.tsx` 关联项目改为下拉选择（拉取孵化项目列表）

## 3. 技术方案摘要

详见 Plan 文档 [§4 Phase 1](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md)

### 影响范围

- **后端**：EI 服务的聚合服务和 Controller 扩展
- **前端**：`IncubationProjectDetail.tsx` 新增 Tab、`SpaceCreateModal.tsx` 改造
- **数据库**：无 Schema 改动（复用已有 `projectId` 字段和索引）
- **API**：新增 `GET /ei/incubation-projects/:id/discussions`

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-012_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| — | — | — |

## 5. 备注

- EI 服务需注册 `discussion_spaces` 的 shared schema（`MongooseModule.forFeature`）
- 聚合查询仅读取必要字段（title/category/status/statistics/createdAt/updatedAt），避免全量拉取
- 此 REQ 不依赖 Phase 0，可与 Phase 0 并行开发

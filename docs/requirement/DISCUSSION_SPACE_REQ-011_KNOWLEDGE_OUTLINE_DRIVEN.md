# Requirement: DISCUSSION_SPACE_REQ-011_KNOWLEDGE_OUTLINE_DRIVEN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-011 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | draft |
| 创建日期 | 2026-04-30 |
| 最后更新 | 2026-04-30 |

## 2. 需求描述

### 2.1 背景

当前知识库（`discussion_knowledge_entries`）和沉淀文档（`sedimentHistory`）的能力边界模糊。知识库缺少与大纲章节的关联能力，沉淀文档只是讨论消息摘要，无法基于大纲结构组织内容。需要明确两者的职责分工：知识库为"原子化知识积累池"，沉淀文档为"大纲驱动的结构化文档产出"。

### 2.2 目标

1. 知识条目 Schema 新增 `outlineSectionId`、`entryType`、`structuredData` 字段
2. 前端知识面板增加章节归属展示和按章节筛选
3. 沉淀文档生成逻辑改造：检测大纲存在时按大纲结构组织文档
4. 新增知识积累覆盖度统计 API 和前端展示

### 2.3 验收条件

- [ ] `discussion-knowledge-entry.schema.ts` 新增 `outlineSectionId`（可选字符串）字段
- [ ] 新增索引 `{ spaceId: 1, outlineSectionId: 1 }`
- [ ] 新增 `entryType` 枚举字段（`fact`/`data_point`/`opinion`/`source_reference`/`analysis`/`action_item`）
- [ ] 新增 `structuredData` 嵌入对象字段（value/unit/measureDate/compareTo）
- [ ] 创建知识条目时可指定 `outlineSectionId` 和 `entryType`
- [ ] Agent 丰富章节时创建的知识条目自动关联 `outlineSectionId`
- [x] 前端知识面板支持按大纲章节过滤
- [x] 前端知识条目卡片展示 `entryType` 标签
- [x] `discussion-sediment.service.ts` 的 `generateSediment` 改造：大纲存在时按章节结构组织
- [x] 沉淀生成 Prompt 改造为大纲驱动模式
- [ ] `GET /discussions/:spaceId/knowledge/coverage` API 实现
- [x] 前端大纲视图展示每个章节的知识积累覆盖度进度

## 3. 技术方案摘要

详见 Plan 文档 [§4 Phase 0.3](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md)

### 影响范围

- **后端**：`discussion-knowledge-entry.schema.ts` 字段新增、`discussion-knowledge.service.ts` 查询逻辑扩展、`discussion-sediment.service.ts` 生成逻辑改造、新增覆盖度统计 API
- **前端**：`KnowledgePanel.tsx` 增加章节筛选和类型标签、`OutlinePanel.tsx` 增加覆盖度展示、`SedimentPanel.tsx` 适配新的沉淀结构
- **数据库**：`discussion_knowledge_entries` 新增字段和索引
- **API**：新增 `GET /discussions/:spaceId/knowledge/coverage`

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-011_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| — | — | — |

## 5. 备注

- 依赖 REQ-010（大纲升级），`outlineSectionId` 引用的是大纲中的章节 ID
- 已有知识条目数据兼容：`outlineSectionId`/`entryType`/`structuredData` 均为可选字段
- 沉淀生成需做双路径兼容：有大纲走大纲驱动，无大纲保持原有摘要模式

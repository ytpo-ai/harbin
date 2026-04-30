# Requirement: DISCUSSION_SPACE_REQ-010_DOCUMENT_OUTLINE_UPGRADE

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-010 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | draft |
| 创建日期 | 2026-04-30 |
| 最后更新 | 2026-04-30 |

## 2. 需求描述

### 2.1 背景

`discussion-space.schema.ts` 中已有 `documentOutline` 字段（类型 `Record<string, any>`），但结构不明确且使用有限。需要将其升级为结构化的大纲模型，使其成为讨论空间的内容骨架。同时需要支持 Agent 自动生成大纲和前端大纲视图。

### 2.2 目标

1. 定义结构化的 `DocumentOutline` 和 `OutlineSection` 类型，升级 `documentOutline` 字段
2. 创建"行业观察"类讨论空间时，Agent 自动生成行业观察大纲
3. 前端右侧面板新增"大纲"Tab，展示树状大纲结构
4. 支持大纲的手动编辑（增删改排序）和"让 Agent 丰富此章节"快捷操作
5. 新增大纲相关 API（CRUD + 生成/丰富任务 + SSE 事件流）

### 2.3 验收条件

- [ ] `DocumentOutline` 和 `OutlineSection` TypeScript 类型定义完成
- [ ] `documentOutline` 字段兼容旧数据（读取时做 undefined/旧格式判断）
- [ ] 大纲生成异步任务机制实现（`discussion-outline.service.ts` 新增）
- [ ] 创建 `industry_observation` 空间后自动触发大纲生成
- [ ] Agent 大纲生成 Prompt 设计完成并可输出结构化 JSON
- [ ] 大纲 CRUD API 全部实现（generate/get/update/add-section/delete-section/update-section）
- [ ] 章节丰富 API 实现（enrich-section/enrich-all）
- [ ] 大纲任务 SSE 事件流实现
- [ ] 前端 `OutlinePanel.tsx` 组件完成（树状展示 + 状态徽标 + 知识计数）
- [ ] 前端大纲编辑交互完成（修改标题/描述、调整排序、增删章节）
- [ ] 前端"让 Agent 丰富此章节"按钮和反馈 UI 完成

## 3. 技术方案摘要

详见 Plan 文档 [§4 Phase 0.2 和 0.4](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md)

### 影响范围

- **后端**：新增 `discussion-outline.service.ts`；`discussion-space.schema.ts` 类型定义升级；新增 6+ 个 Controller 端点
- **前端**：新增 `OutlinePanel.tsx`、`OutlineSectionCard.tsx`、`OutlineEditModal.tsx`；右侧面板 Tab 扩展
- **数据库**：`discussion_spaces.documentOutline` 字段结构变更（兼容旧数据）
- **API**：新增约 10 个大纲相关端点 + 1 个 SSE 端点

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-010_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| — | — | — |

## 5. 备注

- 依赖 REQ-009（分类字段），需先完成 REQ-009 才能基于分类触发大纲生成
- 大纲生成的 Prompt 质量是关键，建议在开发中多轮迭代调优
- 旧格式 `documentOutline` 数据不做迁移，读取时兼容处理即可

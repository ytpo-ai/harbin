# Plan: DISCUSSION_SPACE_OUTLINE_SECTION_CASCADE_DELETE_PLAN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 需求管理 ID | — |
| 所属项目 | — |
| OpenCode Session | — |
| 状态 | done |
| 优先级 | high |
| 创建日期 | 2026-05-02 |

## 2. 背景

当前讨论空间在章节补充后会生成知识条目，但缺少“仅清空章节补充内容”的能力。用户需要保留章节结构时，无法清理章节自动补充产生的噪声知识，影响覆盖率统计与知识面板可读性。

## 3. 目标

1. 提供“清空章节补充内容”能力，仅删除该章节由章节丰富生成的知识条目。
2. 清空接口返回清理统计（知识条目数），便于前端给出明确反馈。
3. 前端清空确认明确提示“保留章节结构，仅清空补充内容”，降低误操作风险。
4. 清空后前端缓存统一刷新，确保大纲/知识库/覆盖率一致。

## 4. 执行步骤

1. [x] 扩展后端章节服务：新增“清空章节补充内容”接口，删除 `outlineSectionId` 命中且 `sourceName` 为 `outline-enricher-*` 的知识条目。
2. [x] 新增清空结果 DTO，返回 `outline` 与 `clearedKnowledgeCount`。
3. [x] 调整 Controller 与前端 service 类型定义，透传清空统计信息。
4. [x] 前端确认弹窗补充风险文案，成功提示展示清空条数。
5. [x] 补充后端单测覆盖“清空补充但保留章节”链路。
6. [x] 更新 feature/requirement/dailylog 文档并补齐追溯关系。

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-017 | 清空章节补充内容并保留章节结构 | [链接](../requirement/DISCUSSION_SPACE_REQ-017_OUTLINE_SECTION_CASCADE_DELETE.md) | done |

## 6. 关键影响点

- **后端**：`backend/src/modules/discussions/services/discussion-outline.service.ts` 章节补充清空流程
- **前端**：`frontend/src/pages/discussions/DiscussionDetail.tsx`、`frontend/src/services/discussionService.ts`
- **数据库**：`discussion_knowledge_entries` 按 `spaceId + outlineSectionId` 批量删除
- **API**：新增 `DELETE /discussions/:spaceId/outline/sections/:sectionId/enrichments`
- **文档**：feature 追溯、requirement 状态与开发记录占位

## 7. 风险与依赖

- 清空操作为物理删除，需前端确认文案明确不可逆。
- 历史脏数据（孤儿 `outlineSectionId`）不在本次接口内全量修复，仅保证本次删除链路一致。
- 与知识面板筛选、覆盖率统计有耦合，需确保删除后缓存失效策略完整。

## 8. 备注

- 本能力不引入 `organizationId` 字段。
- 默认仅清理“章节丰富生成”的知识条目（`sourceName=outline-enricher-*`），不影响手工录入或其他来源知识。

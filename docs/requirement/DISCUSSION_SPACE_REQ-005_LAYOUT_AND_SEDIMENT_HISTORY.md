# Requirement: DISCUSSION_SPACE_REQ-005_LAYOUT_AND_SEDIMENT_HISTORY

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-005 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | in-progress |
| 创建日期 | 2026-04-29 |
| 最后更新 | 2026-04-29 |

## 2. 需求描述

### 2.1 背景

讨论详情页在桌面端受全局 `Layout` 容器宽度限制，中央主讨论区可视空间不足；同时文档沉淀区域仅展示最新一条内容，用户无法查看历史沉淀版本，导致可读性与可追溯性不足。

### 2.2 目标

- 优化讨论详情页宽度与三栏比例，扩大主讨论区可视面积
- 保持移动端可用性，不破坏现有响应式体验
- 提供沉淀历史查看能力，明确“最新沉淀文档”的来源和可追溯入口
- “立即沉淀”默认使用会议助手 Agent 生成沉淀文档，提升沉淀质量

### 2.3 验收条件

- [ ] `/discussions/:spaceId` 页面使用更宽容器，不再被 `max-w-7xl` 明显压缩
- [ ] 左右侧栏宽度优化后，中央消息区域有效宽度提升
- [ ] 右侧“文档沉淀”面板可查看历史沉淀版本列表并支持预览
- [ ] 前端可通过 API 获取沉淀历史，且与“立即沉淀”结果保持一致
- [ ] “立即沉淀”走会议助手 Agent runtime 执行；若 runtime 异常可回退模板沉淀
- [ ] “立即沉淀”改为任务化 + SSE 状态流（queued/running/succeeded/failed），前端可实时感知执行状态
- [ ] 点击“立即沉淀”需输入沉淀标题，标题作为 Agent 执行 prompt 的核心指令并在文档中展示

## 3. 技术方案摘要

- 在全局布局中针对讨论详情路由切换为 `max-w-none` 容器，保留其他页面默认宽度。
- 调整讨论详情三栏网格比例，优先提升中间消息区空间。
- 后端新增沉淀历史查询接口，基于 `discussion_spaces.sedimentHistory` 返回倒序历史。
- 前端 `discussionService` 扩展沉淀历史接口，`SedimentPanel` 增加历史列表与内容预览交互。
- 后端“手动沉淀”调用会议助手 Agent 执行沉淀任务，实时自动沉淀保持模板生成，避免高频 runtime 开销。
- “立即沉淀”接口返回 taskId，前端订阅 SSE 获取任务状态并在成功后刷新 latest/history。
- 沉淀标题作为后端任务入参持久化到 `sedimentHistory.title`，并用于生成文档主标题。

### 影响范围

- **前端布局**：`frontend/src/components/Layout.tsx`
- **前端页面/组件**：`frontend/src/pages/discussions/DiscussionDetail.tsx`、`frontend/src/components/discussion/SedimentPanel.tsx`
- **前端服务**：`frontend/src/services/discussionService.ts`
- **后端接口**：`backend/src/modules/discussions/discussion.controller.ts`、`backend/src/modules/discussions/services/discussion-sediment.service.ts`、`backend/src/modules/discussions/discussion.types.ts`

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-005_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

- 当前沉淀历史以空间内聚合视角展示，不区分单线程导出任务。

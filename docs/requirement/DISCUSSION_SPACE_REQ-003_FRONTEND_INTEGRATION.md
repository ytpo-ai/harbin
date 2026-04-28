# Requirement: DISCUSSION_SPACE_REQ-003_FRONTEND_INTEGRATION

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-003 |
| 所属 Feature | DISCUSSION_SPACE（待创建） |
| 所属 Plan | [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | in-progress |
| 创建日期 | 2026-04-28 |
| 最后更新 | 2026-04-28 |

## 2. 需求描述

### 2.1 背景

REQ-001 / REQ-002 已完成 Discussion Space 后端能力，但前端仍缺少可用页面，导致树状讨论、分叉、知识面板与文档沉淀无法形成可操作闭环。

### 2.2 目标

完成 REQ-003 的前端与联调能力：
- 讨论空间列表页（创建、筛选、检索、进入详情）
- 讨论空间详情页（三栏布局：线程树 / 对话区 / 上下文面板）
- 核心交互（发送消息、@ 提及辅助、从消息分叉、知识检索、沉淀模式切换、手动沉淀）
- 路由与导航接入（`/discussions`、`/discussions/:spaceId`）

### 2.3 验收条件

- [x] 新增 `discussionService`，覆盖 REQ-003 页面所需 API 调用
- [x] 新增 `discussionStore`（Zustand）管理讨论详情 UI 状态
- [x] 新增讨论空间列表页，可创建空间并进入详情页
- [x] 新增讨论空间详情页，支持三栏布局与线程切换
- [x] 支持消息发送、分叉、知识库检索、沉淀模式切换和手动沉淀
- [x] `App.tsx` 与 `Layout.tsx` 已接入讨论空间路由与导航入口

## 3. 技术方案摘要

- 前端数据层：`react-query` 管理服务端数据拉取与失效刷新；`zustand` 管理线程选中、右侧 Tab、知识关键词等 UI 状态。
- 组件层：拆分列表弹窗、线程树、消息气泡、输入框、沉淀面板、知识面板、参与者面板，降低单页复杂度。
- 联调策略：以 `discussion.controller.ts` 现有 REST 路由为准，前端 service 统一做 payload unwrap 与 `id/_id` 兼容归一。

### 影响范围

- **前端页面**：`frontend/src/pages/Discussions.tsx`、`frontend/src/pages/discussions/DiscussionDetail.tsx`
- **前端组件**：`frontend/src/components/discussion/*`
- **前端服务/状态**：`frontend/src/services/discussionService.ts`、`frontend/src/stores/discussionStore.ts`
- **路由/导航**：`frontend/src/App.tsx`、`frontend/src/components/Layout.tsx`

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-003_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

- 当前版本优先完成核心可用链路；SSE 实时流式与交叉引用跳转体验可在后续迭代增强。

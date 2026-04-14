# Requirement: ORCHESTRATION_TASK_REQ-001_CREATE_PLAN_PROJECT_SELECTOR

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-001 |
| 所属 Feature | [ORCHETRATION_TASK](../feature/ORCHETRATION_TASK.md) |
| 所属 Plan | [ORCHESTRATION_CREATE_PLAN_PROJECT_SELECTOR_PLAN](../plan/ORCHESTRATION_CREATE_PLAN_PROJECT_SELECTOR_PLAN.MD) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | in-progress |
| 创建日期 | 2026-04-14 |
| 最后更新 | 2026-04-14 |

## 2. 需求描述

### 2.1 背景

计划编排列表已支持项目筛选，但创建计划弹窗缺少项目选择入口，用户无法在创建时显式绑定计划所属项目。

### 2.2 目标

在创建计划编排时提供项目选择，确保创建与筛选在同一字段语义上闭环。

### 2.3 验收条件

- [ ] 创建计划弹窗提供项目下拉，支持“全局（无项目）”和具体项目选择。
- [ ] 创建请求提交的 `projectId` 来自弹窗选择值，不再隐式依赖列表筛选值。
- [ ] 新建计划后可被对应项目筛选条件命中。

## 3. 技术方案摘要

通过在前端创建弹窗和页面编排层增加 `projectId` 创建态字段，实现“打开弹窗预填当前筛选值 + 提交时显式透传”的交互流程。后端现有创建 DTO 已支持 `projectId`，无需新增接口。

### 影响范围

- **后端**：无接口变更（复用已有 `CreatePlanFromPromptDto.projectId`）
- **前端**：创建弹窗、创建 payload 映射、复制到新建回填
- **数据库**：复用 `orchestration_plans.projectId`
- **API**：无新增端点

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/ORCHESTRATION_TASK_REQ-001_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

- 该需求为单链路改动，按 `1 plan -> 1 requirement` 处理。

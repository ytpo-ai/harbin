# Requirement: ORCHESTRATION_TASK_REQ-002_CREATE_PLAN_PRECISE_SKILL_ACTIVATION

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-002 |
| 所属 Feature | [ORCHETRATION_TASK](../feature/ORCHETRATION_TASK.md) |
| 所属 Plan | [ORCHESTRATION_CREATE_PLAN_PRECISE_SKILL_ACTIVATION_PLAN](../plan/ORCHESTRATION_CREATE_PLAN_PRECISE_SKILL_ACTIVATION_PLAN.MD) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | in-review |
| 创建日期 | 2026-04-14 |
| 最后更新 | 2026-04-14 |

## 2. 需求描述

### 2.1 背景

研发流程存在多个 workflow skill 版本，且基础标签重叠。当前创建 Plan 无法让用户显式选择 skill，导致标签激活可能命中不准确。

### 2.2 目标

在创建 Plan 时，支持按 `domainType` 从 Planner Agent 已绑定 skills 中筛选并选择目标 skill；选择后使用 `skillActivation.mode='precise'` 精确激活。

### 2.3 验收条件

- [x] 创建弹窗在已选择 Planner Agent 后，展示与 `domainType` 匹配的 skill 选项列表。
- [x] 选择 skill 后，创建请求携带 `skillActivation = { mode: 'precise', skillIds: [...] }`。
- [x] 未选择 skill 时不传 `skillActivation`，保持现有标准激活行为。
- [ ] 后端创建结果中的 `plan.strategy.skillActivation` 与请求一致。

## 3. 技术方案摘要

前端在创建页基于 `plannerAgentId + domainType` 调用 `/skills/agents/:agentId`，按 `domainType:<value>:(must|enable)` 规则过滤 skills，并在弹窗中以可勾选列表展示。创建时若存在选中项则透传 `skillActivation`。后端扩展 `CreatePlanFromPromptDto` 并在 `plan-management.service` 写入 `strategy.skillActivation`。

### 影响范围

- **后端**：`backend/src/modules/orchestration/dto/index.ts`、`backend/src/modules/orchestration/services/plan-management.service.ts`
- **前端**：`frontend/src/pages/orchestration/index.tsx`、`frontend/src/pages/orchestration/components/CreatePlanModal.tsx`、`frontend/src/services/orchestrationService.ts`
- **数据库**：复用 `orchestration_plans.strategy.skillActivation`
- **API**：`POST /orchestration/plans/from-prompt` 请求体新增可选 `skillActivation`

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/ORCHESTRATION_TASK_REQ-002_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

- 本需求不新增接口路径，仅扩展创建 plan 的可选字段与前端交互。

# Requirement: ENGINEERING_INTELLIGENCE_REQ-001_REQUIREMENT_SELECTION_ORDER

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-001 |
| 所属 Feature | [Engineering Intelligence（工程智能）](../feature/ENGINEERING_INTELLIGENCE.md) |
| 所属 Plan | [EI_REQUIREMENT_SELECTION_ORDER_PLAN](../plan/EI_REQUIREMENT_SELECTION_ORDER_PLAN.md) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | in-progress |
| 创建日期 | 2026-04-21 |
| 最后更新 | 2026-04-21 |

## 2. 需求描述

### 2.1 背景

CTO 需求分发流程中，Planner 通过 `requirement.list(status=todo)` 获取待办需求后由 LLM 自主挑选。当前列表排序未体现优先级，并且同优先级下可能选中后创建的需求，导致需求调度不稳定。

### 2.2 目标

- 支持在 requirement list 查询中按优先级和时间排序。
- 提供 `mode=requirement_to_develop`，让 Agent 一次调用即可拿到“最高优先级 + 最早创建”的需求。
- 更新 rd-workflow 技能文档，优先使用稳定模式。

### 2.3 验收条件

- [ ] `GET /ei/requirements` 支持 `sortBy`、`sortOrder` 参数，且按业务优先级正确排序。
- [ ] `GET /ei/requirements?mode=requirement_to_develop` 返回 todo 中单条最优需求（同优先级取最早创建）。
- [ ] `builtin.sys-mg.mcp.requirement.list` 支持透传 `mode`、`sortBy`、`sortOrder`。
- [ ] `docs/skill/rd-workflow.md` 更新为新规则与调用建议。

## 3. 技术方案摘要

在 EI Requirements Service 中引入 priority 权重映射（critical=4, high=3, medium=2, low=1），当按优先级排序或使用 `mode=requirement_to_develop` 时采用聚合排序，避免字符串字典序导致的错误排序。Agent 工具层仅透传参数，不在 LLM 侧做二次选择逻辑。

### 影响范围

- **后端**：`backend/apps/ei/src/dto/requirement.dto.ts`、`backend/apps/ei/src/services/requirements.service.ts`、`backend/apps/ei/src/controllers/requirements.controller.ts`、`backend/apps/agents/src/modules/tools/builtin/engineering-requirement-tool-handler.service.ts`、`backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts`。
- **前端**：无。
- **数据库**：无。
- **API**：`GET /ei/requirements` 查询参数与返回语义扩展。

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/ENGINEERING_INTELLIGENCE_REQ-001_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

- 需保持不传新参数时的兼容行为。

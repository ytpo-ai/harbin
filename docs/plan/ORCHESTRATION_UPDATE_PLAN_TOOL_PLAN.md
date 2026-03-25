# [已弃用] ORCHESTRATION_UPDATE_PLAN_TOOL_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Orchestration Update Plan 工具补齐计划

## 背景

当前系统已具备 Orchestration 的创建、查询、执行、改派、人工完成等 MCP 工具能力，
但缺少“更新计划”工具，导致无法在会议编排流程中直接修订计划基础信息（如标题、描述与执行模式）。

本次目标是补齐 `orchestration_update_plan`，并与现有 Orchestration API/MCP 约定保持一致。

## 执行步骤

1. 在 Orchestration 后端新增计划更新接口与 DTO，采用字段白名单（仅允许更新 `title/sourcePrompt/strategy` 等可编辑字段）。
2. 在 Orchestration Service 实现更新逻辑，增加基本校验（计划存在、字段合法、不可空更新），并同步必要的会话聚合字段。
3. 在 agents/tools 注册 `Orchestration Update Plan` 内置工具，补充参数 schema 与执行分发。
4. 新增 MCP 工具执行实现：将 `orchestration_update_plan` 参数映射到 Orchestration 更新接口，并返回统一结果结构。
5. 更新 API 与功能文档，补充工具清单、接口路径、参数语义与使用说明。

## 关键影响点

- 后端 Orchestration：`backend/src/modules/orchestration/orchestration.controller.ts`、`backend/src/modules/orchestration/orchestration.service.ts`、`backend/src/modules/orchestration/dto/index.ts`
- 后端 Agents Tools：`backend/apps/agents/src/modules/tools/tool.service.ts`
- 文档：`docs/api/agents-api.md`、`docs/feature/ORCHETRATION_TASK.md`、`docs/feature/AGENT_TOOL.md`

## 风险与依赖

- 若不做白名单约束，可能误更新状态/统计等系统字段，影响状态机与执行一致性。
- 更新计划字段后，需确认聚合视图（PlanSession）中依赖字段同步，避免展示数据不一致。
- MCP 调用需兼容会议上下文约束，避免在非会议场景误调用。

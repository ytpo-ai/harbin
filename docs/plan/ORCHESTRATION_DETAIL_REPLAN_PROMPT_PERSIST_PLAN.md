# [已弃用] ORCHESTRATION_DETAIL_REPLAN_PROMPT_PERSIST_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Orchestration Detail Replan Prompt Persist Plan

## Goal

在计划编排详情页新增“重新编排”能力，并确保当前 Prompt 的编辑内容可保持；重新编排时覆盖当前计划任务结构（不新建 Plan），以当前已编辑 Prompt 为准生成新任务。

## Scope

- 计划编排详情页：Prompt 可编辑、保持、保存、重新编排按钮与交互反馈（前端）
- 编排服务：基于现有 planId 覆盖式重新编排任务（后端/API）
- 计划会话与统计：任务重建后状态、统计与会话快照一致性（后端）

## Plan

1. 梳理现有详情页 Prompt 展示与计划更新能力，补充前端 draft 状态与保持机制（按 planId 持久化）。
2. 在详情页将原始 Prompt 改为可编辑区域，提供“保存 Prompt”动作，调用现有更新计划接口落库。
3. 新增“重新编排”按钮与确认交互：以当前编辑中的 Prompt（及当前标题/模式/planner）调用后端覆盖式重编排接口。
4. 后端新增 `POST /orchestration/plans/:id/replan`：复用 Planner 生成任务，删除旧任务并重建依赖与分配，更新 Plan 与 PlanSession。
5. 处理重编排后联动：刷新计划列表/详情、重置调试抽屉状态、统一加载与错误提示，避免并发点击导致竞态。
6. 进行前后端自测并更新相关文档索引（必要时补充功能文档 API 清单）。

## Impact

- Frontend: `frontend/src/pages/Orchestration.tsx`, `frontend/src/services/orchestrationService.ts`
- Backend: `backend/src/modules/orchestration/orchestration.controller.ts`, `backend/src/modules/orchestration/orchestration.service.ts`, `backend/src/modules/orchestration/dto/index.ts`
- Docs: `docs/feature/ORCHETRATION_TASK.md`

## Risks / Dependencies

- 覆盖式重编排会清空旧任务执行轨迹，需在交互层明确确认文案。
- 计划运行中不允许重编排，否则会与异步执行态冲突。
- Prompt draft 与服务端 sourcePrompt 可能短时不一致，需通过“保存”与“重新编排成功后落库”收敛。

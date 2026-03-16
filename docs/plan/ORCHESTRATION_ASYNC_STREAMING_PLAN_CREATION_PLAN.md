# Orchestration Async Streaming Plan Creation Plan

## Goal

将 `POST /orchestration/plans/from-prompt` 从“同步等待编排完成”改为“先创建并返回，再异步逐步生成任务”，并让前端在计划详情页实时看到每个任务生成过程（step-like streaming 体验）。

## Scope

- 后端计划创建链路：同步改异步、状态流转、失败兜底
- 后端计划事件流：计划状态事件与任务逐条生成事件
- 前端创建后跳转详情页与流式展示
- 文档：功能文档/API文档/日报记录

## Plan

1. 调整创建计划入口：`from-prompt` 接口只负责创建 `plan` 占位记录并立即返回，状态设为 `drafting`。
2. 在后端新增异步编排流程：后台调用 planner，按任务逐条落库，边生成边更新 `planSession` / `stats`。
3. 新增计划事件推送接口：提供 `GET /orchestration/plans/:id/events`（SSE），推送 `plan.status.changed`、`plan.task.generated`、`plan.completed`、`plan.failed`。
4. 创建接口改为自动触发异步编排任务，避免请求链路被模型推理阻塞，降低 504 风险。
5. 前端创建成功后自动跳转 `/orchestration/plans/:id`，详情页显示“任务生成中”，并通过 SSE 实时插入每个新任务。
6. 增加断线与异常兜底：SSE 断线自动重连，保留现有轮询作为 fallback，失败态提供明确提示。
7. 补充文档与当日日报，记录接口行为变化与前端交互变化。

## Impact

- Backend
  - `backend/src/modules/orchestration/orchestration.controller.ts`
  - `backend/src/modules/orchestration/orchestration.service.ts`
  - `backend/src/shared/schemas/orchestration-plan.schema.ts`
- Frontend
  - `frontend/src/services/orchestrationService.ts`
  - `frontend/src/pages/Orchestration.tsx`
  - `frontend/src/pages/PlanDetail.tsx`
- Docs
  - `docs/feature/ORCHETRATION_TASK.md`
  - `docs/api/agents-api.md`
  - `docs/dailylog/day/2026-03-16.md`

## Risks / Dependencies

- SSE 使用浏览器长连接，需处理断线重连与 token 鉴权兼容。
- 逐条落库需要确保幂等，避免重复触发导致任务重复创建。
- 单实例内存订阅模型可满足当前体验目标；如需跨实例广播，后续需升级为 Redis/pubsub 事件总线。

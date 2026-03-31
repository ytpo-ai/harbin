# ORCHESTRATION PLAN GENERATION STOP BUTTON PLAN

## 背景

- 计划详情页在“创建并生成任务”后会进入持续生成状态（`drafting`）。
- 当前缺少人工中断入口，用户无法在生成过程中主动停止。

## 目标

- 在计划详情页提供“停止执行（停止生成）”按钮。
- 点击后可终止后续生成推进，并将计划状态收敛到可继续人工编辑的稳定状态。

## 执行步骤

1. 后端新增停止生成接口：`POST /orchestration/plans/:id/stop-generation`。
2. 编排服务新增停止逻辑：将 `generationState` 标记为 `isComplete=true`、`currentPhase=idle`、`lastDecision=stop`，并归档 `plannerSessionId`。
3. 计划状态回写为 `draft`，写入停止元数据（时间、原因），并通过 SSE 发送 `plan.status.changed` 事件。
4. 前端 service/hook 接入停止接口并增加 mutation，成功后刷新计划详情与列表。
5. 在计划详情页头部按钮区新增“停止执行”按钮（仅 `drafting` 可见），并在停止后更新提示文案。
6. 更新功能文档 API 清单，补充“停止生成”能力说明。

## 影响范围

- 后端：`backend/src/modules/orchestration`（controller/service/plan-management/dispatcher）。
- 前端：`frontend/src/services/orchestrationService.ts`、`frontend/src/hooks/usePlanMutations.ts`、`frontend/src/components/orchestration/PlanHeader.tsx`、`frontend/src/pages/PlanDetail.tsx`。
- 文档：`docs/feature/ORCHETRATION_TASK.md`。

## 风险与处理

- 进行中的单步执行可能已进入 in-flight，无法强制中断当前子调用；本次能力保证“停止后不再推进后续步骤”。
- 若并发触发推进与停止，后端以 `generationState.isComplete=true` 为最终收敛条件，避免继续自动推进。

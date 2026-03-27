# ORCHESTRATION SCENE OPTIMIZATION RUNTIME

## 状态

- 当前有效（2026-03-27）

## 核心原则

- 所有“场景化优化”能力统一放在 `SceneOptimizationService`。
- 执行链路只负责调用统一入口，不再内嵌场景特化逻辑。
- 优化触发依赖上下文匹配（`planDomainType + runtimeTaskType + taskStatus + taskOutput`）。

## 运行链路

1. `phasePostExecute` 获取当前任务执行结果。
2. 调用 `sceneOptimizationService.applyPostExecuteOptimizations(context)`。
3. service 内部按规则列表顺序执行：
   - `match(context)` 命中才进入 `apply(context)`
   - 单规则失败仅记录 warn，不中断主链路
4. 优化执行结束后继续 planner post 决策。

## 当前内置规则

- `development-plan-requirement-id-backfill`
  - 触发条件：
    - `planDomainType=development`
    - `runtimeTaskType=development.plan`
    - `taskStatus=completed`
  - 行为：从 task output 提取 `requirementId` 并回填 `plan.metadata.requirementId`
  - 幂等：若已有 `metadata.requirementId`，不覆盖

## 关键文件

- `backend/src/modules/orchestration/services/scene-optimization.service.ts`
- `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts`
- `backend/src/modules/orchestration/services/incremental-planning.service.ts`

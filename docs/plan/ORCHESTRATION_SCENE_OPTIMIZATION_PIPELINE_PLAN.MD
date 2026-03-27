# ORCHESTRATION SCENE OPTIMIZATION PIPELINE PLAN

## 背景

- 当前编排链路中存在“场景优化”型逻辑（例如 requirementId 回填）散落在执行服务中。
- 这类能力本质上依赖 `planDomainType + runtimeTaskType + 执行上下文` 的场景匹配，不适合放在通用执行流程服务中。

## 目标

- 将场景优化能力统一收口到 `SceneOptimizationService`。
- 由执行流程在关键阶段（优先 `post_execute`）调用统一入口，按上下文匹配并执行优化。
- 保持主流程稳定：优化失败不阻断主链路。

## 执行步骤

1. 设计 post_execute 优化规则契约：`match(context)` + `apply(context)`。
2. 将 requirementId 回填逻辑迁移到 `SceneOptimizationService`，并限制为 `development + development.plan + completed`。
3. 在 `OrchestrationStepDispatcherService.phasePostExecute` 接入 `applyPostExecuteOptimizations`。
4. 删除 `IncrementalPlanningService` 中场景优化逻辑，保留通用计划推进职责。
5. 补充测试：SceneOptimizationService 规则匹配与落库行为、Dispatcher 兼容回归。
6. 更新技术文档与日常日志。

## 影响点

- 后端：
  - `backend/src/modules/orchestration/services/scene-optimization.service.ts`
  - `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts`
  - `backend/src/modules/orchestration/services/incremental-planning.service.ts`
- 测试：
  - `backend/test/orchestration/scene-optimization.service.spec.ts`
  - `backend/test/orchestration/orchestration-step-dispatcher.service.spec.ts`

## 风险与约束

- 优化规则误匹配风险：要求显式 domain/taskType 条件。
- 优化失败影响主流程风险：统一 catch + warn，不抛出到调度主链路。
- 幂等约束：已有 `metadata.requirementId` 时不覆盖。

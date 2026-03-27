# ORCHESTRATION TASK TYPE ROUTING CHAIN

## 状态

- 当前有效（2026-03-27）
- 适用于增量编排四阶段调度链路（generate → pre_execute → executing → post_execute）

## 核心结论

- `runtimeTaskType` 不再由 planner 输出，也不接受 planner `taskType` 字段。
- 统一在 `pre_execute` 阶段由 `OrchestrationContextService.inferRuntimeTaskTypeFromPlanContext()` 推断并落库。
- 合法值仅包含：`general`、`research`、`development.plan`、`development.exec`、`development.review`。

## 推断链路

1. `OrchestrationStepDispatcherService.phasePreExecute()` 读取当前 task 与 plan 快照。
2. 调用 `contextService.inferRuntimeTaskTypeFromPlanContext({ planDomainType, planGoal, step, taskTitle, taskDescription, existingRuntimeTaskType })`。
3. 若新值与当前 `task.runtimeTaskType` 不同：
   - 更新 task 文档 `runtimeTaskType`
   - 追加 runLogs：`Runtime task type inferred at pre-execute phase`
4. `buildPreTaskContext()` 将该 `runtimeTaskType` 透传给 planner pre-check。

关键文件：

- `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts`
- `backend/src/modules/orchestration/services/orchestration-context.service.ts`

## 推断规则（当前实现）

优先级从高到低：

1. **显式覆盖保留**：当 `existingRuntimeTaskType` 为合法值时，直接返回，不再重判。
2. **domainType=research**：固定 `research`。
3. **domainType=development**：
   - 命中 review 关键词 → `development.review`
   - 命中 planning 关键词且 `step <= 1` → `development.plan`
   - 其他情况 → `development.exec`
4. **domainType=general（或其他）**：
   - research 关键词 → `research`
   - review 关键词 → `development.review`
   - planning 关键词 → `development.plan`
   - code 关键词 → `development.exec`
   - 都不命中 → `general`

## 执行策略联动

- `development.*` 在 post 阶段遇到 planner `retry` 决策时会被降级为 `redesign`，避免原地自动重试。
- `retryCurrentTask()` 对 `development.*` 会直接拒绝自动重试。

## 测试覆盖

- `backend/test/orchestration/orchestration-context-infer-tasktype.spec.ts`
  - 覆盖 research/development/general 的主要分支
  - 覆盖 `existingRuntimeTaskType` 不被覆盖
- `backend/test/orchestration/orchestration-step-dispatcher.service.spec.ts`
  - 覆盖 pre/post 阶段行为与 `development.*` 的 retry 限制

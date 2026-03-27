# ORCHESTRATION TASKTYPE DEFAULT RUNTIME MAPPING PLAN

## 背景

- 现状中 `runtimeTaskType` 在 `phasePreExecute` 依赖关键词函数推断（如 `isPlanningLikeTask` / `isResearchLikeTask` / `isCodeReviewLikeTask`）。
- 该方式可解释性弱，且与任务生成阶段语义不一致。

## 目标

- 在任务生成阶段为任务设置稳定的 `taskType`（默认 `general`）。
- 在 `phasePreExecute` 设置 `runtimeTaskType` 时优先参考 `taskType`。
- 删除关键词分类函数与相关判断分支。

## 执行步骤

1. 扩展 planner 输出协议，允许输出 `task.taskType`，并在解析时做合法值归一化；缺失时兜底为 `general`。
2. 在任务创建与重设计路径持久化 `taskType`（默认 `general`），并将其透传到 run-task 快照。
3. 调整 `inferRuntimeTaskTypeFromPlanContext` 输入，新增 `taskType` 参考优先级：`existingRuntimeTaskType > taskType > domain fallback`。
4. 删除 `isPlanningLikeTask` / `isResearchLikeTask` / `isCodeReviewLikeTask` / `isCodeLikeTask` 及其调用链。
5. 更新单元测试，覆盖 `taskType` 驱动与 fallback 场景。
6. 更新 guide/feature 文档中的 runtime task type 路由说明，使其与实现一致。

## 影响范围

- 后端：orchestration planner / dispatcher / context / incremental planning
- Schema：`orchestration_tasks`、`orchestration_run_tasks`
- 测试：`orchestration-context-infer-tasktype` 相关测试
- 文档：`docs/guide`、`docs/feature`

## 风险与回滚

- 历史任务无 `taskType` 时，依赖 fallback 规则（`domainType` + 默认值）。
- 若发现分类异常，可临时通过任务编辑接口写入 `runtimeTaskType` 覆盖。

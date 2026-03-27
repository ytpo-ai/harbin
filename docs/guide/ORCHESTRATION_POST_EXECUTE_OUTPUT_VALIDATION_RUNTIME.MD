# ORCHESTRATION POST EXECUTE OUTPUT VALIDATION RUNTIME

## 状态

- 当前有效（2026-03-27）
- 适用于事件驱动四阶段链路中的 `post_execute`

## 核心结论

- 任务输出语义检测已从执行引擎移出，不再在 `execute` 阶段做 research/review/development 的重检测。
- 输出验收规则由 planner 在 `phasePostExecute` 执行，规则来源于 `Planner post-execute validation skill`。
- `TaskOutputValidationService` 已收敛为：
  - 执行提示契约（如 research output contract）
  - post 阶段 skill 文本构建
  - 最小通用校验能力（保留通用 inability 识别）

## 链路说明

1. `phaseExecute` 仅负责执行任务并记录结果（成功输出 / 失败错误）。
2. `phasePostExecute` 调用 `buildPostTaskContext()`，上下文包含：
   - `runtimeTaskType`
   - `executionStatus`
   - `executionOutput` / `executionError`
   - Validation skill 规则文本
3. `PlannerService.executePostTask()` 解析 planner JSON 响应并产出：
   - `nextAction`: `generate_next | retry | redesign | stop`
   - `validation`: `{ passed, verdict, missing, ruleVersion }`
4. Dispatcher 继续执行既有保护：`development.*` 的 `retry` 自动降级为 `redesign`。

## 关键文件

- `backend/src/modules/orchestration/services/task-output-validation.service.ts`
- `backend/src/modules/orchestration/services/orchestration-context.service.ts`
- `backend/src/modules/orchestration/planner.service.ts`
- `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts`
- `backend/src/modules/orchestration/services/orchestration-execution-engine.service.ts`

## 运行时行为变化

- 旧行为：执行阶段直接因为 research/review/development 校验不通过而 fail。
- 新行为：执行阶段记录实际执行结果，post 阶段由 planner+skill 做语义验收并给出下一步决策。
- 收益：
  - 规则集中在 planner post 阶段，减少引擎分支复杂度
  - 验收规则可迭代（skill 版本化）
  - 执行与决策职责更清晰

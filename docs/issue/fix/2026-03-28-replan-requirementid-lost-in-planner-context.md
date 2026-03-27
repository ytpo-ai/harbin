# Fix 记录：重新编排(replan)丢失 requirementId 导致 Planner 拒绝生成任务

## 1. 基本信息

- 标题：重新编排(replan)时 Planner 因缺失 requirementId 拒绝生成任务
- 日期：2026-03-28
- 负责人：AI Agent
- 关联需求/会话：orchestration plan `69c6d2d0496cf4b31ee48065` 重新编排失败
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：点击重新编排后失败，前端提示 `重新编排失败：Planner returned empty task definition: No requirementId/meeting context/plan context provided; cannot generate next task deterministically under rd-workflow anchoring rules.`
- 触发条件：对已完成过首轮编排（已有 `metadata.requirementId`）的 development 类型 plan 执行重新编排
- 影响范围：所有 development 类型 plan 的重新编排场景
- 严重程度：高

## 3. 根因分析

- 直接原因：`buildPlannerContext` 构建 `IncrementalPlannerContext` 时未将 `plan.metadata.requirementId` 传入 context，导致 `extractRequirementAnchor` 无法获取已锚定的 requirementId
- 深层原因：
  1. `replanPlan()` 在 `plan-management.service.ts:450` 删除所有旧任务，`plan-management.service.ts:510` 正确保留了 `metadata.requirementId`
  2. 但 `buildPlannerContext()` 返回的 `IncrementalPlannerContext` 接口没有 `requirementId` 字段
  3. `extractRequirementAnchor()` 仅从 `planGoal`(sourcePrompt)、`completedTasks`(空数组)、`failedTasks`(空数组) 中正则提取 requirementId
  4. replan 后 completedTasks/failedTasks 均为空，sourcePrompt 中不含 requirementId 格式文本，因此 extractRequirementAnchor 返回空
  5. Planner LLM 在 rd-workflow skill 锚定规则约束下拒绝生成任务，返回 reasoning 而非 task
- `tryBackfillRequirementId` 未触发原因：该方法在 `phasePostExecute` 阶段触发，条件为 `taskStatus === 'completed'`。replan 后问题发生在 `phaseGenerate`（第一步任务生成），还没有任何任务被执行，因此 backfill 没有机会触发
- 相关模块/文件：
  - `backend/src/modules/orchestration/planner.service.ts` — `IncrementalPlannerContext` 接口、`extractRequirementAnchor`
  - `backend/src/modules/orchestration/services/incremental-planning.service.ts` — `buildPlannerContext`
  - `backend/src/modules/orchestration/services/plan-management.service.ts` — `replanPlan`
  - `backend/src/modules/orchestration/services/scene-optimization.service.ts` — `tryBackfillRequirementId`（本次未修改）

## 4. 修复动作

- 修复方案：在 `buildPlannerContext` 中读取 `plan.metadata.requirementId` 并传入 context，在 `extractRequirementAnchor` 中优先使用该字段作为锚点
- 代码改动点：
  1. `planner.service.ts:49` — `IncrementalPlannerContext` 接口新增 `requirementId?: string` 可选字段
  2. `incremental-planning.service.ts:551` — `buildPlannerContext` 调用 `resolveRequirementIdFromPlan` 读取 metadata 并填入 context
  3. `planner.service.ts:660` — `extractRequirementAnchor` 优先使用 `context.requirementId`，不再仅依赖正则从文本提取
- 兼容性处理：`requirementId` 为可选字段，首次编排（metadata 无 requirementId）时行为与修复前一致，走正则提取或首步豁免逻辑

## 5. 验证结果

- 验证步骤：TypeScript 类型检查（`tsc --noEmit`）和 ESLint 检查均通过
- 验证结论：通过
- 测试与检查：`tsc --noEmit` 无报错，`eslint` 对两个修改文件无报错

## 6. 风险与后续

- 已知风险：无。修改为增量式，不影响首次编排和正常增量编排流程
- 后续优化：
  1. 可考虑在 `buildPlannerContext` 中同时传入 `requirementTitle`（目前 title 仍依赖正则提取）
  2. `docs/plan/ORCHESTRATION_DEV_WORKFLOW_REMAINING_ISSUES_PLAN.md` 中第 4 项"tryBackfillRequirementId 的 updateOne 必须在 buildPlannerContext 之前完成"的时序问题，在本次修复后对 replan 场景不再是问题（metadata 已在 replanPlan 中同步写入），但对首次编排的 step1→step2 过渡仍需关注
- 是否需要补充功能文档/API文档：否

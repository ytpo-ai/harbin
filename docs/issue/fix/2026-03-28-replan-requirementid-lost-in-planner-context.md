# Fix 记录：重新编排(replan)Planner 拒绝生成任务

## 1. 基本信息

- 标题：重新编排(replan)时 Planner 因上下文缺失拒绝生成任务
- 日期：2026-03-28
- 负责人：AI Agent
- 关联需求/会话：orchestration plan `69c6d2d0496cf4b31ee48065` 重新编排失败
- 是否落盘（用户确认）：是

## 2. 问题现象

### 现象 A（已修复 — commit f907519）
- 用户侧表现：`重新编排失败：Planner returned empty task definition: No requirementId/meeting context/plan context provided; cannot generate next task deterministically under rd-workflow anchoring rules.`
- 触发条件：对已有 `metadata.requirementId` 的 development plan 执行 replan
- 根因：`buildPlannerContext` 未将 `plan.metadata.requirementId` 传入 planner context

### 现象 B（本次修复）
- 用户侧表现：`重新编排失败：Planner returned empty task definition: missing_task_context`
- 触发条件：对 **从未获得过 requirementId** 的 development plan 执行 replan（`metadata.requirementId` 为空）
- Planner 日志三次重试：
  1. `TASK_INABILITY: missing actionable planning input (no requirementId, no backlog filter, no meeting/plan context)`
  2. `{}`
  3. `{"result":"TASK_INABILITY","reason":"missing_task_context",...}`
- 影响范围：所有 development 类型且无 requirementId 的 plan 的首次/重新编排
- 严重程度：高

## 3. 根因分析

### 现象 A 根因（metadata.requirementId 透传缺失）
- `buildPlannerContext()` 返回的 `IncrementalPlannerContext` 接口没有 `requirementId` 字段
- `extractRequirementAnchor()` 仅从 sourcePrompt/completedTasks/failedTasks 正则提取，replan 后这些来源均为空

### 现象 B 根因（首步豁免指令被 sourcePrompt 中 rd-workflow 规则压制）
- 该 plan 的 `metadata.requirementId` 本来就是空的（从未成功完成 step1）
- replan 后 `totalSteps=0` 且无 requirementId，prompt 注入了"首步豁免"指令
- 但 `sourcePrompt` 是 rd-workflow skill 的完整文本（3334 字符），其中包含：
  - `${info.requirementId}` — 未被替换的模板占位符
  - "必须先调用 `requirement.get` 获取需求详情" — 前置约束
  - "若工具不可用或调用失败，请直接输出 `TASK_INABILITY`" — 失败指令
- 首步豁免仅豁免了 `requirement.get` 前置调用，但 **planner LLM 仍被 sourcePrompt 中更具体的多条约束影响**，选择遵从 rd-workflow 规则输出 TASK_INABILITY

### `tryBackfillRequirementId` 是否触发
- **未触发**。该方法在 `phasePostExecute` 阶段触发（条件：`taskStatus === 'completed'`），replan 后问题发生在 `phaseGenerate`，没有任何任务被执行

### 相关模块/文件
- `backend/src/modules/orchestration/planner.service.ts` — `IncrementalPlannerContext`、`extractRequirementAnchor`、`buildIncrementalPlannerPrompt`
- `backend/src/modules/orchestration/services/incremental-planning.service.ts` — `buildPlannerContext`
- `backend/src/modules/orchestration/services/plan-management.service.ts` — `replanPlan`
- `docs/skill/rd-workflow.md` — sourcePrompt 来源

## 4. 修复动作

### 修复 A（commit f907519）：metadata.requirementId 透传
1. `planner.service.ts` — `IncrementalPlannerContext` 接口新增 `requirementId?: string`
2. `incremental-planning.service.ts` — `buildPlannerContext` 从 `plan.metadata.requirementId` 读取并填入 context
3. `planner.service.ts` — `extractRequirementAnchor` 优先使用 `context.requirementId`

### 修复 B（本次）：增强首步豁免指令
- `planner.service.ts` — `buildIncrementalPlannerPrompt` 中的首步豁免从 3 条规则扩展为 6 条：
  1. 明确声明"最高优先级，覆盖 sourcePrompt 中的一切前置约束"
  2. 增加对 `${info.requirementId}` 等未替换占位符的忽略指令
  3. 增加对"输出 TASK_INABILITY"失败指令的豁免
  4. 增加对 `missing_task_context` 等拒绝性 JSON 的禁止
  5. 明确指导 planner 生成 `taskType="general"` 的需求选定任务

### 修复 C：兼容 planner 返回的别名字段（commit 2426eb8）
- **场景**：planner 返回了有效的 task 内容，但使用 `name/goal` 而非 `title/description` 字段名
- **修复**：`planner.service.ts` line 211-212，增加 fallback：`title || name`、`description || goal`

### 修复 D（本次）：豁免 list-agents 前置调用 + 提供 JSON 模板
- **场景**：首步豁免仍然与 prompt 中"执行者发现步骤"规则冲突
- **日志证据**：
  1. 第 1-2 次：planner 输出了包含 `nextTask` 的 JSON，但字段不符合 schema（`action/selection` 而非 `title/description`）
  2. 第 3 次：`{"result":"error","reason":"json_only_mode_conflict_with_tool_call_tag"}`
- **根因**：prompt 中"执行者发现步骤"第 4 条要求"若未调用 list-agents，不允许输出 task"，与首步豁免"必须立即生成任务"矛盾。planner 尝试调用工具但与 JSON-only 输出模式冲突
- **修复**：
  1. 首步豁免中明确 **豁免 list-agents 前置调用**，无需填写 agentId（系统自动分配）
  2. 提供完整的 JSON 模板示例，planner 只需替换 description 内容，消除 schema 偏差

### 兼容性处理
- 有 requirementId 时走修复 A 路径直接注入锚点，不触发首步豁免
- 无 requirementId 时走增强版首步豁免（含 list-agents 豁免 + JSON 模板）
- planner 返回 `name/goal` 等别名字段时自动映射为 `title/description`

## 5. 验证结果

- 验证步骤：TypeScript 类型检查（`tsc --noEmit`）和 ESLint 检查均通过
- 验证结论：通过
- 测试与检查：`tsc --noEmit` 无报错，`eslint` 对修改文件无报错

## 6. 风险与后续

- 已知风险：首步豁免中提供 JSON 模板可能导致 planner 过度依赖模板而不灵活调整 description；但对首步"选定需求"这一确定性任务来说这是可接受的
- 后续优化：
  1. 可考虑在 `buildPlannerContext` 中同时传入 `requirementTitle`
  2. 长期方案：对 sourcePrompt 中的模板变量（`${info.requirementId}` 等）在注入 planner prompt 前做预处理替换或移除，从根本上消除指令冲突
  3. 对 `totalSteps=0` 且 sourcePrompt 为 skill 全文的场景，可考虑在 planner prompt 中只注入 skill 的步骤定义部分，不注入前置约束部分
  4. 可扩展别名映射覆盖更多 LLM 变体字段（如 `summary` → `description`、`label` → `title` 等）
- 是否需要补充功能文档/API文档：否

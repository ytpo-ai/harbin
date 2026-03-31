# Step3 生成无反应回归问题追溯与修复记录

## 1. 基本信息

- 标题：计划编排在 Step2 后生成 Step3 无反应（实为增量规划失败重试）
- 日期：2026-03-28
- 负责人：AI Agent
- 关联计划：`69c6b280b67c16ec3799c0da`
- 关联提交：`cc12a2f`（本次修复提交）
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：在计划详情页点击"生成下一步"后，页面看起来无变化，无法进入 Step3。
- 触发位置：`/orchestration/plans/69c6b280b67c16ec3799c0da`
- 影响范围：增量规划（incremental planning）路径，尤其是 Planner 返回非标准 JSON 时。
- 严重程度：高（核心编排流程中断）。

## 3. 完整追溯流程（含疑问与答案）

### Q1：是不是接口根本没执行？

- 追溯动作：调用 `POST /api/orchestration/plans/:id/generate-next`，并对比 API / DB / 日志。
- 证据：接口返回 `201` + `{ accepted: true }`，网关与 legacy 日志都有请求与 planner 调用记录。
- 结论：接口是执行了，不是前端按钮失效。

### Q2：为什么用户看到"无反应"？

- 追溯动作：查看 plan state 与 task 列表。
- 证据：`taskCount` 长时间停留在 2（只有 step1/step2），`generationState.totalFailures` 持续增加，`lastError` 为 `Planner returned empty task definition`。
- 结论：前端没动静的根因是后端每次都 accepted，但没有成功产出下一任务。

### Q3：Planner 没返回，还是返回了但解析失败？

- 追溯动作：抓取 `agent_messages` 中对应 planner 会话内容。
- 关键返回样例：
  - `{}`
  - `{"result":"TASK_INABILITY..."}`
  - `{"result":"ok","nextTask":{...}}`
- 结论：Planner 有返回，但并非都符合当前解析器严格期望。

### Q4：解析器具体卡在哪？

- 追溯动作：审查 `planner.service.ts` 和 dispatcher / incremental 路径的判空逻辑。
- 发现：
  1. 只认 `parsed.task`，`parsed.nextTask` 不兼容。
  2. 旧逻辑把 `agentId` 作为任务有效性的硬条件（即使 `title/description` 合法也会被丢弃）。
  3. 失败原因写死为 `Planner returned empty task definition`，丢失了真实上下文（如 `TASK_INABILITY` 原因）。
- 结论：这是最近几次编排重构后引入的兼容性回归，不是单点超时问题。

### Q5：为何会反复出现 `TASK_INABILITY: missing actionable input`？

- 追溯动作：检查增量 prompt 构建内容。
- 发现：`buildIncrementalPlannerPrompt` 没有稳定把 requirement 锚点（requirementId/标题）注入高优先级上下文，且 sourcePrompt 内存在占位符文本，容易误导模型。
- 结论：上下文锚点不足导致 Planner 在某些轮次退化为 inability 回答。

## 4. 修复动作

### 4.1 响应兼容修复（核心）

- 文件：`backend/src/modules/orchestration/planner.service.ts`
- 改动：
  - 新增 `resolvePlannerTaskCandidate`：兼容 `task` 与 `nextTask` 两种返回结构。
  - 调整任务有效性判断：以 `title + description` 为核心，不再要求 `agentId` 必填才算有效任务。
  - 新增 `resolvePlannerReasoning`：从 `reasoning/reason/message/result` 中提取失败线索。

### 4.2 Prompt 锚点增强（稳定性）

- 文件：`backend/src/modules/orchestration/planner.service.ts`
- 改动：
  - 新增 `extractRequirementAnchor`，从计划目标与已完成任务输出里提取 `requirementId/requirementTitle`。
  - 在增量 prompt 前置 `上下文锚点（高优先级）`，并显式说明忽略 `${...}` 占位符字面值。

### 4.3 失败可观测性增强（排障）

- 文件：
  - `backend/src/modules/orchestration/services/incremental-planning.service.ts`
  - `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts`
- 改动：
  - 新增 `buildEmptyTaskReason`，将 planner 的具体 reasoning 拼接进 `lastError`。
  - 避免所有失败都被笼统记录成同一句，便于后续快速定位真实失败模式。

## 5. 验证过程与结果

- 构建验证：`backend npm run build` 通过。
- 在线验证（目标计划 `69c6b280b67c16ec3799c0da`）：
  1. 触发 `generate-next` 后，计划从 `currentStep=2` 推进到 `currentStep=3`。
  2. 成功生成并执行了新增任务（order=2，随后继续生成 step3 任务）。
  3. 新生成任务包含 `taskType=development.plan`，状态进入执行链路（`in_progress`）。
- 结论：问题已从"accepted 但无任务生成"恢复为"可持续推进下一步"。

## 6. 本次关键疑问与最终答案（简表）

- 疑问：按钮是不是没触发？
  - 答案：不是，接口触发成功，失败在后端任务生成阶段。
- 疑问：是不是 run 链路挂了？
  - 答案：不是，run 链路正常，问题集中在 planner 输出解析。
- 疑问：为什么之前正常、最近异常？
  - 答案：近期 commit 引入了更严格解析与 prompt 约束，但缺少对 `nextTask` 等返回形态兼容，导致回归。
- 疑问：为什么看起来像"无反应"？
  - 答案：每次都 accepted 但落不出 task，前端没有可展示的新 step。

## 7. 风险与后续建议

- 已知风险：Planner 仍可能返回高度非结构化 JSON（如极短 `{}`），需要继续提升 parser 鲁棒性。
- 后续建议：
  1. 增加单测覆盖：`task` / `nextTask` / inability / 空对象四类输入。
  2. 在 UI 增加"生成失败原因"提示（读取 `generationState.lastError`），减少"无反应"感知。
  3. 为 requirement 锚点提取新增回归测试，防止未来重构再次丢失。

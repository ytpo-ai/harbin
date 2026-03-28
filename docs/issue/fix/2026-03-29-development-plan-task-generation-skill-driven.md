# Fix: Development 计划任务生成偏离 — Skill 驱动改造

- 日期: 2026-03-29
- 类型: fix + refactor
- 影响范围: orchestration planner、rd-workflow skill、plan-management、PlanHeader

## 现象

当创建 `domainType=development` 的计划并使用 rd-workflow 流程时，出现以下问题：

1. **任务生成偏离计划期望**：Planner 没有按 rd-workflow 的 step1→step5 顺序生成任务，而是生成"元规划任务"（描述如何做规划的任务）
2. **Planner 角色混淆**：Planner 把自己当成执行者，调用业务工具（requirement.board/detail），输出 TASK_INABILITY 或确认性文本
3. **Planner 与 Executor Session 共享**：当 planner agent 和 executor agent 为同一 agent（如 Kim-CTO）时，两者共享 plan session，导致上下文交叉污染
4. **post-execute 默认 stop**：任务执行完成后 Planner 返回无效 JSON，默认 `nextAction='stop'`，导致 `isComplete=true`，编排卡住
5. **"生成下一步"按钮不可点**：前端按钮因 `generationCompleted` 禁用，用户无法手动恢复
6. **重复生成 step1**：Planner 多轮生成中持续生成 step1 而不推进到 step2

## 根因

1. rd-workflow 的 sourcePrompt 直接注入 planner prompt，LLM 无法区分"给 Planner 的元指令"和"给执行者的业务步骤"
2. rd-workflow skill 内容中包含命令式工具调用指令（"调用 requirement.board"），Planner 将其误解为自己要执行的操作
3. `getOrCreatePlanSession` 按 `planId + agentId` 查找 session，planner 和 executor 同 agent 时共享
4. post-execute prompt 没有告诉 Planner 当前是多步流程中的第几步
5. `generateNext` API 在 `isComplete=true` 时直接拒绝，无法恢复
6. 步骤引导中的步骤计数不够明确，Planner 无法确定已完成步骤与 skill step 的对应关系

## 修复动作

### 1. planner.service.ts — `buildIncrementalPlannerPrompt()` 增强

- 新增 `domainType` 参数，当 `development` 时激活 skill 驱动模式
- **角色边界区块**：明确 Planner 是规划器而非执行者，禁止调用业务工具、输出确认文本、TASK_INABILITY
- **技能步骤引导区块**：告诉 Planner 按 skill 定义的 step 序号逐步生成任务
- **步骤进度区块**：用 `completedTasks.length` 计算已完成步骤数，明确"你现在必须生成 step{N}"，禁止重复已完成步骤
- **已完成任务摘要增强**：每个已完成任务标注对应的 skill step 编号
- **首步引导**：development 模式下引导参照 skill step1 定义，告知执行者应主动查询需求池

### 2. orchestration-context.service.ts — `buildPostTaskContext()` 增强

- 新增 `planDomainType`、`totalGeneratedSteps` 参数
- development 模式下注入多步流程进度提示，引导 Planner 返回 `generate_next` 而非 `stop`

### 3. orchestration-step-dispatcher.service.ts — Planner Session 隔离

- `ensurePlannerSession` 传入 `orchestrationRunId: 'planner'`
- 使 planner session ID 变为 `plan-{planId}-{agentId}-run-planner`，与 executor session 完全隔离
- `phasePostExecute` 传入 `planDomainType` 和 `totalGeneratedSteps`

### 4. plan-management.service.ts — `generateNext()` 允许重置

- 移除 `isComplete=true` 时直接拒绝的逻辑
- 用户手动点击"生成下一步"时，自动重置 `isComplete=false`、`consecutiveFailures=0`、`currentPhase='idle'`、`status='planned'`

### 5. PlanHeader.tsx — 移除按钮禁用条件

- "生成下一步"按钮移除 `generationCompleted` 禁用条件，用户始终可以手动触发

### 6. docs/skill/rd-workflow.md — Skill 内容重构

- 新增"Planner 角色说明"区块（最高优先级），明确本技能是任务模板
- 去除命令式工具调用指令（"调用 requirement.board"→"使用需求管理工具主动获取"）
- 删除"需求上下文获取规则"和旧版"需求状态更新规则"（导致 Planner 执行工具的根因）
- 恢复需求状态更新规则，限定在 pre-execute 阶段执行
- step1 动作描述增加"本步骤无需依赖上游输入，执行者应直接查询需求池"
- 版本升至 0.4.0

## 验证结果

- step1 任务生成正确，符合 rd-workflow step1 定义
- step1 executor 成功执行，返回 requirementId + 标题 + 描述 + 选择依据
- planner session 与 executor session 成功隔离
- post-execute 正确返回 generate_next 继续流程
- "生成下一步"按钮始终可点击
- 步骤重复生成问题待新计划验证（已增强步骤进度引导）

## 涉及文件

| 文件 | 变更类型 |
|------|----------|
| `backend/src/modules/orchestration/planner.service.ts` | 修改 |
| `backend/src/modules/orchestration/services/orchestration-context.service.ts` | 修改 |
| `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts` | 修改 |
| `backend/src/modules/orchestration/services/plan-management.service.ts` | 修改 |
| `frontend/src/components/orchestration/PlanHeader.tsx` | 修改 |
| `docs/skill/rd-workflow.md` | 修改 |

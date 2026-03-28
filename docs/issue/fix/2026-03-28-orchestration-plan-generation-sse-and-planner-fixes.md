# 编排计划重新生成后页面无反应 & Planner 首步拒绝生成 — 完整追溯

## 1. 基本信息

- 标题：编排计划重新生成/生成下一步后页面迟迟无反应，Planner 首步返回 TASK_INABILITY
- 日期：2026-03-28
- 负责人：AI Agent
- 关联计划：`69c6b280b67c16ec3799c0da`、`69c6a8bf451f67e7b30ed4ff`、`69c6d2d0496cf4b31ee48065`
- 是否落盘：是

## 2. 问题现象

- **用户侧表现**：计划重新编排或点击"生成下一步"后，页面迟迟没有反应——既看不到任务生成进度，也看不到成功/失败提示。
- **触发条件**：近期多个计划编排相关 commit（`cc12a2f`、`5510e58` 等）引入了 incremental planning 重构，改变了 SSE 事件前缀命名。
- **影响范围**：所有使用增量编排（`generationMode: 'incremental'`）的计划。
- **严重程度**：高（核心功能不可用）。

## 3. 根因分析（追溯过程）

### 3.1 问题一：SSE 事件命名不匹配（页面无反应的主因）

**疑问**：重新编排 API 返回 `{ accepted: true }` 没有报错，后端日志也显示 planner 在正常运行，但前端页面为什么没有反应？

**追溯路径**：
```
前端 usePlanStreaming.ts → subscribePlanEvents(planId) → EventSource SSE
  → 监听事件名: plan.task.generated / plan.completed / plan.failed / plan.status.changed

后端 incremental-planning.service.ts → emitPlanStreamEvent
  → 发射事件名: planning.task.generated / planning.completed / planning.failed
     (无 plan.status.changed)

后端 step-dispatcher.service.ts → emitStepStarted
  → 发射事件名: planning.step.started / planning.task.generated
```

**根因确认**：前端监听 `plan.*` 前缀，后端发射 `planning.*` 前缀，两者不匹配。前端永远收不到事件，页面一直处于等待状态。

**追溯验证**：通过 `grep` 对比前端 `usePlanStreaming.ts` 中的事件名和后端 `incremental-planning.service.ts`、`plan-event-stream.service.ts` 中的事件名，确认了命名不一致。

### 3.2 问题二：completePlanning / failPlanning 不发 plan.status.changed

**疑问**：即使前端能收到 `planning.completed`，它还需要 `plan.status.changed` 事件来触发状态轮询切换（如从 `drafting` 到 `planned`）。这个事件在哪里发射？

**追溯路径**：
```
completePlanning → 只发 planning.completed，不发 plan.status.changed
failPlanning → 只发 planning.failed，不发 plan.status.changed
```

**根因确认**：两个终态方法都缺少 `plan.status.changed` 事件。前端的 `useEffect` 监听 `planDetail.status === 'planned'` 来判断编排完成，但不通过 SSE 触发数据刷新就看不到状态变更。

### 3.3 问题三：step-dispatcher 的 phaseGenerate 不发 drafting 状态

**疑问**：incremental-planning 路径通过 `prepareDraftingState` 设置 plan status 为 `drafting` 并发射 `plan.status.changed`，step-dispatcher 路径是否也有同样的处理？

**追溯路径**：
```
step-dispatcher.phaseGenerate
  → 直接开始 buildPlannerContext + generateNextTask
  → 没有设置 plan.status = 'drafting'
  → 没有发射 plan.status.changed
```

**根因确认**：step-dispatcher 路径缺少 drafting 状态设置和事件发射，前端无法感知到编排已开始。

### 3.4 问题四：Agent 分配错误（fallback 选了无工具 agent）

**疑问**：step1 成功生成但 output 是 `TASK_INABILITY: Tool not assigned`，说明任务分配给了错误的 agent。为什么？

**追溯路径**：
```
createTaskFromPlannerOutput
  → normalizedAgentId = taskResult.agentId （planner 未提供，为空）
  → resolveAssignmentForPlannerTask(taskResult, '') 
    → resolveValidAgentId('') → null
    → resolveFallbackAssignment → executorSelectionService 
      → 按 roleMatch 评分选中 Alex-CEO（score=29，role-executive-lead）
      → Alex-CEO 没有任何工具 → 无法执行 requirement.get
```

**关键发现**：
- planner agent 在 JSON 中没有填写 `agentId` 字段
- fallback 的 executor selection 按角色匹配选了 Alex-CEO（0 个工具）
- 而 plan 的 plannerAgentId 是 Kim-CTO（有 requirement 等全套工具），完全适合执行 step1

**疑问**：plan 的 planner agent（Kim-CTO）信息在 task 创建时可用吗？

**追溯确认**：可用。`plan.strategy.plannerAgentId` 存储了 Kim-CTO 的 ID。但 `createTaskFromPlannerOutput` 只传了 `taskResult.agentId`（planner output 中的），没有传 plan 级别的 plannerAgentId 作为 fallback。

### 3.5 问题五：generateNext 不重置 consecutiveFailures

**疑问**：用户点击"生成下一步"来手动重试，为什么立即失败？

**追溯路径**：
```
generateNext(planId)
  → plan.generationState.consecutiveFailures = 3, maxRetries = 3
  → setTimeout → advanceOnce / executeSinglePlanningStep
    → checkTerminalConditions: consecutiveFailures(3) >= maxRetries(3) → 立即 failAndArchive
```

**根因确认**：`generateNext` 是用户主动重试操作，但它不重置 `consecutiveFailures`。之前的 3 次自动重试已达上限，手动重试直接被拦截。

### 3.6 问题六：Planner 首步拒绝生成（TASK_INABILITY）

**疑问**：修复了上述问题后创建新计划，planner 仍然在第一步返回 `TASK_INABILITY: missing actionable input for planning`。为什么？

**追溯路径**：

```
buildIncrementalPlannerPrompt(context)
  → extractRequirementAnchor(context) → requirementId = undefined（首步无已完成任务）
  → 输出: "- requirementId: (unknown)"
  
sourcePrompt (rd-workflow) 包含:
  "需求上下文获取规则（强制）:
   - 必须先调用 requirement.get 获取最新需求详情
   - 若工具不可用或调用失败，请直接输出 TASK_INABILITY 并停止规划"
```

**根因确认**：两段指令产生矛盾——
1. 上下文锚点说 `requirementId: (unknown)`
2. sourcePrompt 规则说"没有 requirementId 就必须 TASK_INABILITY"

planner LLM 遵循了 sourcePrompt 中更严格的规则，输出 TASK_INABILITY 拒绝生成 step1。

但 step1 的目的就是**去选定需求**——此时不可能已有 requirementId。

**第一次修复尝试**（`334caec`）：将 `(unknown)` 改为 `(尚未选定，本轮任务即为选定需求，无需预先持有 requirementId)`。

**验证**：仍然失败。planner 看到 sourcePrompt 中的"需求上下文获取规则"优先级更高，继续输出 TASK_INABILITY。

**第二次修复**（`210e4e4`）：注入 `[SYSTEM OVERRIDE — 首步豁免]` 级别的指令块，明确压制 sourcePrompt 中的前置要求：
- "你 **必须** 立即生成第一个任务"
- "sourcePrompt 中的 requirement.get 前置调用要求 **不适用于本步**"
- "禁止输出 task=null 或 TASK_INABILITY"

### 3.7 问题七：requirementId backfill 未触发

**疑问**：即使 step1 成功完成且 output 中含 `requirementId: req-xxx`，后续 planner prompt 仍然显示 `requirementId: (unknown)`。backfill 为什么没触发？

**追溯路径**：
```
SceneOptimizationService.getPostExecuteRules()
  → rule: development-plan-requirement-id-backfill
    → match: planDomainType === 'development' 
           && runtimeTaskType === 'development.plan'  ← 关键条件
           && taskStatus === 'completed'

step1 的 runtimeTaskType = 'general'（不是 'development.plan'）
→ match 返回 false → tryBackfillRequirementId 从未被调用
→ plan.metadata.requirementId 始终为空
→ extractRequirementAnchor 只从 completedTasks 的 outputSummary 中提取，不从 metadata 中读
```

**根因确认**：backfill 的 match 条件要求 `runtimeTaskType === 'development.plan'`，但 requirementId 最早出现在 step1 output 中，而 step1 的类型是 `general`。

## 4. 修复动作（7 个 commit）

### Commit 1: `2edde2b` — SSE 事件命名对齐

| 文件 | 变更 |
|---|---|
| `frontend/src/hooks/usePlanStreaming.ts` | 同时监听 `plan.*` 和 `planning.*` 两种事件前缀；新增 `planning.task.completed`/`planning.task.failed` 处理；兼容 `event.data.taskId` 和 `event.data.task._id` |
| `backend/.../incremental-planning.service.ts` | `completePlanning` 和 `failPlanning` 新增 `plan.status.changed` 事件发射 |
| `backend/.../orchestration-step-dispatcher.service.ts` | `phaseGenerate` 开始时设置 `status: 'drafting'` 并发射 `plan.status.changed` |
| `backend/.../orchestration-context.service.ts` | 新增 `isPlanContractStepTask`（后续 commit 移除） |
| `backend/.../orchestration-context.service.spec.ts` | 新增测试用例 |

### Commit 2: `e3aabc6` — Agent 分配 fallback 到 plan planner

| 文件 | 变更 |
|---|---|
| `backend/.../incremental-planning.service.ts` | `resolveAssignmentForPlannerTask` 新增第三参数 `planPlannerAgentId`；planner 未提供 agentId 时，general 类型任务回退到 plan 的 planner agent |
| `backend/test/.../incremental-planning.redesign-taskid.spec.ts` | 更新 mock |

### Commit 3: `b3689f4` — generateNext 重置 consecutiveFailures

| 文件 | 变更 |
|---|---|
| `backend/.../plan-management.service.ts` | `generateNext` 执行前将 `consecutiveFailures` 重置为 0，清除 `lastError`，设 `currentPhase: 'idle'` |

### Commit 4: `fdb7763` — 移除硬编码 runtimeTaskType 推断

| 文件 | 变更 |
|---|---|
| `backend/.../orchestration-context.service.ts` | 移除 `isPlanContractStepTask` 和 `isReviewContractStepTask`；fallback 仅按 plan domain 粗分 |
| `backend/.../orchestration-context.service.spec.ts` | 重写测试用例，覆盖 domain fallback 和 existingRuntimeTaskType 优先级 |

### Commit 5: `334caec` + `210e4e4` — Planner prompt 首步豁免

| 文件 | 变更 |
|---|---|
| `backend/.../planner.service.ts` | `buildIncrementalPlannerPrompt` 中 `totalSteps === 0` 时注入 `[SYSTEM OVERRIDE — 首步豁免]` 指令块；新增 planner raw response 调试日志 |

### Commit 6: `6095dd0` — requirementId backfill match 条件放宽

| 文件 | 变更 |
|---|---|
| `backend/.../scene-optimization.service.ts` | backfill rule 的 match 条件从 `runtimeTaskType === 'development.plan'` 改为仅检查 `planDomainType === 'development'` + `taskStatus === 'completed'` |
| `backend/test/.../scene-optimization.service.spec.ts` | 新增 step1 general 类型任务触发 backfill 的测试 |

## 5. 验证结果

- TypeScript 编译检查：前端、后端均通过
- 单元测试：44/44 全部通过
- API 测试：`POST /plans/:id/replan` 返回 `{ accepted: true }`，`POST /plans/:id/generate-next` 返回 `{ accepted: true }`

## 6. 问题追溯总结图

```
用户点击"重新编排" / "生成下一步"
  │
  ├─ 页面无反应 ← SSE 事件前缀不匹配（问题 1）
  │                 + completePlanning/failPlanning 不发 plan.status.changed（问题 2）
  │                 + step-dispatcher 不发 drafting 状态事件（问题 3）
  │
  ├─ 任务执行失败（TASK_INABILITY: Tool not assigned）← Agent 分配错误（问题 4）
  │     planner 未填 agentId → fallback 选了无工具的 Alex-CEO
  │
  ├─ 手动重试立即失败 ← consecutiveFailures 未重置（问题 5）
  │
  ├─ Planner 首步拒绝生成 ← requirementId unknown + sourcePrompt 规则冲突（问题 6）
  │     sourcePrompt 要求先 requirement.get → step1 无法满足 → TASK_INABILITY
  │
  └─ 后续步骤缺少 requirementId ← backfill 条件太窄（问题 7）
        match 只认 development.plan，但 requirementId 首现于 general 类型的 step1
```

## 7. 风险与后续

- **已知风险**：planner LLM 行为不完全可控，SYSTEM OVERRIDE 指令可能对不同模型效果不同
- **后续优化**：
  - 考虑统一 SSE 事件前缀为 `planning.*`，前端全面迁移
  - planner session 污染问题仍存在（见 `2026-03-28-orchestration-plan-first-step-failure-investigation.md`）
  - post-execute 阶段 LLM 返回空响应导致过早 stop 的问题待后续修复

## 8. 关键文件索引

| 文件 | 职责 |
|---|---|
| `frontend/src/hooks/usePlanStreaming.ts` | 前端 SSE 事件监听与 UI 状态更新 |
| `backend/.../planner.service.ts` | Planner prompt 构建、LLM 调用、响应解析 |
| `backend/.../incremental-planning.service.ts` | 增量规划引擎、任务创建、agent 分配 |
| `backend/.../orchestration-step-dispatcher.service.ts` | 四阶段调度器、post-execute 优化调用 |
| `backend/.../plan-management.service.ts` | generateNext / replan 入口、failure 重置 |
| `backend/.../orchestration-context.service.ts` | runtimeTaskType 推断 |
| `backend/.../scene-optimization.service.ts` | requirementId backfill 规则 |
| `backend/.../plan-event-stream.service.ts` | SSE 事件发射 |

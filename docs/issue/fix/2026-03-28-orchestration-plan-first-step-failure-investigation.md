# Orchestration 增量规划首步失败 — 完整追溯流程

## 1. 基本信息

- 标题：编排计划首步生成失败，Planner Agent 返回非 JSON / 空 task
- 日期：2026-03-28
- 负责人：AI Agent
- 关联需求/会话：计划 `69c7557f6ef4ad0682f0e978`（需求开发3）
- 是否落盘（用户确认）：是

## 2. 问题现象

- **用户侧表现**：新建编排计划后，任务在第一步就失败，`generationState.lastError` 显示 "Planner returned empty task definition: Missing required planning context..."
- **触发条件**：通过前端创建增量编排计划（`autoGenerate=true`），Planner Agent 为 Kim-CTO（`698a0bd7db9f7e6b8cca4171`），模型为 `gpt-5.3-codex`
- **影响范围**：所有使用该 Planner Agent 的增量编排计划均受影响
- **严重程度**：高（计划无法正常执行）

## 3. 根因分析（追溯过程）

### 3.1 初步观察

通过 API 获取计划详情：

```
GET /api/orchestration/plans/69c7557f6ef4ad0682f0e978
```

关键发现：
- `status: "drafting"`，`generationState.consecutiveFailures: 1`，`generationState.totalFailures: 1`
- `taskIds: []`，没有生成任何任务
- `lastError: "Planner returned empty task definition: Missing required planning context to generate next task: planId or plan context, current step/task state, objective, constraints, and expected output format."`

**疑问 1**：错误信息 "Missing required planning context..." 像是 LLM 的回复内容，而非系统错误。Planner 为什么返回这种内容而不是 JSON？

### 3.2 代码链路梳理

追踪代码链路确定执行路径：

```
createPlanFromPrompt (autoGenerate=true)
  → startGeneration
    → isStepDispatcherEnabled() → 根据 env ORCH_STEP_DISPATCHER_ENABLED 决定路径
      ├── true  → stepDispatcher.advanceOnce (四阶段调度器)
      └── false → incrementalPlanningService.executeIncrementalPlanning (递归执行)
```

**疑问 2**：走了哪条路径？`.env` 中 `ORCH_STEP_DISPATCHER_ENABLED=true`，所以走 step-dispatcher 路径。

> 但初期误判为走了 incremental-planning 路径（因为从 `.env` 中搜索该变量时未及时发现），导致部分修改方向偏差。后续通过 `generationState.plannerSessionId` 字段确认走的确实是 step-dispatcher 路径。

### 3.3 Step-Dispatcher 四阶段流程

```
advanceOnce
  → ensurePlannerSession（创建/获取 planner session）
  → phaseGenerate
    → buildPlannerContext（构建上下文：已完成任务、失败任务、planGoal...）
    → plannerService.generateNextTask（调用 Planner Agent 生成下一步任务）
      → agentClientService.executeTask（HTTP 调用 agents app）
    → 创建任务 → 状态跃迁到 pre_execute
  → phasePreExecute → phaseExecute → phasePostExecute
    → plannerService.executePostTask（决定下一步动作: generate_next / stop / redesign / retry）
```

**疑问 3**：`generateNextTask` 调用了 Agent，Agent 返回了什么？

### 3.4 日志分析 — 揭示核心问题

查看 `/tmp/harbin-logs/legacy-app.log`，定位到 `[planner_raw_response]` 日志：

#### 第一次调用（新计划 `69c75f6b`）

```
[planner_raw_response] planId=69c75f6b step=0 responseLen=1366
preview={"taskType":"general","runtimeTaskType":"general","title":"Incremental planning: generate next task","objective":"...","actions":[...]}
```

**发现 A**：Agent 返回了一个 JSON，但格式不对——`title`/`description` 直接在根级别，没有 `task` 嵌套层。`resolvePlannerTaskCandidate` 只检查 `parsed.task` 和 `parsed.nextTask`，所以判定为"空任务"。

#### 第二次调用（同一计划重试）

```
[planner_raw_response] planId=69c75f6b step=0 responseLen=937
preview="已收到并应用更新。我会在后续涉及 Orchestration 的任务中，严格按你提供的 runtimeTaskType 选择与迁移方法论执行..."
[planner_parse_fail] ...
```

**发现 B**：Agent 返回了**自然语言**，不是 JSON！内容是在"确认接收" skill 方法论。

#### 第三次调用（同一计划重试）

```
[planner_raw_response] planId=69c75f6b step=0 responseLen=616
preview="已收到并确认更新。我将按你给出的 orchestration-runtime-tasktype-selection 方法论执行..."
[planner_parse_fail] ...
```

**发现 C**：同样是自然语言确认，连续三次失败达到 `maxRetries=3`，计划被标记为 `draft`（失败）。

**疑问 4**：为什么 Agent 会输出方法论确认而不是 JSON？

### 3.5 Session 污染机制分析

三次调用日志中 sessionId 完全相同：`plan-{planId}-{agentId}`。

追踪 session 创建链路：

```
agentClientService.executeTask → HTTP POST /api/agents/:id/execute
  → agents app controller → agentService.executeTaskDetailed
    → agentExecutorService.executeTaskDetailed
      → prepareExecution → startRuntimeExecution
        → runtimeOrchestrator.startRun
          → metadata.planId 存在时：
            persistence.getOrCreatePlanSession(planId, agentId, title, ...)
              → sessionId = `plan-${planId}-${agentId}` （固定值！）
```

**根因确认**：`collaborationContext.planId` 导致 runtime 创建了一个**固定的 plan session**。三次重试共享同一 session，导致：

1. **第一次**：session 初始化时注入了 skill 方法论（`task.type === 'planning'` 触发 `ContextStrategyService` 强制激活含 `planning/orchestration/guard/planner` 标签的技能）。Agent 在处理大量 system 消息后返回了一个格式不完全匹配的 JSON。
2. **第二次**：在已有 session 中（包含第一次的方法论确认作为 assistant 消息），Agent 将新的 planning prompt 理解为方法论更新，输出了自然语言确认。
3. **第三次**：同上，session 历史进一步恶化。

### 3.6 补充验证 — 独立调用可以成功

直接调用 Agent execute API（无 session 历史）：

```bash
POST /api/agents/698a0bd7db9f7e6b8cca4171/execute
Body: { task: { type: "planning", description: "..." }, context: { collaborationContext: { planId: "test123", format: "json" } } }
```

返回了有效的 JSON（responseLength=281），包含 `task.title` 和 `task.description`。**说明 Agent 本身能力正常，问题在于 session 上下文污染。**

### 3.7 Post-Execute 阶段过早 Stop

对于能通过首步的计划（如 `69c76068`），另一个问题浮现：

```
[agents_execute_response] title="post-execution decision" responseLength=2
```

`executePostTask` 收到 2 bytes 响应（空字符串或 `{}`），`tryParseJson` 返回 null，默认返回 `{ nextAction: 'stop' }`——计划在执行完第一个任务后就被标记为"完成"了。

**根因**：post-execution decision 在 planner session 中调用，此时 session 历史已经很长（含方法论 + 多轮 planning 对话），LLM 在有限 token 预算内只返回了极短的响应。

## 4. 问题层级总结

| 层级 | 问题 | 代码位置 | 影响 |
|------|------|----------|------|
| L1: Skill 方法论注入干扰 | `task.type === 'planning'` 触发大量 skill 方法论注入到 session，Agent 首轮回复"确认接收"而非执行任务 | `context-strategy.service.ts:29-34`、`toolset-context.builder.ts:42-58` | Agent 首次调用返回非 JSON |
| L2: Session 固定复用 | `plan-{planId}-{agentId}` 固定 sessionId 导致重试时累积历史消息 | `runtime-persistence.service.ts:331-333` | 重试次次失败，方法论确认不断累积 |
| L3: JSON 格式不兼容 | Agent 有时返回扁平 JSON（根级别 title/description），不被 `resolvePlannerTaskCandidate` 识别 | `planner.service.ts:resolvePlannerTaskCandidate` | 有效内容被判定为空任务 |
| L4: Post-execute 默认 Stop | `executePostTask` parse 失败时默认 `stop`，增量规划过早终止 | `planner.service.ts:executePostTask` | 计划只执行一步就完成 |
| L5: 异常中断递归 | `executePlanningStep` 无 try-catch，agent 调用异常导致整个递归链静默终止 | `incremental-planning.service.ts:executePlanningStep` | 计划停在 drafting 不再推进 |

## 5. 已实施修复

### 5.1 `incremental-planning.service.ts` — 异常保护（保留）

在 `executePlanningStep` 中为 `buildPlannerContext`、`generateNextTask`、`createTaskFromPlannerOutput` 添加 try-catch，异常时递增 failure 计数器并继续递归，不再中断。

### 5.2 `planner.service.ts` — `resolvePlannerTaskCandidate` fallback（保留）

当 `parsed.task` 和 `parsed.nextTask` 均不存在时，检查根对象是否直接含 `title` + `description`，有则视为有效 task candidate。

### 5.3 未修复的核心问题（需后续方案）

- **Session 污染**：需要从 prompt 注入策略层面解决，而非绕过 session 机制
- **Post-execute 默认 Stop**：需要从 planner prompt 质量层面确保稳定的 JSON 输出，而非改默认值
- **Skill 方法论干扰**：需要确定 planning 场景下应注入哪些 skill、如何避免 Agent 输出确认性文本

## 6. 关键文件索引

| 文件 | 职责 |
|------|------|
| `backend/src/modules/orchestration/planner.service.ts` | Planner 核心：`generateNextTask` / `executePreTask` / `executePostTask` / prompt 构建 |
| `backend/src/modules/orchestration/services/incremental-planning.service.ts` | 增量规划递归引擎 |
| `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts` | 四阶段调度器 |
| `backend/src/modules/orchestration/services/orchestration-context.service.ts` | Pre/Post task context prompt 构建 |
| `backend/apps/agents/src/modules/agents/context/context-strategy.service.ts` | Skill 激活策略（planning 类型强制激活） |
| `backend/apps/agents/src/modules/agents/context/toolset-context.builder.ts` | Skill 方法论注入 |
| `backend/apps/agents/src/modules/agents/context/collaboration-context.builder.ts` | JSON-ONLY MODE 注入 |
| `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts` | Session ID 生成（`plan-{planId}-{agentId}`） |
| `backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts` | Runtime 执行入口、session 创建决策 |

## 7. 后续

- 需要制定专项计划：通过反复测试不同 agent prompt 注入策略，确保在编排规划过程中 Planner Agent 能稳定输出符合 schema 的 JSON
- 见 `docs/plan/ORCHESTRATION_PLANNER_STABLE_JSON_OUTPUT.md`

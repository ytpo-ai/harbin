# [已弃用] ORCHESTRATION_INCREMENTAL_PLANNING_FAILOVER_FIX_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Orchestration 增量编排失败重试与系统守护机制修复方案

## 背景

在 [Test-2] Agency-Agents Prompt 全量导入计划执行中，系统层面的多个架构缺陷导致 Planner 的错误决策未被拦截、失败任务无法有效恢复、熔断机制被绕过。

### 现象

1. **`executorSelectionService` 从未被触发**：13 个任务中，Planner 每次都给出了数据库中存在的有效 agentId（小武或自己），因此 `createTaskFromPlannerOutput()`（`incremental-planning.service.ts:323-330`）始终走"planner 直接指定"分支，系统精心设计的多维度工具匹配评分逻辑从未执行。

2. **失败后只能创建新任务，无法重新设计失败任务**：`executePlanningStep()` 在任务失败时（line 240-272）只将 error 存入 `lastError` 并递增 `consecutiveFailures`，然后进入下一轮循环生成**全新任务**。系统没有"原地修改失败任务的 agent 分配并重新执行"的机制。

3. **`consecutiveFailures` 被"虚假完成"重置**：Task 0（general，虚假完成）→ `consecutiveFailures = 0`，Task 1（development，虚假完成）→ `consecutiveFailures = 0`。中间穿插的假完成让熔断计数器反复清零，`maxRetries=3` 的硬限制无法有效生效。

4. **无 agent-task 工具适配性二次校验**：Planner 选出 agent 后，系统直接创建任务并执行，不检查该 agent 是否实际具备任务所需工具。

### 根因分析

```
Planner 输出 agentId
       ↓
createTaskFromPlannerOutput()
       ↓ resolveValidAgentId(): 只检查 agentId 是否存在于 DB
       ↓ ✓ 存在 → 直接使用，executorSelectionService 被跳过
       ↓
executeTaskNode() → agent 执行
       ↓ general/development 类型无 inability 校验
       ↓ → 标记 completed（虚假完成）
       ↓ → consecutiveFailures 被重置
       ↓
下一轮 Planner 规划：基于错误前提继续
```

关键缺陷点：
- **`resolveValidAgentId`** 只做存在性校验，不做能力/工具匹配校验
- **缺少 `totalFailures` 计数器**，只有 `consecutiveFailures` 且会被 completed 重置
- **失败任务只能"报废"**，无法被重新设计和重试

## 核心目标

1. 在 Planner 选择 agent 后，系统增加工具适配性二次校验，拒绝明显不匹配的分配
2. 支持失败任务原地重新设计（更换 agent）并重新执行，而非只能追加新任务
3. 增加 `totalFailures` 计数器作为 `consecutiveFailures` 的补充熔断条件
4. 确保 executorSelectionService 在工具不匹配时被触发为 fallback

## 影响范围

| 层级 | 影响 |
|------|------|
| **Incremental Planning Service** | `incremental-planning.service.ts` — 核心改动：二次校验、失败重设计、熔断逻辑 |
| **Executor Selection Service** | `executor-selection.service.ts` — 新增 `validateAgentToolFit()` 方法 |
| **Planning Context Service** | `planning-context.service.ts` — 无改动 |
| **Schema** | `orchestration-plan.schema.ts` — `generationState` 新增 `totalFailures` 字段 |
| **Planner Service** | `planner.service.ts` — 支持生成"重新设计"类型输出 |
| **前端** | 无影响 |

## 执行步骤

### Step 1: 新增 Agent-Task 工具适配性校验

**关键影响点**: 后端 — `executor-selection.service.ts` + `incremental-planning.service.ts`

在 `ExecutorSelectionService` 中新增方法：

```typescript
async validateAgentToolFit(
  agentId: string,
  taskTitle: string,
  taskDescription: string,
  taskType?: string,
): Promise<{ fit: boolean; missingTools?: string[]; suggestion?: ExecutorSelectionResult }> {
  // 1. 加载 agent 的工具列表
  // 2. 根据 taskType 和 TASK_TOOL_HINTS 推断所需工具
  // 3. 计算覆盖率
  // 4. 如果覆盖率不足，调用 routeExecutor() 返回更优候选
}
```

在 `createTaskFromPlannerOutput()` 中，即使 Planner 给出了有效 agentId，也调用此方法做二次校验：

```typescript
const validAgentId = await this.resolveValidAgentId(normalizedAgentId);
if (validAgentId) {
  // 新增：二次校验工具适配性
  const fitCheck = await this.executorSelectionService.validateAgentToolFit(
    validAgentId,
    taskResult.title,
    taskResult.description,
    taskResult.taskType,
  );
  if (!fitCheck.fit) {
    // 工具不匹配，使用 executorSelectionService 重新路由
    this.logger.warn(
      `[planner_override] Planner assigned agent=${validAgentId} but missing tools: ${fitCheck.missingTools?.join(',')}`
    );
    const fallbackAssignment = fitCheck.suggestion || await this.executorSelectionService.selectExecutor({...});
    // 使用 fallbackAssignment 替代 planner 的选择
  }
}
```

### Step 2: 支持失败任务原地重新设计

**关键影响点**: 后端 — `incremental-planning.service.ts` + `planner.service.ts`

#### 2a. Planner 输出 schema 扩展

在 `GenerateNextTaskResult` 中支持新的输出模式：

```json
{
  "action": "redesign",
  "redesignTaskId": "<失败任务的 taskId>",
  "task": {
    "title": "...",
    "description": "...",
    "agentId": "...",
    "taskType": "..."
  },
  "reasoning": "原任务因 agent 缺少 X 工具而失败，改为分配给具备 X 工具的 Y agent"
}
```

当 `action === 'redesign'` 时，系统不创建新任务，而是更新原任务的 assignment 和 description 后重新执行。

#### 2b. Planner Prompt 新增 redesign 指令

在 `buildIncrementalPlannerPrompt` 的输出规则中追加：

```
9) 当失败任务的根因是"agent 缺少工具"或"分配不当"时，
   优先使用 redesign 模式——指定 redesignTaskId 并更换 agentId，
   而非创建全新任务。这能避免任务清单膨胀。
```

#### 2c. `executePlanningStep()` 处理 redesign 分支

```typescript
if (nextTaskResult.action === 'redesign' && nextTaskResult.redesignTaskId) {
  const redesignedTask = await this.redesignFailedTask(
    nextTaskResult.redesignTaskId,
    nextTaskResult.task,
  );
  const executionResult = await this.executionEngine.executeTaskNode(planId, redesignedTask);
  // ... 处理结果
}
```

新增 `redesignFailedTask()` 方法：
- 检查目标任务状态必须为 `failed`
- 更新 assignment（新 agentId）、description、status（重置为 `assigned`）
- 清空 result、resetstartedAt/completedAt
- 追加 runLog 记录 redesign 操作

### Step 3: 增加 `totalFailures` 熔断计数器

**关键影响点**: 后端 — Schema + `incremental-planning.service.ts`

#### 3a. Schema 扩展

在 `OrchestrationPlan.generationState` 中新增：

```typescript
totalFailures: { type: Number, default: 0 }  // 累计失败次数，不被 completed 重置
```

在 `OrchestrationPlan.generationConfig` 中新增：

```typescript
maxTotalFailures: { type: Number, default: 6 }  // 总失败次数上限
```

#### 3b. 执行逻辑调整

在 `executePlanningStep()` 中：

- 任务失败时：`totalFailures += 1`（新增，独立于 `consecutiveFailures`）
- 任务成功时：`consecutiveFailures = 0`（保持现有），**不重置 `totalFailures`**
- 熔断判定改为双条件：
  ```typescript
  if (consecutiveFailures >= config.maxRetries || totalFailures >= config.maxTotalFailures) {
    await this.failPlanning(planId, ...);
    return { done: true };
  }
  ```

这确保即使中间穿插"虚假完成"的任务，总失败次数超过阈值（默认 6）后仍会触发熔断。

### Step 4: 在失败上下文中增加 agent 工具信息

**关键影响点**: 后端 — `incremental-planning.service.ts` + `planning-context.service.ts`

在构建 Planner 上下文时，为失败任务补充执行 agent 的工具信息：

```typescript
const failedTasks = tasks
  .filter((item) => item.status === 'failed')
  .map((item) => {
    const agentId = item.assignment?.executorId;
    const agentTools = agentId ? agentToolMap.get(agentId) : [];
    return {
      title: item.title,
      agentId,
      agentTools: agentTools?.join(', ') || 'unknown',
      error: String(item.result?.error || 'Unknown error'),
    };
  });
```

在 prompt 中的展示格式：
```
- [title] (agent=xxx, tools=[A,B,C]): error
```

这让 Planner 能直观看到失败 agent 的工具缺口，做出更准确的重分配决策。

### Step 5: executorSelectionService 强制介入模式

**关键影响点**: 后端 — `incremental-planning.service.ts`

新增配置项 `PLANNER_AGENT_SELECTION_MODE`，取值：

| 值 | 行为 |
|---|---|
| `trust`（默认） | 信任 Planner 的选择，仅做存在性校验（当前行为） |
| `verify` | 信任但验证——Planner 选择后做工具适配性二次校验，不匹配时 fallback |
| `override` | 忽略 Planner 选择，始终由 executorSelectionService 路由 |

推荐初始值设为 `verify`，兼顾 Planner 自主性和系统守护。

## 风险与应对

| 风险 | 应对措施 |
|------|---------|
| 二次校验的工具推断不准确（TASK_TOOL_HINTS 覆盖不全） | 初期仅对有明确 `requiredTools` 的场景启用硬拦截；推断场景仅 warn |
| redesign 模式增加 Planner 输出 schema 复杂度 | 保持向后兼容——无 `action` 字段时默认 `action='new'`（现有行为） |
| `totalFailures` 阈值过低导致合理重试被截断 | 默认 6（是 maxRetries 的 2 倍），可通过 generationConfig 调整 |
| `override` 模式下 Planner 的 agent 选择完全失效 | 仅作为调试/特殊场景使用，默认不启用 |
| redesignFailedTask 的并发安全 | 使用 MongoDB findOneAndUpdate 保证原子更新 |

## 依赖关系

- 关联方案：`ORCHESTRATION_PLANNER_AGENT_SELECTION_FIX_PLAN.md`（Planner prompt 层面修复）
- 关联方案：`ORCHESTRATION_TASK_OUTPUT_VALIDATION_FIX_PLAN.md`（任务输出校验修复）
- 前置完成：`ORCHESTRATION_INCREMENTAL_PLANNING_REFACTOR_PLAN.md`（已完成 ✅）
- 前置完成：`ORCHESTRATION_PLANNER_JSON_CONFORMANCE_PLAN.md`（已完成 ✅）

## 三方案协作关系

```
┌────────────────────────────────────────────────────────────────────┐
│                     任务执行全链路守护                               │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  1. Planner 决策层 (PLANNER_AGENT_SELECTION_FIX)                   │
│     ├─ 强化工具匹配规则（禁令式约束）                                │
│     ├─ 失败 agent 回避规则                                         │
│     ├─ 虚假完成识别提示                                             │
│     └─ 失败纠偏必须更换 agent/taskType                              │
│                          ↓                                         │
│  2. 系统守护层 (INCREMENTAL_PLANNING_FAILOVER_FIX) ← 本方案         │
│     ├─ Agent-Task 工具适配性二次校验                                 │
│     ├─ 失败任务原地 redesign（而非追加新任务）                        │
│     ├─ totalFailures 累计熔断（不被假完成重置）                      │
│     └─ executorSelectionService 强制介入模式                         │
│                          ↓                                         │
│  3. 输出校验层 (TASK_OUTPUT_VALIDATION_FIX)                         │
│     ├─ 通用 inability 信号检测（所有 taskType）                      │
│     ├─ development 类型校验升级                                      │
│     └─ Agent 侧 TASK_INABILITY 格式化输出规范                        │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

三层联动：
- 第 1 层（Planner）减少错误决策的发生概率
- 第 2 层（系统守护）拦截 Planner 的错误决策并自动纠正
- 第 3 层（输出校验）识别 Agent 的无效输出防止虚假完成
```

# ORCHESTRATION EVENT-DRIVEN PLANNER CONTROL PLAN

> 版本：v4（双通道触发：内部直调 + 外部事件驱动）
> 状态：已完成（开发与验证收口）
> 修订日期：2026-03-27

## 1. 背景与当前问题

- 当前增量编排在 `IncrementalPlanningService.executeIncrementalPlanning()` 中使用 `for (;;)` 持续推进。
- 每轮 `executePlanningStep()` 会执行"任务生成 + 任务执行"，生成与执行强耦合。
- 该模式不利于在任务执行前后插入稳定的 Planner 干预步骤。
- Planner 当前是无状态单次调用（不带 sessionId，不保留对话历史），历史上下文靠 prompt-stuffing，token 成本随任务数线性增长。
- 项目无进程内事件总线（无 `@nestjs/event-emitter`），`PlanEventStreamService` 仅推前端 SSE。
- `generationState` 是严格 schema（`@Prop(raw({...}))`），不允许自由扩展字段。

## 2. 目标与范围

### 2.1 目标

将当前"代码循环驱动"改为"双通道触发 + Planner 决策驱动"，并把单步编排拆成固定四阶段：

1. **阶段 A**：任务生成（Generate Template Task）
2. **阶段 B**：执行前 Planner Agent Task（Pre-Task）
3. **阶段 C**：任务执行 Agent Task（Executor Task）
4. **阶段 D**：执行后 Planner Agent Task（Post-Task）

Planner 在整个 plan 生命周期内维持**有状态 session**，A/B/D 三个阶段的 Planner 调用共享同一个 session，天然积累完整的编排上下文。

### 2.2 双通道触发模型

系统支持两种并行的触发方式，汇入同一个 `advanceOnce` 入口：

```
                  ┌──────────────────────────────┐
                  │    OrchestrationStepDispatcher │
                  │         advanceOnce(planId)    │
                  └──────────┬───────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
   ┌──────────▼──────────┐     ┌────────────▼────────────┐
   │   内部直调（默认）     │     │   外部事件触发            │
   │                      │     │                         │
   │ • 阶段间自动衔接      │     │ • @nestjs/event-emitter │
   │ • startGeneration    │     │ • @OnEvent 装饰器订阅     │
   │ • D→A 自动推进       │     │ • 外部 API/服务发事件      │
   │ • generateNext       │     │ • 外部系统触发推进         │
   └─────────────────────┘     └──────────────────────────┘
```

- **内部直调**：编排模块内部阶段间自动衔接，D 阶段决策 `generate_next` 时直接触发下一轮。
- **外部事件触发**：引入 `@nestjs/event-emitter`，外部系统/API 通过发布事件请求推进某个 plan 的某个阶段。

两个通道**汇入同一个 `advanceOnce` 方法**，由 MongoDB 条件更新保证幂等——无论谁先到，只有一个能推进成功。

### 2.3 关键原则

- 不再通过服务内持续循环控制全流程。
- 任务是否继续生成下一轮，由 Planner 在 Post-Task 阶段决策。
- 内部直调与外部事件并存，共享幂等层，不冲突。
- Planner 采用**有状态 session 调用模式**。
- 每个阶段必须可观测、可重试、可幂等。

### 2.4 范围

- 后端编排模块（orchestration）
- 引入 `@nestjs/event-emitter` 进程内事件总线
- Planner session 生命周期管理
- Planner 交互协议（输入/输出）
- SSE 事件扩展（复用现有 `planning.*` 前缀）
- 相关测试与文档

不包含：前端 UI 重构、跨服务消息总线平台替换。

### 2.5 关键决策记录

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 阶段推进机制 | **双通道**：内部直调 + `@nestjs/event-emitter` 事件 | 内部链路简单直接；外部触发开放扩展能力；两者共享幂等层不冲突 |
| 事件总线选型 | `@nestjs/event-emitter`（基于 `eventemitter2`） | NestJS 官方方案；零依赖冲突；`@OnEvent` 装饰器天然适配 DI 体系；支持通配符和异步监听 |
| Planner 调用模式 | **有状态 session**（plan-scope） | 复用已有 `getOrCreatePlanSession` + `executeTask` with sessionId；天然积累上下文，减少 prompt-stuffing 的 token 膨胀 |
| Planner session 粒度 | 一个 plan + 一个 planner agent = 一个 session | 复用现有 session 格式 `plan-{planId}-{plannerAgentId}`；A/B/D 阶段共享；C 阶段用 executor 自己的 session（已有逻辑不变） |
| 幂等机制 | MongoDB 条件更新 + `activePlannings` 内存锁 | 两个触发通道共享同一幂等层；条件更新 `{ currentPhase: expectedPhase }` 保证只有一个推进成功 |
| SSE 事件命名 | 复用 `planning.*` 前缀，增量新增 2 个事件 | 避免与前端已监听事件冲突 |
| generationState 扩展 | `currentPhase`/`lastDecision`/`plannerSessionId` 加入 schema；`phaseTimestamps` 写 metadata | 平衡类型安全与灵活性 |

## 3. 当前链路（As-Is）定位

### 3.1 入口与自动生成触发

| 节点 | 代码位置 |
|------|----------|
| API 入口 | `orchestration.controller.ts:106` — `POST /orchestration/plans/from-prompt` |
| 自动触发判断 | `plan-management.service.ts:122` — `if (dto.autoGenerate \|\| dto.autoRun)` |
| 异步启动 | `plan-management.service.ts:287` — `setTimeout(() => executeIncrementalPlanning(), 0)` |

### 3.2 循环推进

| 节点 | 代码位置 |
|------|----------|
| 主循环 | `incremental-planning.service.ts:94` — `for (;;) { executePlanningStep() }` |
| 并发锁 | `incremental-planning.service.ts:52,80` — `activePlannings` Set |

### 3.3 单步行为（`executePlanningStep`）

| 步骤 | 代码位置 | 说明 |
|------|----------|------|
| 调 Planner 生成 | `incremental-planning.service.ts:177` | `plannerService.generateNextTask()` |
| 创建任务 | `incremental-planning.service.ts:219` | `createTaskFromPlannerOutput()` |
| 执行任务 | `incremental-planning.service.ts:236` | `executeIncrementalTaskWithRunRecord()` |
| 终止判断 | `incremental-planning.service.ts:159,162,166,180,302` | isComplete/maxTasks/maxCost/goalReached/failures |

### 3.4 Planner 现有能力

| 特性 | 现状 |
|------|------|
| 调用方式 | 无状态 HTTP 单次调用（`agentClientService.executeTask`） |
| Session | 不传 sessionId，不保留对话历史 |
| 历史上下文 | 通过 prompt-stuffing（completedTasks/failedTasks 摘要） |
| 输出格式 | 三层 JSON 约束（prompt 前缀 + prompt 尾部 + system message） |
| 解析容错 | 三级 JSON 容错（直接解析 / markdown fence / 首尾花括号提取） |
| 可复用方法 | `buildIncrementalPlannerPrompt()`、`tryParseJson()`、`renderPlannerPromptTemplate()` |

### 3.5 Session 基础设施现状

| 能力 | 状态 | 代码位置 |
|------|------|----------|
| `getOrCreatePlanSession` | 已有，upsert 模式 | `agent-client.service.ts:923` |
| `executeTask` with sessionId | 已有，通过 `sessionContext.sessionId` 传入 | `agent-client.service.ts:212` |
| `appendSessionMessage` | 已有 | `agent-client.service.ts:812` |
| `archiveSession` | 已有 | `agent-client.service.ts:834` |
| session 存储 | `agent_sessions` collection，upsert，无 TTL | `agent-session.schema.ts` |
| session 格式 | `plan-{planId}-{agentId}` | `runtime-persistence.service.ts:281` |
| 任务执行已用 session | executor 已通过 `getOrCreatePlanSession` 管理 session | `orchestration-execution-engine.service.ts:207` |
| **Planner 未用 session** | `generateNextTask` 不传 sessionId | `planner.service.ts:146` |

### 3.6 事件基础设施现状

| 检查项 | 结果 |
|--------|------|
| `@nestjs/event-emitter` | **未安装** |
| 进程内事件 | 2 处手写 Node.js EventEmitter（agents app 内部，不可复用） |
| rxjs Subject | `PlanEventStreamService` 仅用于 SSE 推前端，无后端内部订阅 |
| Redis Pub/Sub | `RedisService` 已有完善封装，但适合跨进程，不适合进程内轻量事件 |

## 4. 目标链路（To-Be）设计

### 4.1 事件总线引入

引入 `@nestjs/event-emitter` 作为进程内事件总线：

```typescript
// app.module.ts 或 orchestration.module.ts
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    EventEmitterModule.forRoot({
      wildcard: true,        // 支持通配符订阅如 orchestration.*
      delimiter: '.',
      maxListeners: 20,
    }),
    // ...
  ],
})
```

#### 事件定义

```typescript
// orchestration-events.ts（新增）
export const ORCH_EVENTS = {
  // 阶段推进请求（外部触发入口）
  ADVANCE_REQUESTED: 'orchestration.advance.requested',

  // 阶段完成通知（内部发布，外部可订阅）
  TASK_GENERATED: 'orchestration.task.generated',
  TASK_PRE_EXECUTED: 'orchestration.task.pre_executed',
  TASK_EXECUTED: 'orchestration.task.executed',
  TASK_POST_PROCESSED: 'orchestration.task.post_processed',

  // 终态通知
  PLAN_COMPLETED: 'orchestration.plan.completed',
  PLAN_FAILED: 'orchestration.plan.failed',
} as const;

export interface OrchestrationAdvanceEvent {
  planId: string;
  source: 'internal' | 'api' | 'scheduler' | 'external';
  targetPhase?: string;   // 可选：指定推进到哪个阶段（不指定则按状态机自动推进）
  metadata?: Record<string, unknown>;
}

export interface OrchestrationPhaseEvent {
  planId: string;
  taskId: string;
  step: number;
  phase: string;
  result: Record<string, unknown>;
}
```

#### 双通道触发流程

```
内部直调路径（默认）:
  D 阶段 nextAction=generate_next
    → dispatcher.advanceOnce(planId)    ← 直接方法调用

外部事件路径:
  外部 API / Scheduler / 其他模块
    → eventEmitter.emit('orchestration.advance.requested', { planId, source: 'api' })
    → @OnEvent('orchestration.advance.requested') handler
    → dispatcher.advanceOnce(planId)    ← 同一个入口

两条路径汇入同一个 advanceOnce，幂等层统一:
  advanceOnce(planId):
    MongoDB findOneAndUpdate({ currentPhase: expectedPhase })
    → 条件匹配：推进成功
    → 条件不匹配：静默跳过（已被另一个通道推进）
```

#### 外部触发 API

```typescript
// orchestration.controller.ts 新增端点
@Post('plans/:id/advance')
async advancePlan(
  @Param('id') planId: string,
  @Body() dto?: { targetPhase?: string; metadata?: Record<string, unknown> },
) {
  this.eventEmitter.emit(ORCH_EVENTS.ADVANCE_REQUESTED, {
    planId,
    source: 'api',
    targetPhase: dto?.targetPhase,
    metadata: dto?.metadata,
  });
  return { accepted: true };
}
```

#### 事件订阅器

```typescript
// orchestration-event-listener.service.ts（新增）
@Injectable()
export class OrchestrationEventListenerService {
  constructor(private readonly dispatcher: OrchestrationStepDispatcherService) {}

  @OnEvent(ORCH_EVENTS.ADVANCE_REQUESTED, { async: true })
  async handleAdvanceRequested(event: OrchestrationAdvanceEvent): Promise<void> {
    await this.dispatcher.advanceOnce(event.planId, {
      source: event.source,
      targetPhase: event.targetPhase,
    });
  }
}
```

#### 阶段完成后的事件发布（供外部订阅）

```typescript
// dispatcher 每个阶段完成后，同时做两件事：
// 1. 发 SSE 推前端（已有 emitPlanStreamEvent）
// 2. 发进程内事件供其他模块订阅
this.eventEmitter.emit(ORCH_EVENTS.TASK_GENERATED, {
  planId, taskId, step, phase: 'generated', result: { ... },
});
```

### 4.2 Planner Session 模型

```
Plan 创建
  └─ 首次 advanceOnce(planId)
       └─ 阶段 A: getOrCreatePlanSession(planId, plannerAgentId, ...)
            └─ 创建 session: plan-{planId}-{plannerAgentId}
            └─ 记录 plannerSessionId 到 generationState

后续所有 A/B/D 阶段:
  └─ 复用同一个 plannerSessionId
  └─ 每次调用 executeTask 时传入 sessionId
  └─ planner agent 自动拥有完整历史上下文

Plan 完成/失败:
  └─ archiveSession(plannerSessionId)
```

**Session 粒度**：
- Planner session：`plan-{planId}-{plannerAgentId}` — A/B/D 阶段共享
- Executor session：`plan-{planId}-{executorAgentId}` — C 阶段使用（现有逻辑不变）
- 两个 session 独立，互不干扰

**Session 内对话流**（示例，一轮完整 A→B→C→D）：

```
[Planner Session]
  user: "生成下一个任务"（A 阶段 prompt）        → assistant: { task: {...}, ... }
  user: "准备执行任务 X"（B 阶段 prompt）         → assistant: { allowExecute: true, ... }
  ── C 阶段由 executor session 独立执行 ──
  user: "任务 X 执行完成，结果..."（D 阶段 prompt） → assistant: { nextAction: "generate_next", ... }
  user: "生成下一个任务"（下一轮 A 阶段 prompt）    → assistant: { task: {...}, ... }
  ...
```

### 4.3 总体推进模型

采用 **`OrchestrationStepDispatcher`** 服务统一调度四阶段：

```
触发源（内部直调 或 @OnEvent）
  └─ dispatcher.advanceOnce(planId, options?)
       ├─ 读取 generationState.currentPhase
       ├─ 确保 plannerSessionId 存在（首次创建，后续复用）
       ├─ 按 phase 分发到对应阶段方法
       ├─ MongoDB 条件更新写入下一 phase（幂等保证）
       ├─ 发布阶段完成事件（SSE + 进程内 EventEmitter）
       └─ 如果下一 phase 不是终态：
            ├─ 内部模式：setImmediate(() => advanceOnce(planId))
            └─ D 阶段特殊处理：根据 nextAction 决定是否继续
```

与旧方案差异：
- **不再用 `for(;;)` 循环**：改为 D 阶段决策后"请求下一次推进"。
- **Planner 有状态**：A/B/D 共享 session，不再每次 prompt-stuffing 全量历史。
- **双通道触发**：内部直调（自动衔接） + 外部事件（`@OnEvent` 订阅）。
- **每次推进原子化**：一个阶段一次条件更新，失败可精确重试。

### 4.4 四阶段定义

#### 阶段 A：任务生成

- 输入：plan 上下文、planner context。
- 动作：调用 `plannerService.generateNextTask()`，**传入 plannerSessionId**，创建模板任务。
- Prompt：可大幅精简——session 已有历史上下文，无需重复 stuffing 已完成/失败任务摘要。仅需传入新增变化量。
- 输出：`generatedTaskId`、`runtimeTaskType`、基础 assignment。
- 完成后：写入 `currentPhase = 'pre_execute'` + 发布 `TASK_GENERATED` 事件，推进到 B。
- 失败策略：记录失败，按现有 consecutiveFailures 机制重试或终止。
- SSE 事件：`planning.task.generated`（复用现有）。

#### 阶段 B：执行前 Planner Task

- 输入：阶段 A 的任务信息 + 当前计划上下文。
- 动作：调用 Planner agent task，**传入 plannerSessionId**（同一 session 内多轮对话）。
- Prompt：新增 `buildPreExecutionPlannerPrompt()`，内容精简（session 已有历史）。
- 输出：`PreExecutionDecision`（结构化 JSON）。
- 完成后：写入 `currentPhase = 'executing'` + 发布 `TASK_PRE_EXECUTED` 事件，推进到 C。
- 失败策略：**默认阻断 C 阶段**，任务标记为 failed，记录原因。
- SSE 事件：`planning.task.pre_executed`（**新增**）。

#### 阶段 C：执行 Agent Task

- 输入：任务模板 + B 阶段输出的 executionHints。
- 动作：调用 `OrchestrationExecutionEngineService.executeTaskNode()` 执行。
- **使用 executor 自己的 session**（现有逻辑不变）。
- 输出：执行结果（status/result/error、run 日志）。
- 完成后：写入 `currentPhase = 'post_execute'` + 发布 `TASK_EXECUTED` 事件，推进到 D。
- 失败策略：保持当前执行失败语义，**无论成功失败都进入 D 阶段**供 Planner 决策。
- SSE 事件：`planning.task.executing`（复用）→ `planning.task.completed` / `planning.task.failed`（复用）。

#### 阶段 D：执行后 Planner Task

- 输入：C 阶段执行结果 + 日志。
- 动作：调用 Planner agent task，**传入 plannerSessionId**（session 已有 A/B 阶段上下文）。
- Prompt：新增 `buildPostExecutionPlannerPrompt()`，内容仅需传入当前执行结果。
- 输出：`PostExecutionDecision`（结构化 JSON）。
- 完成后：根据 `nextAction` 决定下一步 + 发布 `TASK_POST_PROCESSED` 事件。
- 失败策略：**不回滚已完成执行结果**，记录 post 失败，`nextAction` 默认回退为 `stop`。
- SSE 事件：`planning.task.post_processed`（**新增**）。

### 4.5 决策收敛规则

只有 D 阶段的 `nextAction` 可以驱动下一轮：

| nextAction | 行为 | 对应推进 |
|------------|------|----------|
| `generate_next` | 触发下一轮 A 阶段 | `setImmediate(() => dispatcher.advanceOnce(planId))` |
| `stop` | 归档 planner session + 计划进入 completed + 发布 `PLAN_COMPLETED` | `archiveSession` + `completePlanning` |
| `redesign` | 按既有重设计链路，对失败任务进入 A 阶段重新生成 | `dispatcher.advanceOnce(planId)` with redesign context |
| `retry` | 对当前任务回到 B 阶段重新执行（带最大次数限制） | `dispatcher.retryCurrentTask(planId)` |

### 4.6 终止条件

保留现有终止条件，D 阶段决策只是新增了一个终止来源：

| 条件 | 来源 | 优先级 | 触发 session 归档 |
|------|------|--------|-------------------|
| `generationState.isComplete` | 状态标记 | 最高（跳过所有阶段） | 是 |
| `totalGenerated >= maxTasks` | 配置限制 | 高 | 是 |
| `totalCost > maxCostTokens` | 配置限制 | 高 | 是 |
| D 阶段 `nextAction === 'stop'` | Planner 决策 | 正常 | 是 |
| `consecutiveFailures >= maxRetries` | 失败兜底 | 兜底 | 是 |
| `totalFailures >= maxTotalFailures` | 失败兜底 | 兜底 | 是 |

所有终态都会归档 planner session + 发布 `PLAN_COMPLETED` / `PLAN_FAILED` 事件。

### 4.7 Session 生命周期管理

| 事件 | 动作 | 说明 |
|------|------|------|
| plan 首次 advanceOnce | `getOrCreatePlanSession(planId, plannerAgentId)` | 创建 planner session，记录 plannerSessionId 到 generationState |
| A/B/D 阶段每次调用 | `executeTask` with `sessionContext.sessionId = plannerSessionId` | 复用同一 session |
| plan 完成/失败 | `archiveSession(plannerSessionId)` | 归档 session，状态变为 archived |
| plan replan | `archiveSession` 旧 session + 重新 `getOrCreatePlanSession` | 新一轮编排用新 session |
| plan 删除 | 不主动删除 session（无 TTL，与现有行为一致） | session 保留供审计 |

## 5. SSE 事件设计

### 5.1 事件清单（复用 `planning.*` 前缀）

| 事件名 | 状态 | 阶段 | 说明 |
|--------|------|------|------|
| `planning.step.started` | 保留 | A 前 | 步骤开始 |
| `planning.task.generated` | 保留 | A 后 | 任务生成完成 |
| `planning.task.pre_executed` | **新增** | B 后 | 执行前 Planner 完成 |
| `planning.task.executing` | 保留 | C 中 | 任务开始执行 |
| `planning.task.completed` | 保留 | C 后 | 任务执行成功 |
| `planning.task.failed` | 保留 | C 后 | 任务执行失败 |
| `planning.task.post_processed` | **新增** | D 后 | 执行后 Planner 完成 |
| `planning.completed` | 保留 | 终态 | 编排完成 |
| `planning.failed` | 保留 | 终态 | 编排失败 |

### 5.2 SSE 事件与进程内事件的关系

每个阶段完成后**同时发两种事件**：

| SSE 事件（推前端） | 进程内事件（供后端模块订阅） |
|--------------------|----------------------------|
| `planning.task.generated` | `orchestration.task.generated` |
| `planning.task.pre_executed` | `orchestration.task.pre_executed` |
| `planning.task.completed/failed` | `orchestration.task.executed` |
| `planning.task.post_processed` | `orchestration.task.post_processed` |
| `planning.completed` | `orchestration.plan.completed` |
| `planning.failed` | `orchestration.plan.failed` |

SSE 事件面向前端展示，进程内事件面向后端模块扩展（如 Scheduler、Memo、审计等）。

### 5.3 新增 SSE 事件 Payload

```typescript
// planning.task.pre_executed
{
  planId: string;
  step: number;
  taskId: string;
  allowExecute: boolean;
  riskFlags?: string[];
}

// planning.task.post_processed
{
  planId: string;
  step: number;
  taskId: string;
  nextAction: 'generate_next' | 'stop' | 'redesign' | 'retry';
  reason: string;
}
```

## 6. 数据与协议改造

### 6.1 generationState schema 扩展

在 `OrchestrationGenerationState` 接口和 `@Prop(raw({...}))` 中新增：

```typescript
// 新增字段（加入 schema 定义）
currentPhase?: 'generating' | 'pre_execute' | 'executing' | 'post_execute' | 'idle';
lastDecision?: 'generate_next' | 'stop' | 'redesign' | 'retry';
plannerSessionId?: string;  // planner agent 的 session id
currentTaskId?: string;     // 当前正在处理的任务 id（跨阶段传递）
```

改动位置（3 处）：
1. `OrchestrationGenerationState` 接口 — `orchestration-plan.schema.ts:27-36`
2. `@Prop(raw({...}))` Mongoose 定义 — `orchestration-plan.schema.ts:105-115`
3. `resolveGenerationState` / `updateGenerationState` 调用 — `incremental-planning.service.ts`

### 6.2 任务扩展信息（写 metadata，不改 schema）

在任务或 run_task 的 `metadata`（已有 `Record<string, any>` Mixed 字段）中记录：

```typescript
metadata: {
  preExecutionDecision?: PreExecutionDecision;
  postExecutionDecision?: PostExecutionDecision;
  phaseTimestamps?: {
    generatedAt?: Date;
    preExecutedAt?: Date;
    executedAt?: Date;
    postProcessedAt?: Date;
  };
}
```

### 6.3 Planner 输出契约

#### Pre-Task 输出（`PreExecutionDecision`）

```typescript
interface PreExecutionDecision {
  allowExecute: boolean;          // 是否允许进入 C 阶段
  executionHints?: string[];      // 传递给执行者的补充提示
  riskFlags?: string[];           // 风险标记
  notes?: string;                 // Planner 备注
}
```

- 解析失败时默认 `{ allowExecute: true }`（降级放行，不阻断）。

#### Post-Task 输出（`PostExecutionDecision`）

```typescript
interface PostExecutionDecision {
  nextAction: 'generate_next' | 'stop' | 'redesign' | 'retry';
  reason: string;                 // 决策理由
  redesignTaskId?: string;        // redesign 时指定目标任务
  nextTaskHints?: string[];       // 传递给下一轮 A 阶段的提示
}
```

- 解析失败时默认 `{ nextAction: 'stop', reason: 'Failed to parse planner post-task response' }`（降级终止）。

#### A 阶段输出（复用 `GenerateNextTaskResult`，不变）

当前 `GenerateNextTaskResult` 接口保持不变，A 阶段仅改造调用方式（加 sessionId），输出格式兼容。

### 6.4 Planner Prompt 精简策略（session 带来的收益）

| 阶段 | 旧模式（prompt-stuffing） | 新模式（session 多轮） |
|------|--------------------------|----------------------|
| A（生成） | prompt 中拼入所有已完成/失败任务摘要 + agent 列表 + 完整指令 | 首次调用包含完整指令 + agent 列表；后续仅传入"上一轮执行结果摘要 + 继续生成指令" |
| B（执行前） | 不存在 | 仅传入当前任务详情 + 执行前决策指令（session 已有 A 阶段上下文） |
| D（执行后） | 不存在 | 仅传入当前执行结果 + 决策指令（session 已有 A/B 阶段上下文） |

预估 token 节约：随任务数增长，第 N 轮 A 阶段 prompt 从 O(N) 降为 O(1)（增量传入）。

## 7. 代码落点与修改清单

### 7.0 新增依赖

```bash
pnpm add @nestjs/event-emitter eventemitter2
```

### 7.1 新增文件

| 文件 | 职责 |
|------|------|
| `services/orchestration-step-dispatcher.service.ts` | 四阶段调度器：`advanceOnce()`、`retryCurrentTask()`；管理 plannerSessionId 获取与归档；按 `currentPhase` 分发到对应阶段方法 |
| `services/orchestration-event-listener.service.ts` | `@OnEvent` 订阅器：监听 `orchestration.advance.requested`，调用 dispatcher |
| `orchestration-events.ts` | 事件名常量 + 事件 payload 类型定义 |

### 7.2 核心服务改造

| 文件 | 改动 |
|------|------|
| `services/incremental-planning.service.ts` | 移除 `for(;;)` 循环；`executeIncrementalPlanning` 改为调用 `dispatcher.advanceOnce`；`executePlanningStep` 拆分为 `phaseGenerate` / `phaseExecute` 两个纯方法；`executeIncrementalTaskWithRunRecord` 保留但入口改由 dispatcher 调用 |
| `services/plan-management.service.ts` | `startGeneration` 改为 `setTimeout(() => dispatcher.advanceOnce(planId), 0)`；`generateNext` 同理 |
| `services/orchestration-execution-engine.service.ts` | 无核心改动；调用入口从 incremental-planning 迁移到 dispatcher，方法签名不变 |

### 7.3 Planner 相关

| 文件 | 改动 |
|------|------|
| `planner.service.ts` | **改造 `generateNextTask`**：新增可选参数 `sessionId?: string`，传入 `executeTask` 的 `sessionContext`；新增 `executePreTask(planId, taskContext, sessionId): Promise<PreExecutionDecision>`；新增 `executePostTask(planId, executionResult, sessionId): Promise<PostExecutionDecision>`；新增 prompt 构建方法；复用 `tryParseJson()` 解析 + 降级默认值 |
| `services/orchestration-context.service.ts` | 新增 `buildPreTaskContext()` 和 `buildPostTaskContext()` 上下文组装方法 |

### 7.4 事件

| 文件 | 改动 |
|------|------|
| `services/plan-event-stream.service.ts` | 新增 `planning.task.pre_executed` 和 `planning.task.post_processed` SSE 事件发射 |
| `orchestration-step-dispatcher.service.ts` | 每个阶段完成后同时发 SSE 事件和 `EventEmitter2` 进程内事件 |

### 7.5 模块注册

| 文件 | 改动 |
|------|------|
| `orchestration.module.ts` | 导入 `EventEmitterModule.forRoot()`（或在 AppModule 导入）；注册 `OrchestrationStepDispatcherService`、`OrchestrationEventListenerService` |
| `orchestration-plan.schema.ts` | `OrchestrationGenerationState` 接口新增 `currentPhase` + `lastDecision` + `plannerSessionId` + `currentTaskId`；`@Prop(raw({...}))` 同步新增 |

### 7.6 Controller

| 文件 | 改动 |
|------|------|
| `orchestration.controller.ts` | 新增 `POST /plans/:id/advance` 端点（通过 EventEmitter 发事件触发推进） |

### 7.7 不改动的文件

| 文件 | 原因 |
|------|------|
| `dto/index.ts` | advance 端点 body 简单，不需要复杂 DTO |
| `orchestration-task.schema.ts` | 阶段信息写 metadata，不改 task schema |
| `agent-client.service.ts` | `getOrCreatePlanSession`/`executeTask`/`archiveSession` 已有，直接复用 |
| `agent-session.schema.ts` | session 模型已满足需求 |

## 8. 兼容与灰度策略

- 增加环境变量开关：`ORCH_STEP_DISPATCHER_ENABLED`（默认 `false`）。
- 开关关闭：保持现有 `for(;;)` 循环链路，完全不受影响。
- 开关开启：`startGeneration` / `generateNext` 走 dispatcher 新链路；`advance` API 可用。
- API 兼容：保留 `POST /plans/:id/generate-next` 等现有入口，内部实现按开关切换。
- 迁移路径：老 plan 的 `generationState` 无 `currentPhase`/`plannerSessionId` 字段时，默认 `'idle'` + 首次 advanceOnce 时创建 session。

## 9. 测试与验证计划

### 9.1 单元测试

- `OrchestrationStepDispatcherService`：
  - 阶段推进状态机（idle→generating→pre_execute→executing→post_execute→idle）
  - 非法跃迁拒绝
  - MongoDB 条件更新并发安全（模拟两个 advanceOnce 同时进入——内部直调 + 事件触发）
  - plannerSessionId 首次创建、后续复用
- `OrchestrationEventListenerService`：
  - `@OnEvent` 正确接收事件并调用 dispatcher
  - 事件携带不同 source 均能正常处理
- `PlannerService`：
  - `generateNextTask` 带 sessionId 调用正确
  - `executePreTask` 输出解析成功/失败降级
  - `executePostTask` 输出解析成功/失败降级（默认 stop）

### 9.2 集成测试

- 完整四阶段成功链路（内部直调：A→B→C→D→generate_next→A→...→D→stop）
- 外部事件触发推进（通过 `POST /plans/:id/advance` 触发 A 阶段）
- 内部 + 外部并发触发同一 plan（验证幂等：只有一个成功推进）
- B 阶段 `allowExecute: false` 阻断 C
- C 阶段失败后 D 决策 `retry` / `redesign`
- D 阶段解析失败降级 `stop`
- Plan 完成后 planner session 被归档 + `PLAN_COMPLETED` 事件发布
- Plan replan 后旧 session 归档、新 session 创建

### 9.3 回归测试

- 开关关闭：现有 `create + autoGenerate` 走旧链路无影响
- 开关开启：`create + autoGenerate` 走新链路行为正确
- SSE 事件顺序：新增 2 个事件插入位置正确
- 进程内事件：其他模块可通过 `@OnEvent('orchestration.*')` 订阅到阶段通知

## 10. 风险与控制

| 风险 | 影响 | 控制措施 |
|------|------|----------|
| Planner pre/post 调用增加延迟与 token 成本 | 单步耗时可能翻 2-3 倍 | 设置独立超时（建议 60s）；token 计入 `totalCost`，受 `maxCostTokens` 约束；session 模式下 prompt 精简可部分对冲 |
| Session 对话过长导致 context window 溢出 | 超长 plan（>15 轮）可能超出 LLM 上下文窗口 | `maxTasks` 配置 + session 消息数监控；极端情况下断点续编 |
| Post-Task 输出不稳定导致流程抖动 | 可能在 generate_next/stop 间反复 | 严格 JSON schema 校验；解析失败默认 `stop`；连续 retry 受 `maxRetries` 限制 |
| 内部直调 + 外部事件并发推进同一阶段 | 可能出现重复处理 | MongoDB 条件更新（`{ currentPhase: expected }`）保证只有一个成功；失败方静默跳过 |
| `@nestjs/event-emitter` 进程内事件丢失（进程崩溃） | 事件触发的推进请求丢失 | 进程重启后通过 `currentPhase != 'idle' && !isComplete` 检测中断的 plan，自动恢复推进 |
| `advanceOnce` 递归调用栈溢出 | 极端情况下快速推进可能爆栈 | 用 `setImmediate` 做尾调用解耦 |
| 灰度切换后旧 plan 数据兼容 | 旧 plan 无新字段 | 缺失时默认 `'idle'`，首次推进时自动创建 session |

## 11. 实施里程碑

| 里程碑 | 内容 | 前置依赖 |
|--------|------|----------|
| M1 | 安装 `@nestjs/event-emitter` + `EventEmitterModule.forRoot()` 注册 + 事件常量/类型定义 | 无 |
| M2 | generationState schema 扩展（`currentPhase` + `lastDecision` + `plannerSessionId` + `currentTaskId`）+ `OrchestrationStepDispatcher` 骨架 + 拆循环为单步推进 + planner session 创建/归档 | M1 |
| M3 | 改造 `generateNextTask` 传入 sessionId + A 阶段 prompt 精简 | M2 |
| M4 | 接入 Pre-Planner 阶段（B）：prompt 模板 + 输出解析 + 阻断逻辑 | M2 |
| M5 | 接入 Post-Planner 阶段（D）：prompt 模板 + `nextAction` 决策 + 驱动下一轮 | M2 |
| M6 | `OrchestrationEventListenerService` + `@OnEvent` 订阅 + `POST /plans/:id/advance` API + 双通道幂等验证 | M2 |
| M7 | SSE 事件对齐 + 进程内事件发布 + 灰度开关 | M4, M5, M6 |
| M8 | 测试补齐（单元/集成/回归）+ 文档更新 | M7 |

> M3、M4、M5、M6 可并行开发（都只依赖 M2）。

## 12. 验收标准

- [x] 编排主流程不再依赖服务内 `for(;;)` 持续循环。
- [x] Planner 在整个 plan 生命周期内维持有状态 session，A/B/D 阶段共享同一 session。
- [x] 单个任务完整经历四阶段（A→B→C→D），每个阶段有 SSE 事件和进程内事件。
- [x] 下一轮是否生成由 Planner Post-Task 决策决定（`nextAction`）。
- [x] 内部直调路径正常工作（阶段间自动衔接）。
- [x] 外部事件触发路径正常工作（`POST /plans/:id/advance` 或 `eventEmitter.emit`）。
- [x] 内部 + 外部并发触发同一 plan 时，幂等保证只推进一次。
- [x] 灰度开关关闭时，现有链路完全不受影响。
- [x] Planner pre/post 解析失败有明确降级行为（B 放行，D 终止）。
- [x] Token 成本可追踪，受 `maxCostTokens` 约束。
- [x] Plan 完成/失败时 planner session 被归档。
- [x] Plan replan 时旧 session 归档，新 session 创建。
- [x] 其他后端模块可通过 `@OnEvent('orchestration.*')` 订阅编排阶段事件。

## 13. 后续演进方向（不在本次范围）

| 方向 | 触发条件 | 说明 |
|------|----------|------|
| Session 断点续编 | plan 超过 15 轮或 session 消息过长 | archiveSession + 创建新 session，传入 summary 做压缩 |
| B/D 阶段可选跳过 | 简单任务不需要 pre/post 干预 | 在 plan 或 task 级别加 `skipPreTask` / `skipPostTask` 配置 |
| 跨进程事件（Redis Pub/Sub） | 多实例部署需要跨进程事件 | 将 `@nestjs/event-emitter` 事件桥接到 Redis Pub/Sub |
| 外部 Webhook 触发 | 需要外部系统（CI/CD、审批系统）回调推进 | 新增 Webhook 端点，验签后发 `ADVANCE_REQUESTED` 事件 |

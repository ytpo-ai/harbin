# Agent Lifecycle Hook 技术设计文档

## 1. 概述

本文档描述 Agent 执行链路中 Task / Step / ToolCall / Permission 四个维度的统一生命周期 Hook 系统的技术设计。

### 1.1 设计原则

- **单一协议**：所有维度共享 `LifecycleHook` 接口，降低学习与维护成本
- **Registry + Pipeline 分层**：注册中心管理 hook 实例，调度器负责串行执行
- **与现有 Dispatcher 正交**：Pipeline 是同步拦截层（可修改执行行为），Dispatcher 是异步通知层（pub/sub 外发）
- **向后兼容**：现有 step hooks 无损迁移，外部行为不变
- **插件化预留**：装饰器自动发现 + 动态注册/注销 = 后期可扩展为插件热加载

## 2. 类型体系

### 2.1 生命周期阶段枚举

```
文件: modules/runtime/hooks/lifecycle-hook.types.ts
```

```typescript
// ---- Phase 枚举 ----

export type TaskPhase =
  | 'task.created'
  | 'task.running'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled';

export type StepPhase =
  | 'step.before'
  | 'step.after';

export type ToolCallPhase =
  | 'toolcall.pending'
  | 'toolcall.running'
  | 'toolcall.completed'
  | 'toolcall.failed';

export type PermissionPhase =
  | 'permission.asked'
  | 'permission.replied'
  | 'permission.denied';

export type LifecyclePhase =
  | TaskPhase
  | StepPhase
  | ToolCallPhase
  | PermissionPhase;
```

### 2.2 统一上下文

```typescript
export interface LifecycleHookContext {
  /** 当前生命周期阶段 */
  phase: LifecyclePhase;
  /** 运行 ID */
  runId: string;
  /** Agent ID */
  agentId: string;
  /** 任务 ID */
  taskId?: string;
  /** 会话 ID */
  sessionId?: string;
  /** 追踪 ID */
  traceId: string;
  /** 事件时间戳 */
  timestamp: number;
  /** 阶段特定载荷（各维度不同，详见 2.5） */
  payload: Record<string, unknown>;
}
```

### 2.3 Hook 执行结果

```typescript
/**
 * Hook action 控制下游行为：
 * - continue: 正常继续
 * - skip:     跳过当前操作（由调用方决定具体语义）
 * - abort:    中止 pipeline，不再执行后续 hooks
 * - pause:    请求暂停当前 run（调用方调用 runtimeOrchestrator.pauseRun）
 * - cancel:   请求取消当前 task/run（调用方触发取消流程，并中止 pipeline）
 * - retry:    请求重试当前 step（仅 step.after 有效）
 */
export type LifecycleHookAction = 'continue' | 'skip' | 'abort' | 'pause' | 'cancel' | 'retry';

/**
 * 消息过滤规则：用于 hook 对执行过程中的 messages 做过滤或替换。
 */
export interface MessageFilter {
  type: 'remove' | 'replace';
  matchRole?: 'system' | 'user' | 'assistant' | 'tool';
  matchContentContains?: string;
  matchContentPattern?: string;  // 正则表达式
  replaceContent?: string;       // replace 操作时的新内容
  reason?: string;               // 过滤原因（用于日志）
}

export interface LifecycleHookResult {
  /** 控制下游行为 */
  action: LifecycleHookAction;
  /** 注入额外 system messages */
  appendMessages?: string[];
  /** 消息过滤规则（在消息发送给模型前过滤/替换） */
  messageFilters?: MessageFilter[];
  /** 修改载荷（传递给后续 hooks） */
  mutatedPayload?: Record<string, unknown>;
  /** 附加元数据（用于日志/审计） */
  metadata?: Record<string, unknown>;
  /** pause/cancel 时的原因说明 */
  reason?: string;
}

/** 默认透传结果 */
export const LIFECYCLE_HOOK_CONTINUE: LifecycleHookResult = {
  action: 'continue',
};
```

### 2.4 统一 Hook 接口

```typescript
export interface LifecycleHook {
  /** Hook 唯一标识（建议格式: domain.name，如 agent.before-step-optimization） */
  readonly id: string;
  /** 适用的生命周期阶段（支持多阶段） */
  readonly phases: LifecyclePhase[];
  /** 执行优先级（数字越小越先执行，默认 100） */
  readonly priority: number;
  /** 是否启用（支持运行时 toggle） */
  enabled?: boolean;
  /** 匹配判断：返回 false 则跳过本 hook */
  matches(context: LifecycleHookContext): boolean | Promise<boolean>;
  /** 执行逻辑 */
  execute(context: LifecycleHookContext): Promise<LifecycleHookResult>;
}
```

### 2.5 各维度载荷定义

```typescript
/** step.before 载荷 */
export interface StepBeforePayload {
  agent: unknown;          // Agent 实体
  task: unknown;           // Task 实体
  messages: unknown[];     // 当前消息栈
  modelConfig: unknown;    // 模型配置
  round: number;           // 当前轮次
  maxRounds: number;       // 最大轮次
  assignedToolIds: string[];
  executedToolIds: string[];
}

/** step.after 载荷 */
export interface StepAfterPayload extends StepBeforePayload {
  response: string;        // 模型输出
}

/** toolcall.* 载荷 */
export interface ToolCallPayload {
  toolId: string;
  toolCallId: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;       // 仅 completed
  error?: string;         // 仅 failed
  partId?: string;
  messageId?: string;
}

/** permission.* 载荷 */
export interface PermissionPayload {
  approved?: boolean;      // 仅 replied
  reason?: string;
  actorId?: string;
  actorType?: string;
  [key: string]: unknown;
}

/** task.* 载荷 */
export interface TaskPayload {
  task: unknown;           // Task 实体
  agent?: unknown;         // Agent 实体
  response?: string;       // 仅 completed
  error?: string;          // 仅 failed
  reason?: string;         // 仅 cancelled
  attempt?: number;        // 当前重试次数
  maxAttempts?: number;
}
```

## 3. HookRegistry 注册中心

### 3.1 核心实现

```
文件: modules/runtime/hooks/hook-registry.service.ts
```

```typescript
@Injectable()
export class HookRegistryService implements OnModuleInit {
  private readonly logger = new Logger(HookRegistryService.name);
  private readonly hooks = new Map<string, LifecycleHook>();

  // NestJS 注入所有标记了 LIFECYCLE_HOOK_TOKEN 的 providers
  constructor(
    @Optional()
    @Inject(LIFECYCLE_HOOKS_TOKEN)
    private readonly discoveredHooks: LifecycleHook[] = [],
  ) {}

  onModuleInit(): void {
    // 自动注册所有通过 DI 发现的 hooks
    for (const hook of this.discoveredHooks) {
      this.register(hook);
    }
    this.logger.log(
      `[hook_registry_init] registered=${this.hooks.size} hooks=[${[...this.hooks.keys()].join(', ')}]`,
    );
  }

  register(hook: LifecycleHook): void {
    if (this.hooks.has(hook.id)) {
      this.logger.warn(`[hook_registry] duplicate hookId=${hook.id}, overwriting`);
    }
    this.hooks.set(hook.id, hook);
  }

  unregister(hookId: string): boolean {
    return this.hooks.delete(hookId);
  }

  getHooksForPhase(phase: LifecyclePhase): LifecycleHook[] {
    // 快照 + 过滤 + 排序，避免迭代中修改
    return [...this.hooks.values()]
      .filter(h => (h.enabled !== false) && h.phases.includes(phase))
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  has(hookId: string): boolean {
    return this.hooks.has(hookId);
  }

  listAll(): Array<{ id: string; phases: LifecyclePhase[]; priority: number; enabled: boolean }> {
    return [...this.hooks.values()].map(h => ({
      id: h.id,
      phases: h.phases,
      priority: h.priority ?? 100,
      enabled: h.enabled !== false,
    }));
  }
}
```

### 3.2 自动发现机制

```typescript
// 注入 Token
export const LIFECYCLE_HOOKS_TOKEN = Symbol('LIFECYCLE_HOOKS_TOKEN');

// 在 Module 中注册
// providers: [
//   { provide: LIFECYCLE_HOOKS_TOKEN, useClass: MyHook, multi: true },
//   ...
// ]
//
// 或使用辅助函数：
export function provideLifecycleHook(hookClass: Type<LifecycleHook>) {
  return { provide: LIFECYCLE_HOOKS_TOKEN, useClass: hookClass, multi: true };
}
```

## 4. HookPipeline 调度器

### 4.1 核心实现

```
文件: modules/runtime/hooks/hook-pipeline.service.ts
```

```typescript
export interface PipelineResult {
  /** 是否被中止 */
  aborted: boolean;
  /** 中止的 hook id */
  abortedBy?: string;
  /** 累积的 system messages */
  appendMessages: string[];
  /** 最终载荷（经过 hooks 修改） */
  finalPayload: Record<string, unknown>;
  /** 实际执行的 hook id 列表 */
  executedHooks: string[];
  /** matches=false 跳过的 hook id 列表 */
  skippedHooks: string[];
  /** 累积元数据 */
  metadata: Record<string, unknown>;
  /** pipeline 总耗时 ms */
  durationMs: number;
}

@Injectable()
export class HookPipelineService {
  private readonly logger = new Logger(HookPipelineService.name);

  constructor(private readonly registry: HookRegistryService) {}

  async run(context: LifecycleHookContext): Promise<PipelineResult> {
    const startAt = Date.now();
    const hooks = this.registry.getHooksForPhase(context.phase);

    const result: PipelineResult = {
      aborted: false,
      appendMessages: [],
      finalPayload: { ...context.payload },
      executedHooks: [],
      skippedHooks: [],
      metadata: {},
      durationMs: 0,
    };

    if (hooks.length === 0) {
      result.durationMs = Date.now() - startAt;
      return result;
    }

    // 可变上下文：后续 hooks 看到前序 hooks 的 payload 修改
    const mutableContext: LifecycleHookContext = {
      ...context,
      payload: { ...context.payload },
    };

    for (const hook of hooks) {
      try {
        const matched = await hook.matches(mutableContext);
        if (!matched) {
          result.skippedHooks.push(hook.id);
          continue;
        }

        const hookStartAt = Date.now();
        const hookResult = await hook.execute(mutableContext);
        const hookDuration = Date.now() - hookStartAt;
        result.executedHooks.push(hook.id);

        this.logger.debug(
          `[hook_pipeline] phase=${context.phase} hook=${hook.id} action=${hookResult.action} durationMs=${hookDuration}`,
        );

        // 累积 appendMessages
        if (hookResult.appendMessages?.length) {
          result.appendMessages.push(...hookResult.appendMessages);
        }

        // 合并 mutatedPayload
        if (hookResult.mutatedPayload) {
          Object.assign(mutableContext.payload, hookResult.mutatedPayload);
        }

        // 合并 metadata
        if (hookResult.metadata) {
          Object.assign(result.metadata, hookResult.metadata);
        }

        // abort 中止后续执行
        if (hookResult.action === 'abort') {
          result.aborted = true;
          result.abortedBy = hook.id;
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[hook_pipeline_error] phase=${context.phase} hook=${hook.id} error=${message}`,
        );
        // hook 执行失败不阻塞 pipeline，记录并继续
        result.metadata[`error_${hook.id}`] = message;
      }
    }

    result.finalPayload = { ...mutableContext.payload };
    result.durationMs = Date.now() - startAt;

    if (result.executedHooks.length > 0) {
      this.logger.debug(
        `[hook_pipeline_done] phase=${context.phase} executed=${result.executedHooks.length} skipped=${result.skippedHooks.length} aborted=${result.aborted} durationMs=${result.durationMs}`,
      );
    }

    return result;
  }
}
```

### 4.2 执行语义

| action | 含义 | Pipeline 行为 | 调用方行为 |
|--------|------|--------------|-----------|
| `continue` | 透传，继续执行下一个 hook | 正常继续 | 正常执行 |
| `skip` | 建议跳过当前操作 | 正常继续 | 调用方可据此跳过 |
| `abort` | 中止 pipeline | 立即退出循环 | 调用方根据 `aborted` 决定 |
| `pause` | 请求暂停 run | 标记 `pauseRequested`，继续收集后续指令 | 调用方调用 `pauseRun()` |
| `cancel` | 请求取消 task/run | 标记 `cancelRequested`，立即退出循环 | 调用方调用 `cancelRun()` |
| `retry` | 请求重试当前 step | 标记 `retryRequested`，继续收集后续指令 | 调用方 `continue` 循环 |

### 4.3 容错策略

- 单个 hook 的 `matches()` 或 `execute()` 抛异常时，**不阻塞 pipeline**，记录错误后继续下一个 hook
- Pipeline 整体不抛异常，始终返回 `PipelineResult`
- 调用方（如 `AgentExecutorService`）根据 `result.aborted` 决定是否中止业务流程

## 5. 集成点设计

### 5.1 Step Hooks 接入（AgentExecutorService）

**改造前**（硬编码）：

```typescript
// agent-executor.service.ts 构造函数
this.agentBeforeStepHooks = [this.beforeStepOptimizationHook];
this.agentAfterStepHooks = [this.afterStepEvaluationHook];

// 执行循环中
const beforeStepHookResult = await this.runBeforeStepHooks(stepContext);
const afterStepHookResult = await this.runAfterStepHooks(stepContext, response);
```

**改造后**（Pipeline）：

```typescript
// 不再维护 agentBeforeStepHooks / agentAfterStepHooks 数组
// 直接调用 pipeline

const beforeResult = await this.hookPipeline.run({
  phase: 'step.before',
  runId: runtimeContext.runId,
  agentId: agentRuntimeId,
  taskId: task.id,
  traceId: runtimeContext.traceId,
  timestamp: Date.now(),
  payload: { agent, task, messages, modelConfig, round, maxRounds, assignedToolIds, executedToolIds },
});
// 从 beforeResult 提取 appendMessages / forcedToolCall (via mutatedPayload)

const afterResult = await this.hookPipeline.run({
  phase: 'step.after',
  // ...同上
  payload: { ...stepPayload, response },
});
// 从 afterResult 提取 decision / appendMessages
```

### 5.2 ToolCall Hooks 接入（RuntimeOrchestratorService）

在 `recordToolPending/Running/Completed/Failed` 方法中，事件写入 **之前** 调用 pipeline：

```typescript
async recordToolPending(rawInput): Promise<string> {
  const pipelineResult = await this.hookPipeline.run({
    phase: 'toolcall.pending',
    runId: input.runId,
    agentId: input.agentId,
    taskId: input.taskId,
    traceId: rawInput.traceId,
    timestamp: Date.now(),
    payload: { toolId, toolCallId, toolName, input: input.input },
  });

  if (pipelineResult.aborted) {
    throw new Error(`ToolCall blocked by hook: ${pipelineResult.abortedBy}`);
  }

  // 继续原有逻辑...
}
```

### 5.3 Permission Hooks 接入（RuntimeOrchestratorService）

在 `recordPermissionAsked/Decision` 方法中调用 pipeline。

### 5.4 Task Hooks 接入（AgentTaskService + AgentTaskWorker）

| 触发点 | Phase |
|--------|-------|
| `createTask` 成功后 | `task.created` |
| Worker `processTask` 开始时 | `task.running` |
| Worker 执行成功后 | `task.completed` |
| Worker 执行失败后 | `task.failed` |
| `cancelTask` 成功后 | `task.cancelled` |

## 6. 现有 Hook 迁移方案

### 6.1 AgentBeforeStepOptimizationHook

```typescript
// 改造前：实现 AgentBeforeStepHook 接口
@Injectable()
export class AgentBeforeStepOptimizationHook implements AgentBeforeStepHook { ... }

// 改造后：实现 LifecycleHook 接口
@Injectable()
export class AgentBeforeStepOptimizationHook implements LifecycleHook {
  readonly id = 'agent.before-step-optimization';
  readonly phases: LifecyclePhase[] = ['step.before'];
  readonly priority = 50;

  matches(context: LifecycleHookContext): boolean {
    const payload = context.payload as StepBeforePayload;
    // 复用原有 matches 逻辑
    return ...;
  }

  async execute(context: LifecycleHookContext): Promise<LifecycleHookResult> {
    const payload = context.payload as StepBeforePayload;
    // 复用原有 run 逻辑，将结果映射为 LifecycleHookResult
    return {
      action: 'continue',
      appendMessages: [...],
      mutatedPayload: { forcedToolCall: ... },
    };
  }
}
```

### 6.2 AgentAfterStepEvaluationHook

同理，`phases = ['step.after']`，将 `decision: 'inject_instruction'` 映射为 `action: 'continue' + appendMessages`。

## 7. Module 注册

```
文件: modules/runtime/hooks/hooks.module.ts
```

```typescript
@Module({
  providers: [
    HookRegistryService,
    HookPipelineService,
  ],
  exports: [HookRegistryService, HookPipelineService],
})
export class HooksModule {}
```

在 `RuntimeModule` 中 import `HooksModule`。

在 `AgentModule` 中通过 `provideLifecycleHook()` 注册具体 hook 实现：

```typescript
providers: [
  provideLifecycleHook(AgentBeforeStepOptimizationHook),
  provideLifecycleHook(AgentAfterStepEvaluationHook),
  // 后续新增的 hooks 只需在此追加一行
]
```

## 8. 架构总览

```
                    ┌─────────────────────────────────────┐
                    │          HookRegistryService         │
                    │   register / unregister / getHooks   │
                    │   自动发现 @LIFECYCLE_HOOKS_TOKEN    │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │         HookPipelineService          │
                    │   run(context) → PipelineResult      │
                    │   串行执行 · 优先级排序 · 容错降级    │
                    └──────────────┬──────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────────┐
        │                          │                              │
        ▼                          ▼                              ▼
 AgentExecutorService      RuntimeOrchestratorService      AgentTaskService
  step.before/after         toolcall.* / permission.*       task.*
        │                          │                              │
        ▼                          ▼                              ▼
  (替代硬编码             (recordTool*/recordPermission*   (createTask/cancel
   step hook 数组)          前调用 pipeline)              /worker 内调用 pipeline)
                                   │
                    ┌──────────────▼──────────────────────┐
                    │      HookDispatcherService (不变)    │
                    │   RuntimeEvent → Redis pub/sub       │
                    │   outbox + 重试 + ActionLog 同步     │
                    └─────────────────────────────────────┘
```

## 9. 可观测性

- Pipeline 每次执行输出 debug 日志：`phase / executedHooks / skippedHooks / aborted / durationMs`
- Registry 提供 `listAll()` 接口，可在 Runtime Controller 暴露为运维 API
- hook 内部异常不丢失，记录到 `result.metadata[error_<hookId>]`

## 10. 后续扩展点（本次不实现）

- 配置化启停：通过 DB/Redis toggle `hook.enabled`
- 热加载：基于 NestJS DynamicModule 按需加载外部 hook 包
- WebHook 通知：Pipeline 结果外发到第三方系统
- 前端可视化：已注册 hooks 列表、执行统计、abort 历史

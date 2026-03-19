// ---- Lifecycle Phase 枚举 ----

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

// ---- 统一上下文 ----

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
  /** 阶段特定载荷 */
  payload: Record<string, unknown>;
}

// ---- Hook 执行结果 ----

/**
 * Hook action 控制下游行为：
 * - continue: 正常继续
 * - skip:     跳过当前操作（由调用方决定具体语义）
 * - abort:    中止 pipeline，不再执行后续 hooks
 * - pause:    请求暂停当前 run（调用方应调用 runtimeOrchestrator.pauseRun）
 * - cancel:   请求取消当前 task/run（调用方应触发取消流程）
 * - retry:    请求重试当前 step（仅 step.after 有效，调用方不返回最终结果而是继续循环）
 */
export type LifecycleHookAction = 'continue' | 'skip' | 'abort' | 'pause' | 'cancel' | 'retry';

/**
 * 消息过滤规则：用于 hook 对执行过程中的 messages 做过滤或替换。
 * - remove: 按条件移除匹配的消息
 * - replace: 按条件替换匹配消息的 content
 */
export interface MessageFilter {
  /** 操作类型 */
  type: 'remove' | 'replace';
  /** 匹配条件：按 role 过滤 */
  matchRole?: 'system' | 'user' | 'assistant' | 'tool';
  /** 匹配条件：content 包含指定文本 */
  matchContentContains?: string;
  /** 匹配条件：content 正则匹配 */
  matchContentPattern?: string;
  /** replace 操作时的新内容 */
  replaceContent?: string;
  /** 过滤原因（用于日志） */
  reason?: string;
}

export interface LifecycleHookResult {
  /** 控制下游行为 */
  action: LifecycleHookAction;
  /** 注入额外 system messages（主要用于 step 维度） */
  appendMessages?: string[];
  /** 消息过滤规则（主要用于 step.before，在消息发送给模型前过滤/替换） */
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

// ---- 统一 Hook 接口 ----

export interface LifecycleHook {
  /** Hook 唯一标识（建议格式: domain.name） */
  readonly id: string;
  /** 适用的生命周期阶段（支持多阶段） */
  readonly phases: LifecyclePhase[];
  /** 执行优先级（数字越小越先执行，默认 100） */
  readonly priority: number;
  /** 是否启用（支持运行时 toggle，默认 true） */
  enabled?: boolean;
  /** 匹配判断：返回 false 则跳过本 hook */
  matches(context: LifecycleHookContext): boolean | Promise<boolean>;
  /** 执行逻辑 */
  execute(context: LifecycleHookContext): Promise<LifecycleHookResult>;
}

// ---- 各维度载荷类型 ----

/** step.before 载荷 */
export interface StepBeforePayload {
  agent: unknown;
  task: unknown;
  messages: unknown[];
  modelConfig: unknown;
  round: number;
  maxRounds: number;
  assignedToolIds: string[];
  executedToolIds: string[];
}

/** step.after 载荷 */
export interface StepAfterPayload extends StepBeforePayload {
  response: string;
}

/** toolcall.* 载荷 */
export interface ToolCallPayload {
  toolId: string;
  toolCallId: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  partId?: string;
  messageId?: string;
}

/** permission.* 载荷 */
export interface PermissionPayload {
  approved?: boolean;
  reason?: string;
  actorId?: string;
  actorType?: string;
  [key: string]: unknown;
}

/** task.* 载荷 */
export interface TaskPayload {
  task: unknown;
  agent?: unknown;
  response?: string;
  error?: string;
  reason?: string;
  attempt?: number;
  maxAttempts?: number;
}

// ---- 注入 Token ----

export const LIFECYCLE_HOOKS_TOKEN = Symbol('LIFECYCLE_HOOKS_TOKEN');

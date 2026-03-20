import { Injectable, Logger } from '@nestjs/common';

// import { ModelService } from '@agent/modules/models/model.service';
import {
  LifecycleHook,
  LifecycleHookContext,
  LifecycleHookResult,
  LifecyclePhase,
  StepBeforePayload,
  LIFECYCLE_HOOK_CONTINUE,
} from '@agent/modules/runtime/hooks/lifecycle-hook.types';
import { ChatMessage } from '@legacy/shared/types';

// import { compactLogText, normalizeToolId } from './agent.constants';
import { AgentBeforeStepHook, AgentExecutorBeforeStepHookResult, AgentExecutorStepContext } from '../agent-executor-step-hooks.types';

@Injectable()
export class AgentBeforeStepOptimizationHook implements AgentBeforeStepHook, LifecycleHook {
  private readonly logger = new Logger(AgentBeforeStepOptimizationHook.name);

  // ---- LifecycleHook 协议字段 ----
  readonly id = 'agent.before-step-optimization';
  readonly phases: LifecyclePhase[] = ['step.before'];
  readonly priority = 50;

  constructor() {}

  // ---- LifecycleHook 协议方法 ----

  /** LifecycleHook.matches：从统一上下文提取 payload 后调用原有判断逻辑 */
  matches(contextOrLegacy: LifecycleHookContext | AgentExecutorStepContext): boolean {
    const stepContext = this.toStepContext(contextOrLegacy);
    if (!stepContext) return false;
    const latestUserContent = this.resolveLatestUserContent(stepContext.task, stepContext.messages).trim();
    return latestUserContent.length > 0 || String(stepContext.task.description || '').trim().length > 0;
  }

  /** LifecycleHook.execute：从统一上下文提取 payload 后调用原有执行逻辑 */
  async execute(context: LifecycleHookContext): Promise<LifecycleHookResult> {
    const stepContext = this.toStepContext(context);
    if (!stepContext) return LIFECYCLE_HOOK_CONTINUE;

    const result = await this.run(stepContext);
    return {
      action: 'continue',
      appendMessages: result.appendSystemMessages,
      mutatedPayload: result.forcedToolCall
        ? { forcedToolCall: result.forcedToolCall, decision: result.decision }
        : { decision: result.decision },
      metadata: { hookDecision: result.decision },
    };
  }

  // ---- 旧 AgentBeforeStepHook 协议方法（向后兼容） ----

  async run(context: AgentExecutorStepContext): Promise<AgentExecutorBeforeStepHookResult> {
    return {
      appendSystemMessages: [],
      decision: 'none',
    };
  }

  // ---- private helpers ----

  /**
   * 将 LifecycleHookContext 或旧 AgentExecutorStepContext 统一转为 AgentExecutorStepContext。
   * 当入参是 LifecycleHookContext 时，从 payload 中提取 step 上下文字段。
   */
  private toStepContext(input: LifecycleHookContext | AgentExecutorStepContext): AgentExecutorStepContext | null {
    if ('phase' in input && 'payload' in input) {
      const p = input.payload as Partial<StepBeforePayload>;
      if (!p.agent || !p.task || !p.messages || !p.modelConfig) return null;
      return {
        agent: p.agent as any,
        task: p.task as any,
        messages: p.messages as any[],
        modelConfig: p.modelConfig as any,
        round: typeof p.round === 'number' ? p.round : 0,
        maxRounds: typeof p.maxRounds === 'number' ? p.maxRounds : 0,
        assignedToolIds: Array.isArray(p.assignedToolIds) ? p.assignedToolIds : [],
        executedToolIds: Array.isArray(p.executedToolIds) ? p.executedToolIds : [],
      };
    }
    return input as AgentExecutorStepContext;
  }

  private resolveLatestUserContent(task: { messages?: ChatMessage[]; description?: string; title?: string }, messages: ChatMessage[]): string {
    const latestUserMessage = [...(task.messages || []), ...(messages || [])]
      .reverse()
      .find((item) => item?.role === 'user' && typeof item.content === 'string' && item.content.trim().length > 0)?.content;
    return latestUserMessage || task.description || task.title || '';
  }
}

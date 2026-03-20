import { Injectable, Logger } from '@nestjs/common';

// import { ModelService } from '@agent/modules/models/model.service';
import {
  LifecycleHook,
  LifecycleHookContext,
  LifecycleHookResult,
  LifecyclePhase,
  StepAfterPayload,
  LIFECYCLE_HOOK_CONTINUE,
} from '@agent/modules/runtime/hooks/lifecycle-hook.types';

// import { compactLogText } from '../agent.constants';
import { AgentAfterStepHook, AgentExecutorAfterStepHookResult, AgentExecutorStepContext } from '../agent-executor-step-hooks.types';

@Injectable()
export class AgentAfterStepEvaluationHook implements AgentAfterStepHook, LifecycleHook {
  private readonly logger = new Logger(AgentAfterStepEvaluationHook.name);

  // ---- LifecycleHook 协议字段 ----
  readonly id = 'agent.after-step-evaluation';
  readonly phases: LifecyclePhase[] = ['step.after'];
  readonly priority = 50;

  constructor() {}

  // ---- LifecycleHook 协议方法 ----

  /** LifecycleHook.matches：从统一上下文提取 payload 后调用原有判断逻辑 */
  matches(contextOrLegacy: LifecycleHookContext | AgentExecutorStepContext, response?: string): boolean {
    if ('phase' in contextOrLegacy && 'payload' in contextOrLegacy) {
      const p = contextOrLegacy.payload as Partial<StepAfterPayload>;
      return String(p.response || '').trim().length > 0;
    }
    return String(response || '').trim().length > 0;
  }

  /** LifecycleHook.execute：从统一上下文提取 payload 后调用原有执行逻辑 */
  async execute(context: LifecycleHookContext): Promise<LifecycleHookResult> {
    const stepContext = this.toStepContext(context);
    if (!stepContext) return LIFECYCLE_HOOK_CONTINUE;

    const responseText = String((context.payload as Partial<StepAfterPayload>).response || '');
    const result = await this.run(stepContext, responseText);

    return {
      action: 'continue',
      appendMessages: result.appendSystemMessages,
      mutatedPayload: { decision: result.decision },
      metadata: { hookDecision: result.decision },
    };
  }

  async run(
    context: AgentExecutorStepContext,
    response: string,
  ): Promise<AgentExecutorAfterStepHookResult> {
    try {
      return {
        decision: 'accept',
        appendSystemMessages: [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'unknown');
      this.logger.warn(`[after_step_hook_failed] error=${message}`);
      return {
        decision: 'accept',
        appendSystemMessages: [],
      };
    }
  }

  // ---- private helpers ----

  private toStepContext(input: LifecycleHookContext): AgentExecutorStepContext | null {
    const p = input.payload as Partial<StepAfterPayload>;
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
}

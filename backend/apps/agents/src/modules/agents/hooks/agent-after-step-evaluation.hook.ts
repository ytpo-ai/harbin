import { Injectable, Logger } from '@nestjs/common';

import { AGENT_PROMPTS } from '@agent/modules/prompt-registry/agent-prompt-catalog';
import {
  LifecycleHook,
  LifecycleHookContext,
  LifecycleHookResult,
  LifecyclePhase,
  StepAfterPayload,
  LIFECYCLE_HOOK_CONTINUE,
} from '@agent/modules/runtime/hooks/lifecycle-hook.types';

import { AgentAfterStepHook, AgentExecutorAfterStepHookResult, AgentExecutorStepContext } from '../agent-executor-step-hooks.types';

/** tool intent retry: max correction attempts before giving up */
const MAX_TOOL_INTENT_RETRIES = 2;

/**
 * Regex patterns that detect "describing a tool call" in natural language
 * without actually outputting <tool_call> tags.
 */
const TOOL_INTENT_PATTERNS: RegExp[] = [
  /我(现在|马上|立即|先|正在|来)(就|去)?(调用|执行|使用|克隆|拉取|读取|查询|搜索|发送|写入)/,
  /让我(调用|执行|使用|来|去)/,
  /(收到|好的|明白).{0,20}(执行|调用|克隆|使用工具)/,
  /开始(执行|调用|克隆|拉取|查询)/,
  /我(会|将)(调用|执行|使用)/,
  /(立即|马上)(执行|调用)/,
  /(不能|无法|没法).{0,16}(执行|调用).{0,12}(工具|repo-writer|repo-read)/,
  /请在.{0,16}(终端|环境).{0,16}(运行|执行)/,
  /repo-writer\s+clone/i,
];

@Injectable()
export class AgentAfterStepEvaluationHook implements AgentAfterStepHook, LifecycleHook {
  private readonly logger = new Logger(AgentAfterStepEvaluationHook.name);

  // ---- LifecycleHook 协议字段 ----
  readonly id = 'agent.after-step-evaluation';
  readonly phases: LifecyclePhase[] = ['step.after'];
  readonly priority = 50;

  /** per-task retry counter (keyed by taskId) to enforce MAX_TOOL_INTENT_RETRIES */
  private readonly retryCounters = new Map<string, number>();

  constructor() {}

  // ---- LifecycleHook 协议方法 ----

  /** LifecycleHook.matches */
  matches(contextOrLegacy: LifecycleHookContext | AgentExecutorStepContext, response?: string): boolean {
    if ('phase' in contextOrLegacy && 'payload' in contextOrLegacy) {
      const p = contextOrLegacy.payload as Partial<StepAfterPayload>;
      return String(p.response || '').trim().length > 0;
    }
    return String(response || '').trim().length > 0;
  }

  /** LifecycleHook.execute */
  async execute(context: LifecycleHookContext): Promise<LifecycleHookResult> {
    const stepContext = this.toStepContext(context);
    if (!stepContext) return LIFECYCLE_HOOK_CONTINUE;

    const responseText = String((context.payload as Partial<StepAfterPayload>).response || '');
    const result = await this.run(stepContext, responseText);

    return {
      action: result.retryRequested ? 'retry' : 'continue',
      appendMessages: result.appendSystemMessages,
      mutatedPayload: { decision: result.decision },
      metadata: { hookDecision: result.decision, retryRequested: result.retryRequested ?? false },
    };
  }

  async run(
    context: AgentExecutorStepContext,
    response: string,
  ): Promise<AgentExecutorAfterStepHookResult> {
    try {
      if (this.detectsToolIntentWithoutExecution(response, context.assignedToolIds)) {
        const taskId = String((context.task as any)?.id || (context.task as any)?._id || 'unknown');
        const currentRetries = this.retryCounters.get(taskId) || 0;

        if (currentRetries < MAX_TOOL_INTENT_RETRIES) {
          this.retryCounters.set(taskId, currentRetries + 1);
          this.logger.warn(
            `[tool_intent_without_execution] agent=${context.agent?.name} taskId=${taskId} round=${context.round + 1} retry=${currentRetries + 1}/${MAX_TOOL_INTENT_RETRIES}`,
          );
          return {
            decision: 'inject_instruction',
            retryRequested: true,
            appendSystemMessages: [AGENT_PROMPTS.toolIntentRetryInstruction.buildDefaultContent()],
          };
        }

        // exceeded max retries, accept but warn
        this.logger.warn(
          `[tool_intent_retry_exhausted] agent=${context.agent?.name} taskId=${taskId} round=${context.round + 1} — accepting response after ${MAX_TOOL_INTENT_RETRIES} retries`,
        );
        this.retryCounters.delete(taskId);
      }

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

  // ---- detection logic ----

  /**
   * Returns true if the response describes an intent to call tools (natural language)
   * but does NOT contain an actual <tool_call> tag.
   */
  private detectsToolIntentWithoutExecution(response: string, assignedToolIds: string[]): boolean {
    // if it has a real tool_call tag, not a false positive
    if (/<tool_call>/i.test(response)) return false;

    // check intent patterns
    const hasIntentLanguage = TOOL_INTENT_PATTERNS.some((p) => p.test(response));
    if (hasIntentLanguage) return true;

    // detect command-hand-off anti-pattern: suggests raw commands instead of calling tool
    const lowerResponse = response.toLowerCase();
    if (
      lowerResponse.includes('```') &&
      (lowerResponse.includes('repo-writer clone') || lowerResponse.includes('git clone'))
    ) {
      return true;
    }

    // check if mentions specific assigned tool short names
    const lower = lowerResponse;
    const mentionsToolId = assignedToolIds.some((id) => {
      const shortName = (id.split('.').pop() || id).toLowerCase();
      // skip very short names to avoid false positives
      if (shortName.length < 4) return false;
      return lower.includes(shortName);
    });

    return mentionsToolId;
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

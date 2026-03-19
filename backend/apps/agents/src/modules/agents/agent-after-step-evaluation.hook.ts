import { Injectable, Logger } from '@nestjs/common';

import { ModelService } from '@agent/modules/models/model.service';
import {
  LifecycleHook,
  LifecycleHookContext,
  LifecycleHookResult,
  LifecyclePhase,
  StepAfterPayload,
  LIFECYCLE_HOOK_CONTINUE,
} from '@agent/modules/runtime/hooks/lifecycle-hook.types';

import { compactLogText } from './agent.constants';
import { AgentAfterStepHook, AgentExecutorAfterStepHookResult, AgentExecutorStepContext } from './agent-executor-step-hooks.types';

@Injectable()
export class AgentAfterStepEvaluationHook implements AgentAfterStepHook, LifecycleHook {
  private readonly logger = new Logger(AgentAfterStepEvaluationHook.name);

  // ---- LifecycleHook 协议字段 ----
  readonly id = 'agent.after-step-evaluation';
  readonly phases: LifecyclePhase[] = ['step.after'];
  readonly priority = 50;

  constructor(private readonly modelService: ModelService) {}

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

  // ---- 旧 AgentAfterStepHook 协议方法（向后兼容） ----

  async run(
    context: AgentExecutorStepContext,
    response: string,
  ): Promise<AgentExecutorAfterStepHookResult> {
    const prompt = [
      '你是 Agent 执行链路的 after-step 评估 Hook。',
      '目标：评估本轮模型输出是否可以直接作为最终回复。',
      '若输出存在"宣称已执行成功/已完成核验"但缺少工具执行事实支撑，返回注入指令，要求下一轮先核验。',
      '不要依赖关键词硬编码，按语义判断。',
      '仅输出 JSON，不要输出 markdown。',
      '{',
      '  "decision": "accept|inject_instruction",',
      '  "appendSystemMessages": ["..."]',
      '}',
      `taskTitle=${compactLogText(String(context.task.title || ''), 240)}`,
      `taskDescription=${compactLogText(String(context.task.description || ''), 480)}`,
      `latestResponse=${compactLogText(String(response || ''), 1000)}`,
      `allowedTools=${JSON.stringify(context.assignedToolIds)}`,
      `executedTools=${JSON.stringify(context.executedToolIds)}`,
      `round=${context.round + 1}/${context.maxRounds + 1}`,
    ].join('\n');

    try {
      const hookResponse = await this.modelService.chat(context.modelConfig.id, [
        {
          role: 'system',
          content: '你是严格 JSON 输出器。',
          timestamp: new Date(),
        },
        {
          role: 'user',
          content: prompt,
          timestamp: new Date(),
        },
      ], {
        temperature: 0.1,
        maxTokens: 600,
      });

      const parsed = this.tryParseHookResponse(hookResponse);
      if (!parsed) {
        this.logger.warn('[after_step_hook_parse_failed] fallback=accept');
        return {
          decision: 'accept',
          appendSystemMessages: [],
        };
      }

      const decision = parsed.decision === 'inject_instruction' ? 'inject_instruction' : 'accept';
      const appendSystemMessages = Array.isArray(parsed.appendSystemMessages)
        ? parsed.appendSystemMessages
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        : [];

      return {
        decision,
        appendSystemMessages,
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

  private tryParseHookResponse(response: string): Record<string, unknown> | null {
    const text = String(response || '').trim();
    if (!text) {
      return null;
    }

    const candidates = [text];
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(text.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, unknown>;
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}

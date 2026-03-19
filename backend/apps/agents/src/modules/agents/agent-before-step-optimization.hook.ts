import { Injectable, Logger } from '@nestjs/common';

import { ModelService } from '@agent/modules/models/model.service';
import {
  LifecycleHook,
  LifecycleHookContext,
  LifecycleHookResult,
  LifecyclePhase,
  StepBeforePayload,
  LIFECYCLE_HOOK_CONTINUE,
} from '@agent/modules/runtime/hooks/lifecycle-hook.types';
import { ChatMessage } from '@legacy/shared/types';

import { compactLogText, normalizeToolId } from './agent.constants';
import { AgentBeforeStepHook, AgentExecutorBeforeStepHookResult, AgentExecutorStepContext } from './agent-executor-step-hooks.types';

@Injectable()
export class AgentBeforeStepOptimizationHook implements AgentBeforeStepHook, LifecycleHook {
  private readonly logger = new Logger(AgentBeforeStepOptimizationHook.name);

  // ---- LifecycleHook 协议字段 ----
  readonly id = 'agent.before-step-optimization';
  readonly phases: LifecyclePhase[] = ['step.before'];
  readonly priority = 50;

  constructor(private readonly modelService: ModelService) {}

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
    const latestUserContent = this.resolveLatestUserContent(context.task, context.messages);
    const prompt = [
      '你是 Agent 执行引擎的 before-step 优化 Hook。',
      '目标：在当前 step 开始前做语义增强，不使用关键词硬编码规则。',
      '必须判断：是否存在"新建计划编排"意图；若存在且工具可用，可建议直接工具调用。',
      '可用工具列表仅来自 allowedTools，禁止输出未授权工具。',
      '仅输出 JSON，不要输出 markdown。',
      '{',
      '  "appendSystemMessages": ["..."],',
      '  "forcedToolCall": {"tool":"...","parameters":{},"reason":"..."} | null,',
      '  "decision": "none|enhance|force_tool_call"',
      '}',
      `taskType=${String(context.task.type || '')}`,
      `taskTitle=${compactLogText(String(context.task.title || ''), 240)}`,
      `taskDescription=${compactLogText(String(context.task.description || ''), 480)}`,
      `latestUserContent=${compactLogText(latestUserContent, 600)}`,
      `allowedTools=${JSON.stringify(context.assignedToolIds)}`,
      `executedTools=${JSON.stringify(context.executedToolIds)}`,
      `round=${context.round + 1}/${context.maxRounds + 1}`,
    ].join('\n');

    try {
      const response = await this.modelService.chat(context.modelConfig.id, [
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
        maxTokens: 800,
      });

      const parsed = this.tryParseHookResponse(response);
      if (!parsed) {
        this.logger.warn('[before_step_hook_parse_failed] fallback=pass_through');
        return {
          appendSystemMessages: [],
          decision: 'none',
        };
      }

      const appendSystemMessages = Array.isArray(parsed.appendSystemMessages)
        ? parsed.appendSystemMessages
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        : [];
      const forcedToolCall = this.normalizeForcedToolCall(parsed.forcedToolCall, context.assignedToolIds);

      return {
        appendSystemMessages,
        forcedToolCall,
        decision: typeof parsed.decision === 'string' ? parsed.decision : 'none',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'unknown');
      this.logger.warn(`[before_step_hook_failed] error=${message}`);
      return {
        appendSystemMessages: [],
        decision: 'none',
      };
    }
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

  private normalizeForcedToolCall(
    forcedToolCall: unknown,
    assignedToolIds: string[],
  ): { tool: string; parameters: Record<string, unknown>; reason: string } | undefined {
    if (!forcedToolCall || typeof forcedToolCall !== 'object') {
      return undefined;
    }

    const rawTool = String((forcedToolCall as Record<string, unknown>).tool || '').trim();
    const tool = normalizeToolId(rawTool);
    const allowedToolSet = new Set(assignedToolIds.map((item) => normalizeToolId(item)));
    if (!tool || !allowedToolSet.has(tool)) {
      return undefined;
    }

    const parameters = (forcedToolCall as Record<string, unknown>).parameters;
    const reason = String((forcedToolCall as Record<string, unknown>).reason || 'llm_before_step_hook').trim();
    return {
      tool,
      parameters: parameters && typeof parameters === 'object' ? (parameters as Record<string, unknown>) : {},
      reason: reason || 'llm_before_step_hook',
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@libs/infra';
import { ChatMessage } from '../../../../../../src/shared/types';
import { ContextBlockBuilder, ContextBuildInput } from './context-block-builder.interface';

const SCORE_RULE_LABEL: Record<string, string> = {
  D1: '工具参数预检失败',
  D2: '多 tool_call 批量输出',
  D3: '连续两轮调用相同工具',
  D4: '工具执行失败（非参数类）',
  D5: '工具执行失败（参数类）',
  D6: '调用未授权工具',
  D7: 'tool_call JSON 解析失败',
  D8: '文本意图未执行',
  D9: 'Planner 纯文本重试触发',
  D10: '空/无意义响应',
  D11: '达到最大轮次上限',
  D12: 'LLM 调用超时/网络错误',
};

const SCORE_RULE_ADVICE: Record<string, string> = {
  D1: '调用工具前仔细核对参数名称、类型和必填项，严格匹配工具 schema',
  D2: '每轮输出且只输出一个 <tool_call>，等收到结果后再发下一个，多步任务分轮完成',
  D3: '如果上一轮已调用某工具，本轮换一个不同工具或变更参数后再调用',
  D4: '执行工具前确认参数正确性，注意异常处理',
  D5: '仔细阅读工具参数说明，确保输入格式和类型正确',
  D6: '只调用已授权的工具，不要尝试调用未分配的工具',
  D7: '严格按照 JSON 格式输出 tool_call，确保语法正确',
  D8: '如果计划执行工具操作，必须直接输出 <tool_call> 而非文字描述意图',
  D9: '直接输出 <tool_call> 开始执行，不要先输出确认性文字（如"好的"、"我来执行"）',
  D10: '每次回复必须包含有实质意义的内容或工具调用',
  D11: '高效完成任务，避免无效循环消耗轮次配额',
  D12: '此为系统层面错误（超时/网络），非你直接控制，但请尽量精简请求',
};

/**
 * 根据 roleInPlan 判定当前执行阶段类别。
 * - 'multi_step': initialize 等需要多轮工具调用的阶段，D2/D9 提示弱化为"分轮完成"
 * - 'single_step': generating/pre/post 等单步阶段，D2/D9 提示保持强调
 * - 'none': 非 planner 场景
 */
type PhaseCategory = 'multi_step' | 'single_step' | 'none';

function resolvePhaseCategory(roleInPlan: string): PhaseCategory {
  if (!roleInPlan) return 'none';
  if (roleInPlan === 'planner_initialize') return 'multi_step';
  if (roleInPlan.startsWith('planner')) return 'single_step';
  return 'none';
}

interface RecentDeductionSnapshot {
  ruleId: string;
  toolId?: string;
  detail?: string;
  round: number;
  score: number;
  runCreatedAt: string;
}

interface DeductionCacheItem {
  content?: string;
  payload?: {
    historySummary?: {
      totalRuns?: number;
      totalScoreSum?: number;
      ruleFrequency?: Record<string, { count: number; totalPoints: number }>;
      recentDeductions?: RecentDeductionSnapshot[];
    };
  };
}

@Injectable()
export class DeductionContextBuilder implements ContextBlockBuilder {
  private readonly logger = new Logger(DeductionContextBuilder.name);

  readonly layer = 'deduction' as const;
  readonly meta = { scope: 'run', stability: 'dynamic' } as const;

  constructor(private readonly redisService: RedisService) {}

  shouldInject(input: ContextBuildInput): boolean {
    return Boolean(input.agent.id);
  }

  async build(input: ContextBuildInput): Promise<ChatMessage[]> {
    const agentId = String(input.agent.id || '').trim();
    if (!agentId) return [];

    try {
      const deductionMemo = await this.loadDeductionFromCache(agentId);
      if (!deductionMemo) return [];

      const collaborationCtx = (input.context.collaborationContext || {}) as Record<string, unknown>;
      const roleInPlan = String(collaborationCtx.roleInPlan || '').trim();

      const prompt = this.buildDeductionPrompt(deductionMemo, roleInPlan);
      if (!prompt) return [];

      return [
        {
          role: 'system',
          content: prompt,
          timestamp: new Date(),
        },
      ];
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to load deduction context for agent ${agentId}: ${message}`);
      return [];
    }
  }

  private async loadDeductionFromCache(agentId: string): Promise<DeductionCacheItem | null> {
    const key = `memo:${agentId}:deduction`;
    const cached = await this.redisService.get(key);
    if (!cached) return null;

    try {
      const parsed = JSON.parse(cached);
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      if (items.length === 0) return null;
      return items[0] as DeductionCacheItem;
    } catch {
      return null;
    }
  }

  private buildDeductionPrompt(memo: DeductionCacheItem, roleInPlan: string): string {
    const historySummary = memo.payload?.historySummary;
    if (!historySummary || !historySummary.ruleFrequency) return '';

    const ruleFrequency = historySummary.ruleFrequency;
    const sortedRules = Object.entries(ruleFrequency)
      .filter(([, stat]) => stat.count > 0)
      .sort(([, a], [, b]) => b.count - a.count);

    if (sortedRules.length === 0) return '';

    const totalRuns = historySummary.totalRuns || 0;
    const avgScore = totalRuns > 0
      ? Math.round(((historySummary.totalScoreSum || 0) / totalRuns) * 10) / 10
      : 0;

    // multi_step 阶段（如 initialize）降低 D2/D9 的强调权重
    const phaseCategory = resolvePhaseCategory(roleInPlan);
    const suppressedRules = phaseCategory === 'multi_step' ? new Set(['D2', 'D9']) : new Set<string>();

    const lines: string[] = [];
    lines.push('【执行质量提醒】');
    lines.push('');
    lines.push(`历史 ${totalRuns} 次执行平均得分：${avgScore} 分。`);
    lines.push('');

    // Part 1: 高频错误 + 阶段感知建议
    lines.push('## 高频错误与改进要求');
    lines.push('');
    const topRules = sortedRules
      .filter(([ruleId]) => !suppressedRules.has(ruleId))
      .slice(0, 5);
    for (let i = 0; i < topRules.length; i++) {
      const [ruleId, stat] = topRules[i];
      const label = SCORE_RULE_LABEL[ruleId] || ruleId;
      const advice = SCORE_RULE_ADVICE[ruleId] || '';
      lines.push(`${i + 1}. 【${ruleId} ${label} | 触发 ${stat.count} 次 累计 ${stat.totalPoints} 分】`);
      if (advice) {
        lines.push(`   要求：${advice}`);
      }
    }
    lines.push('');

    // Part 2: 近期具体错误案例（排除被抑制的规则）
    const recentDeductions = historySummary.recentDeductions || [];
    const casesWithDetail = recentDeductions.filter(
      (d) => d.detail && !suppressedRules.has(d.ruleId),
    );
    if (casesWithDetail.length > 0) {
      lines.push('## 近期具体错误案例（务必避免重现）');
      lines.push('');
      const shownCases = casesWithDetail.slice(0, 8);
      for (const item of shownCases) {
        const label = SCORE_RULE_LABEL[item.ruleId] || item.ruleId;
        const toolInfo = item.toolId ? ` tool=${item.toolId}` : '';
        lines.push(`- [${item.ruleId}] ${label}${toolInfo}: ${item.detail}`);
      }
      lines.push('');
    }

    // Part 3: 阶段感知的行为指引
    if (phaseCategory === 'multi_step') {
      lines.push('当前是多步工具调用阶段。正确做法：每轮输出一个 <tool_call>，等收到执行结果后再输出下一个。多步任务分轮依次完成，不要跳过工具调用直接输出文本。');
    } else if (phaseCategory === 'single_step') {
      lines.push('当前是单步阶段。直接输出一个 <tool_call> 完成操作，不要输出确认性文字或多个 tool_call。');
    } else {
      lines.push('每轮输出一个 <tool_call> 并等待结果，多步任务分轮完成。');
    }

    return lines.join('\n');
  }
}

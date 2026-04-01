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
  D1: '调用工具前仔细检查参数格式和必填项，确保符合工具 schema 要求',
  D2: '每次只输出一个 tool_call，不要批量输出多个工具调用',
  D3: '避免连续两轮调用同一个工具；如需重试请变更参数或先执行其他步骤',
  D4: '执行工具前确认参数正确性，注意异常处理',
  D5: '仔细阅读工具参数说明，确保输入格式和类型正确',
  D6: '只调用已授权的工具，不要尝试调用未分配的工具',
  D7: '严格按照 JSON 格式输出 tool_call，确保语法正确',
  D8: '如果计划执行工具操作，必须输出对应的 tool_call 而非纯文本描述',
  D9: '作为 Planner 时必须输出结构化指令，避免纯文本回复',
  D10: '每次回复必须包含有实质意义的内容或工具调用',
  D11: '高效完成任务，避免无效循环消耗轮次配额',
  D12: '此为系统层面错误（超时/网络），非你直接控制，但请尽量精简请求',
};

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

      const prompt = this.buildDeductionPrompt(deductionMemo);
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

  private buildDeductionPrompt(memo: DeductionCacheItem): string {
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

    const lines: string[] = [];
    lines.push('【执行质量提醒 - 历史扣分分析】');
    lines.push('');
    lines.push(`历史 ${totalRuns} 次执行平均得分：${avgScore} 分。`);
    lines.push('');

    // Part 1: 高频错误 + 建议
    lines.push('## 高频错误与改进要求');
    lines.push('');
    const topRules = sortedRules.slice(0, 5);
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

    // Part 2: 近期具体错误案例
    const recentDeductions = historySummary.recentDeductions || [];
    const casesWithDetail = recentDeductions.filter((d) => d.detail);
    if (casesWithDetail.length > 0) {
      lines.push('## 近期具体错误案例（从真实执行中提取，务必避免重现）');
      lines.push('');
      const shownCases = casesWithDetail.slice(0, 8);
      for (const item of shownCases) {
        const label = SCORE_RULE_LABEL[item.ruleId] || item.ruleId;
        const toolInfo = item.toolId ? ` tool=${item.toolId}` : '';
        lines.push(`- [${item.ruleId}] ${label}${toolInfo}: ${item.detail}`);
      }
      lines.push('');
    }

    lines.push('在每次输出前自检上述问题。严格遵守：每轮只输出一个 tool_call；不连续调用同一工具；Planner 必须输出 tool_call 而非纯文本。');

    return lines.join('\n');
  }
}

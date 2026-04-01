import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { RedisService } from '@libs/infra';
import { AgentRunScore, AgentRunScoreDocument } from '../../schemas/agent-run-score.schema';
import { AgentMemo, AgentMemoDocument } from '../../schemas/agent-memo.schema';
import { AGENT_RUN_SCORE_RULE_POINTS, ScoreRuleId } from '../runtime/task-execution-scorer';

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

interface RuleStat {
  ruleId: string;
  count: number;
  totalPoints: number;
}

interface HistorySummaryPayload {
  totalRuns: number;
  totalScoreSum: number;
  ruleFrequency: Record<string, { count: number; totalPoints: number }>;
  lastAggregatedAt: string;
}

@Injectable()
export class DeductionAggregationService {
  private readonly logger = new Logger(DeductionAggregationService.name);

  constructor(
    @InjectModel(AgentRunScore.name) private readonly scoreModel: Model<AgentRunScoreDocument>,
    @InjectModel(AgentMemo.name) private readonly memoModel: Model<AgentMemoDocument>,
    private readonly redisService: RedisService,
  ) {}

  async aggregateDeductions(agentId: string): Promise<void> {
    this.logger.log(`Starting deduction aggregation for agent: ${agentId}`);

    try {
      const existingMemo = await this.memoModel.findOne({ agentId, memoKind: 'deduction' }).exec();
      const previousPayload = (existingMemo?.payload as Record<string, any>) || {};
      const previousHistory: HistorySummaryPayload = previousPayload.historySummary || {
        totalRuns: 0,
        totalScoreSum: 0,
        ruleFrequency: {},
        lastAggregatedAt: '',
      };

      const [recentRuns, twoDayStats, incrementalScores] = await Promise.all([
        this.getRecentRunScores(agentId, 10),
        this.getTwoDayRuleStats(agentId),
        this.getIncrementalScores(agentId, previousHistory.lastAggregatedAt),
      ]);

      const updatedHistory = this.mergeHistorySummary(previousHistory, incrementalScores);
      const content = this.buildDeductionContent(recentRuns, twoDayStats, updatedHistory);

      await this.updateDeductionMemo(agentId, content, updatedHistory, existingMemo);
      await this.refreshDeductionCache(agentId);

      this.logger.log(`Deduction aggregation completed for agent: ${agentId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Deduction aggregation failed for agent ${agentId}: ${message}`);
    }
  }

  private async getRecentRunScores(agentId: string, limit: number): Promise<AgentRunScore[]> {
    return this.scoreModel
      .find({ agentId, totalDeductions: { $gt: 0 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  private async getTwoDayRuleStats(agentId: string): Promise<RuleStat[]> {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    return this.scoreModel
      .aggregate([
        { $match: { agentId, createdAt: { $gte: twoDaysAgo } } },
        { $unwind: '$deductions' },
        {
          $group: {
            _id: '$deductions.ruleId',
            count: { $sum: 1 },
            totalPoints: { $sum: '$deductions.points' },
          },
        },
        { $sort: { count: -1, _id: 1 } },
      ])
      .exec()
      .then((rows) =>
        rows.map((row: { _id: string; count: number; totalPoints: number }) => ({
          ruleId: row._id,
          count: row.count,
          totalPoints: row.totalPoints,
        })),
      );
  }

  private async getIncrementalScores(
    agentId: string,
    lastAggregatedAt: string,
  ): Promise<AgentRunScore[]> {
    const query: Record<string, unknown> = { agentId };
    if (lastAggregatedAt) {
      query.createdAt = { $gt: new Date(lastAggregatedAt) };
    }
    return this.scoreModel.find(query).lean().exec();
  }

  private mergeHistorySummary(
    previous: HistorySummaryPayload,
    incrementalScores: AgentRunScore[],
  ): HistorySummaryPayload {
    let totalRuns = previous.totalRuns;
    let totalScoreSum = previous.totalScoreSum;
    const ruleFrequency = { ...previous.ruleFrequency };

    for (const score of incrementalScores) {
      totalRuns += 1;
      totalScoreSum += score.score;

      for (const deduction of score.deductions || []) {
        const ruleId = deduction.ruleId;
        if (!ruleFrequency[ruleId]) {
          ruleFrequency[ruleId] = { count: 0, totalPoints: 0 };
        }
        ruleFrequency[ruleId].count += 1;
        ruleFrequency[ruleId].totalPoints += deduction.points;
      }
    }

    return {
      totalRuns,
      totalScoreSum,
      ruleFrequency,
      lastAggregatedAt: new Date().toISOString(),
    };
  }

  private buildDeductionContent(
    recentRuns: AgentRunScore[],
    twoDayStats: RuleStat[],
    history: HistorySummaryPayload,
  ): string {
    const lines: string[] = [];

    lines.push('# 执行扣分记录', '');

    // Section 1: 近期扣分明细
    lines.push('## 近期扣分明细（最近有扣分的 Run）', '');
    if (recentRuns.length > 0) {
      lines.push('| 时间 | 得分 | 扣分项 | 关键扣分详情 |');
      lines.push('|------|------|--------|-------------|');

      for (const run of recentRuns) {
        const runCreatedAt = (run as any).createdAt;
        const time = runCreatedAt
          ? new Date(runCreatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
          : 'N/A';
        const deductionItems = this.summarizeDeductionsByRule(run.deductionsByRule);
        const keyDetails = this.extractKeyDetails(run.deductions || [], 2);
        lines.push(`| ${time} | ${run.score} | ${deductionItems} | ${keyDetails} |`);
      }
    } else {
      lines.push('暂无扣分记录。');
    }
    lines.push('');

    // Section 2: 近 2 天扣分统计
    lines.push('## 近 2 天扣分统计（按规则汇总）', '');
    if (twoDayStats.length > 0) {
      lines.push('| 规则 | 描述 | 触发次数 | 累计扣分 |');
      lines.push('|------|------|---------|---------|');

      for (const stat of twoDayStats) {
        const label = SCORE_RULE_LABEL[stat.ruleId] || stat.ruleId;
        lines.push(`| ${stat.ruleId} | ${label} | ${stat.count} | ${stat.totalPoints} |`);
      }
    } else {
      lines.push('近 2 天无扣分记录。');
    }
    lines.push('');

    // Section 3: 历史总结
    lines.push('## 历史扣分统计', '');
    const avgScore = history.totalRuns > 0
      ? Math.round((history.totalScoreSum / history.totalRuns) * 10) / 10
      : 0;
    lines.push(`- **总评分次数**：${history.totalRuns}`);
    lines.push(`- **历史平均得分**：${avgScore}`);
    lines.push('');

    const sortedRules = Object.entries(history.ruleFrequency)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 8);
    if (sortedRules.length > 0) {
      lines.push('### 最常触发规则 (Top 8)', '');
      lines.push('| 规则 | 描述 | 历史触发次数 | 历史累计扣分 |');
      lines.push('|------|------|-------------|-------------|');
      for (const [ruleId, stat] of sortedRules) {
        const label = SCORE_RULE_LABEL[ruleId] || ruleId;
        lines.push(`| ${ruleId} | ${label} | ${stat.count} | ${stat.totalPoints} |`);
      }
    }
    lines.push('');

    lines.push('## 元信息', '');
    lines.push(`- lastAggregatedAt: ${history.lastAggregatedAt}`);
    lines.push(`- sources: [agent_run_scores]`);

    return lines.join('\n');
  }

  private summarizeDeductionsByRule(
    deductionsByRule: Record<string, { count: number; totalPoints: number }>,
  ): string {
    if (!deductionsByRule || Object.keys(deductionsByRule).length === 0) return '-';
    return Object.entries(deductionsByRule)
      .map(([ruleId, stat]) => `${ruleId}(${stat.totalPoints})`)
      .join(' ');
  }

  private extractKeyDetails(
    deductions: Array<{ ruleId: string; detail?: string; toolId?: string }>,
    limit: number,
  ): string {
    const withDetail = deductions.filter((d) => d.detail || d.toolId);
    if (withDetail.length === 0) return '-';
    return withDetail
      .slice(0, limit)
      .map((d) => {
        const label = SCORE_RULE_LABEL[d.ruleId] || d.ruleId;
        const info = d.detail || d.toolId || '';
        return `${label}: ${this.compact(info, 40)}`;
      })
      .join('; ');
  }

  private compact(text: string, maxLength: number): string {
    if (!text) return '';
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return normalized.slice(0, Math.max(0, maxLength - 3)) + '...';
  }

  private async updateDeductionMemo(
    agentId: string,
    content: string,
    historySummary: HistorySummaryPayload,
    existingMemo: AgentMemoDocument | null,
  ): Promise<void> {
    const now = new Date();
    const slug = 'deduction-history';

    if (existingMemo) {
      const nextVersion = Math.max(1, Number(existingMemo.version || 1)) + 1;
      await this.memoModel
        .findOneAndUpdate(
          { id: existingMemo.id },
          {
            $set: {
              content,
              version: nextVersion,
              payload: {
                topic: 'deduction',
                historySummary,
              },
              tags: ['deduction', 'scoring', 'penalty'],
              contextKeywords: ['deduction', 'scoring', 'penalty', 'error', 'mistake'],
              source: 'deduction-aggregator',
              updatedAt: now,
            },
          },
          { new: true },
        )
        .exec();
    } else {
      await this.memoModel
        .create({
          id: uuidv4(),
          agentId,
          title: '执行扣分记录',
          slug,
          content,
          version: 1,
          memoKind: 'deduction',
          memoType: 'standard',
          payload: {
            topic: 'deduction',
            historySummary,
          },
          tags: ['deduction', 'scoring', 'penalty'],
          contextKeywords: ['deduction', 'scoring', 'penalty', 'error', 'mistake'],
          source: 'deduction-aggregator',
          createdAt: now,
          updatedAt: now,
        })
        .catch((err) => {
          if (err.code === 11000) {
            this.logger.warn(`Deduction memo already exists for agent ${agentId}, skipping`);
          } else {
            throw err;
          }
        });
    }
  }

  private async refreshDeductionCache(agentId: string): Promise<void> {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) return;
    const items = await this.memoModel
      .find({ agentId: normalizedAgentId, memoKind: 'deduction' })
      .sort({ updatedAt: -1 })
      .limit(200)
      .exec();
    const payload = {
      agentId: normalizedAgentId,
      memoKind: 'deduction',
      items,
      updatedAt: new Date().toISOString(),
    };
    await this.redisService.set(`memo:${normalizedAgentId}:deduction`, JSON.stringify(payload));
  }
}

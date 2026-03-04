import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AgentRun, AgentRunDocument } from '../../schemas/agent-run.schema';
import { AgentPart, AgentPartDocument } from '../../schemas/agent-part.schema';
import { AgentMemo, AgentMemoDocument } from '../../schemas/agent-memo.schema';

interface EvaluationData {
  toolStats: ToolUsageStat[];
  slaMetrics: SlaMetrics;
}

interface ToolUsageStat {
  toolId: string;
  usageCount: number;
  successCount: number;
  successRate: number;
}

interface SlaMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  completionRate: number;
  avgResponseTimeSeconds?: number;
}

@Injectable()
export class EvaluationAggregationService {
  private readonly logger = new Logger(EvaluationAggregationService.name);

  constructor(
    @InjectModel(AgentRun.name) private readonly runModel: Model<AgentRunDocument>,
    @InjectModel(AgentPart.name) private readonly partModel: Model<AgentPartDocument>,
    @InjectModel(AgentMemo.name) private readonly memoModel: Model<AgentMemoDocument>,
  ) {}

  async aggregateEvaluation(agentId: string, period?: { start: Date; end: Date }): Promise<void> {
    this.logger.log(`Starting evaluation aggregation for agent: ${agentId}`);

    try {
      const { start, end } = period || this.getCurrentMonth();

      const [toolStats, slaMetrics] = await Promise.all([
        this.getToolUsageStats(agentId, start, end),
        this.getSlaMetrics(agentId, start, end),
      ]);

      const content = this.buildEvaluationContent({ toolStats, slaMetrics }, start, end);

      await this.updateEvaluationMemo(agentId, content, {
        lastAggregatedAt: new Date().toISOString(),
        period: {
          start: start.toISOString(),
          end: end.toISOString(),
        },
      });

      this.logger.log(`Evaluation aggregation completed for agent: ${agentId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Evaluation aggregation failed for agent ${agentId}: ${message}`);
      throw error;
    }
  }

  private getCurrentMonth(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return { start, end };
  }

  private async getToolUsageStats(
    agentId: string,
    start: Date,
    end: Date,
  ): Promise<ToolUsageStat[]> {
    const runs = await this.runModel
      .find({
        agentId,
        createdAt: { $gte: start, $lte: end },
        status: { $in: ['completed', 'failed'] },
      })
      .exec();

    const runIds = runs.map((r) => r.id);

    if (runIds.length === 0) {
      return [];
    }

    const toolResults = await this.partModel
      .find({
        runId: { $in: runIds },
        type: 'tool_result',
      })
      .exec();

    const toolMap = new Map<string, { total: number; success: number }>();

    for (const part of toolResults) {
      const toolId = part.toolId || 'unknown';
      const existing = toolMap.get(toolId) || { total: 0, success: 0 };
      existing.total += 1;

      if (part.status === 'completed' && !part.error) {
        existing.success += 1;
      }

      toolMap.set(toolId, existing);
    }

    return Array.from(toolMap.entries())
      .map(([toolId, stats]) => ({
        toolId,
        usageCount: stats.total,
        successCount: stats.success,
        successRate: stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0,
      }))
      .sort((a, b) => b.usageCount - a.usageCount);
  }

  private async getSlaMetrics(agentId: string, start: Date, end: Date): Promise<SlaMetrics> {
    const runs = await this.runModel
      .find({
        agentId,
        createdAt: { $gte: start, $lte: end },
      })
      .exec();

    const totalTasks = runs.length;
    const completedTasks = runs.filter((r) => r.status === 'completed').length;
    const failedTasks = runs.filter((r) => r.status === 'failed').length;

    const runsWithDuration = runs.filter((r) => r.startedAt && r.finishedAt);
    const totalDuration = runsWithDuration.reduce((sum, r) => {
      const duration = new Date(r.finishedAt!).getTime() - new Date(r.startedAt!).getTime();
      return sum + duration;
    }, 0);
    const avgResponseTimeSeconds =
      runsWithDuration.length > 0 ? Math.round(totalDuration / runsWithDuration.length / 1000) : undefined;

    return {
      totalTasks,
      completedTasks,
      failedTasks,
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      avgResponseTimeSeconds,
    };
  }

  private buildEvaluationContent(data: EvaluationData, start: Date, end: Date): string {
    const { toolStats, slaMetrics } = data;

    const lines: string[] = [];

    lines.push('# 工作评估', '');

    const periodStr = `${start.toLocaleDateString('zh-CN')} ~ ${end.toLocaleDateString('zh-CN')}`;
    lines.push(`**评估周期**：${periodStr}`, '');

    lines.push('## 工具使用统计', '');

    if (toolStats.length > 0) {
      lines.push('| 工具 | 使用次数 | 成功次数 | 成功率 |');
      lines.push('|-----|---------|---------|--------|');

      for (const stat of toolStats) {
        lines.push(`| ${stat.toolId} | ${stat.usageCount} | ${stat.successCount} | ${stat.successRate}% |`);
      }
      lines.push('');
    } else {
      lines.push('暂无工具使用记录', '');
    }

    lines.push('## SLA 响应指标', '');
    lines.push(`- **总任务数**：${slaMetrics.totalTasks}`);
    lines.push(`- **完成数**：${slaMetrics.completedTasks}`);
    lines.push(`- **失败数**：${slaMetrics.failedTasks}`);
    lines.push(`- **完成率**：${slaMetrics.completionRate}%`);
    if (slaMetrics.avgResponseTimeSeconds !== undefined) {
      lines.push(`- **平均响应时间**：${slaMetrics.avgResponseTimeSeconds} 秒`);
    }
    lines.push('');

    lines.push('## 元信息', '');
    lines.push(`- version: ${Date.now()}`);
    lines.push(`- lastAggregatedAt: ${new Date().toISOString()}`);
    lines.push(`- period: ${periodStr}`);
    lines.push(`- sources: [agent_runs, agent_parts]`);

    return lines.join('\n');
  }

  private async updateEvaluationMemo(
    agentId: string,
    content: string,
    metadata: Record<string, any>,
  ): Promise<void> {
    const period = metadata.period;
    const periodKey = period ? `${period.start.slice(0, 7)}` : new Date().toISOString().slice(0, 7);
    const slug = `evaluation-${periodKey}`;

    const existing = await this.memoModel.findOne({ agentId, slug }).exec();
    const now = new Date();

    if (existing) {
      const nextVersion = Math.max(1, Number(existing.version || 1)) + 1;
      await this.memoModel
        .findOneAndUpdate(
          { id: existing.id },
          {
            $set: {
              content,
              version: nextVersion,
              payload: {
                topic: 'evaluation',
                ...metadata,
              },
              tags: ['evaluation', 'metrics'],
              contextKeywords: ['evaluation', 'tool', 'sla', 'metric'],
              source: 'evaluation-aggregator',
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
          title: `工作评估 ${periodKey}`,
          slug,
          content,
          version: 1,
          memoKind: 'evaluation',
          memoType: 'standard',
          payload: {
            topic: 'evaluation',
            ...metadata,
          },
          tags: ['evaluation', 'metrics'],
          contextKeywords: ['evaluation', 'tool', 'sla', 'metric'],
          source: 'evaluation-aggregator',
          createdAt: now,
          updatedAt: now,
        })
        .catch((err) => {
          if (err.code === 11000) {
            this.logger.warn(`Evaluation memo already exists for agent ${agentId} period ${periodKey}, skipping`);
          } else {
            throw err;
          }
        });
    }
  }
}

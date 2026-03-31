import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AgentRunScore, AgentRunScoreDocument } from '@agent/schemas/agent-run-score.schema';
import { TaskExecutionScoreSummary } from './task-execution-scorer';

@Injectable()
export class AgentRunScoreService {
  private readonly logger = new Logger(AgentRunScoreService.name);

  constructor(
    @InjectModel(AgentRunScore.name)
    private readonly scoreModel: Model<AgentRunScoreDocument>,
  ) {}

  async saveScore(input: {
    runId: string;
    agentId: string;
    taskId?: string;
    sessionId?: string;
    summary: TaskExecutionScoreSummary;
  }): Promise<void> {
    try {
      await this.scoreModel
        .updateOne(
          { runId: input.runId },
          {
            $setOnInsert: {
              id: `run-score-${uuidv4()}`,
              runId: input.runId,
            },
            $set: {
              agentId: input.agentId,
              taskId: input.taskId,
              sessionId: input.sessionId,
              score: input.summary.score,
              baseScore: input.summary.baseScore,
              totalDeductions: input.summary.totalDeductions,
              stats: input.summary.stats,
              deductionsByRule: input.summary.deductionsByRule,
              deductions: input.summary.deductions,
              ruleVersion: input.summary.ruleVersion,
            },
          },
          { upsert: true },
        )
        .exec();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'unknown');
      this.logger.warn(`[save_run_score_failed] runId=${input.runId} agentId=${input.agentId} error=${message}`);
    }
  }

  async getScoreByRunId(runId: string): Promise<AgentRunScore | null> {
    return this.scoreModel.findOne({ runId }).lean().exec();
  }

  async getScoresByAgent(
    agentId: string | undefined,
    filter?: {
      from?: Date;
      to?: Date;
      minScore?: number;
      maxScore?: number;
      page?: number;
      pageSize?: number;
    },
  ): Promise<{ total: number; page: number; pageSize: number; items: AgentRunScore[] }> {
    const page = Math.max(1, Number(filter?.page || 1));
    const pageSize = Math.max(1, Math.min(200, Number(filter?.pageSize || 20)));
    const query = this.buildFilterQuery(agentId, filter);

    const [total, items] = await Promise.all([
      this.scoreModel.countDocuments(query).exec(),
      this.scoreModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean()
        .exec(),
    ]);

    return {
      total,
      page,
      pageSize,
      items,
    };
  }

  async getAgentScoreStats(
    agentId: string | undefined,
    period?: {
      from?: Date;
      to?: Date;
      topN?: number;
    },
  ): Promise<{
    totalRuns: number;
    averageScore: number;
    minScore: number;
    maxScore: number;
    ruleFrequencyTop: Array<{ ruleId: string; count: number; totalPoints: number }>;
  }> {
    const query = this.buildFilterQuery(agentId, {
      from: period?.from,
      to: period?.to,
    });
    const topN = Math.max(1, Math.min(20, Number(period?.topN || 5)));

    const [summaryRows, ruleRows] = await Promise.all([
      this.scoreModel
        .aggregate([
          { $match: query },
          {
            $group: {
              _id: null,
              totalRuns: { $sum: 1 },
              averageScore: { $avg: '$score' },
              minScore: { $min: '$score' },
              maxScore: { $max: '$score' },
            },
          },
        ])
        .exec(),
      this.scoreModel
        .aggregate([
          { $match: query },
          { $unwind: '$deductions' },
          {
            $group: {
              _id: '$deductions.ruleId',
              count: { $sum: 1 },
              totalPoints: { $sum: '$deductions.points' },
            },
          },
          { $sort: { count: -1, _id: 1 } },
          { $limit: topN },
        ])
        .exec(),
    ]);

    const summary = summaryRows?.[0];
    return {
      totalRuns: Number(summary?.totalRuns || 0),
      averageScore: Number(summary?.averageScore || 0),
      minScore: Number(summary?.minScore || 0),
      maxScore: Number(summary?.maxScore || 0),
      ruleFrequencyTop: (ruleRows || []).map((row: { _id: string; count: number; totalPoints: number }) => ({
        ruleId: row._id,
        count: row.count,
        totalPoints: row.totalPoints,
      })),
    };
  }

  private buildFilterQuery(
    agentId: string | undefined,
    filter?: {
      from?: Date;
      to?: Date;
      minScore?: number;
      maxScore?: number;
    },
  ): Record<string, unknown> {
    const query: Record<string, unknown> = {};
    if (agentId) {
      query.agentId = agentId;
    }

    const createdAtRange: Record<string, Date> = {};
    if (filter?.from) {
      createdAtRange.$gte = filter.from;
    }
    if (filter?.to) {
      createdAtRange.$lte = filter.to;
    }
    if (Object.keys(createdAtRange).length > 0) {
      query.createdAt = createdAtRange;
    }

    const scoreRange: Record<string, number> = {};
    if (typeof filter?.minScore === 'number' && Number.isFinite(filter.minScore)) {
      scoreRange.$gte = filter.minScore;
    }
    if (typeof filter?.maxScore === 'number' && Number.isFinite(filter.maxScore)) {
      scoreRange.$lte = filter.maxScore;
    }
    if (Object.keys(scoreRange).length > 0) {
      query.score = scoreRange;
    }

    return query;
  }
}

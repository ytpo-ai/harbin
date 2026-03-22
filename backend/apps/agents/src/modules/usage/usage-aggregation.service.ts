import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentMessage, AgentMessageDocument } from '../../schemas/agent-message.schema';
import { Agent, AgentDocument } from '../../schemas/agent.schema';
import { ModelRegistry, ModelRegistryDocument } from '../../schemas/model-registry.schema';
import {
  UsageDailySnapshot,
  UsageDailySnapshotDocument,
} from '../../schemas/usage-daily-snapshot.schema';

type UsagePeriod = 'week' | 'month';

interface DateRange {
  from: Date;
  to: Date;
}

@Injectable()
export class UsageAggregationService implements OnModuleInit {
  private readonly logger = new Logger(UsageAggregationService.name);
  private dailySnapshotTimer?: NodeJS.Timeout;
  private lastDailySnapshotDate?: string;

  constructor(
    @InjectModel(AgentMessage.name)
    private readonly agentMessageModel: Model<AgentMessageDocument>,
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
    @InjectModel(ModelRegistry.name)
    private readonly modelRegistryModel: Model<ModelRegistryDocument>,
    @InjectModel(UsageDailySnapshot.name)
    private readonly usageDailySnapshotModel: Model<UsageDailySnapshotDocument>,
  ) {}

  onModuleInit(): void {
    this.startDailySnapshotSchedule();
  }

  async getOverview(period: UsagePeriod = 'month') {
    const currentRange = this.resolvePeriodRange(period, new Date());
    const previousRange = this.resolvePreviousRange(currentRange);

    const [current, previous] = await Promise.all([
      this.aggregateSummaryByRange(currentRange),
      this.aggregateSummaryByRange(previousRange),
    ]);

    return {
      totalCost: current.totalCost,
      totalTokens: current.totalTokens,
      requestCount: current.requestCount,
      activeModels: current.activeModels,
      previousPeriod: {
        totalCost: previous.totalCost,
        totalTokens: previous.totalTokens,
        requestCount: previous.requestCount,
        activeModels: previous.activeModels,
      },
      period,
      from: currentRange.from.toISOString(),
      to: currentRange.to.toISOString(),
    };
  }

  async getDailyTrend(from?: string, to?: string) {
    const range = this.resolveDateRange(from, to);
    const rows = await this.aggregateDailyTrend(range);
    return rows.map((row) => ({
      date: String(row._id),
      cost: Number(row.cost || 0),
      tokens: Number(row.tokens || 0),
      requests: Number(row.requests || 0),
    }));
  }

  async getByAgent(from?: string, to?: string, limit = 10) {
    const range = this.resolveDateRange(from, to);
    const safeLimit = this.normalizeLimit(limit);

    const rows = await this.agentMessageModel.aggregate([
      { $match: this.buildMatch(range) },
      {
        $group: {
          _id: '$agentId',
          cost: { $sum: '$cost' },
          tokens: { $sum: { $ifNull: ['$tokens.total', 0] } },
          requests: { $sum: 1 },
        },
      },
      { $sort: { cost: -1 } },
      { $limit: safeLimit },
    ]);

    const agentIds = rows.map((row) => String(row._id)).filter(Boolean);
    const agents = await this.agentModel.find({ id: { $in: agentIds } }).select({ id: 1, name: 1 }).lean().exec();
    const agentNameMap = new Map(agents.map((item) => [String(item.id), String(item.name || item.id)]));

    return rows.map((row) => {
      const agentId = String(row._id || 'unknown');
      return {
        agentId,
        agentName: agentNameMap.get(agentId) || agentId,
        cost: Number(row.cost || 0),
        tokens: Number(row.tokens || 0),
        requests: Number(row.requests || 0),
      };
    });
  }

  async getByModel(from?: string, to?: string, limit = 10) {
    const range = this.resolveDateRange(from, to);
    const safeLimit = this.normalizeLimit(limit);

    const rows = await this.agentMessageModel.aggregate([
      { $match: this.buildMatch(range) },
      {
        $group: {
          _id: {
            modelId: { $ifNull: ['$modelID', 'unknown'] },
            provider: { $ifNull: ['$providerID', 'unknown'] },
          },
          cost: { $sum: '$cost' },
          tokens: { $sum: { $ifNull: ['$tokens.total', 0] } },
          requests: { $sum: 1 },
        },
      },
      { $sort: { cost: -1 } },
      { $limit: safeLimit },
    ]);

    const modelIds = rows.map((row) => String(row._id?.modelId || '')).filter(Boolean);
    const modelDocs = await this.modelRegistryModel
      .find({ $or: [{ id: { $in: modelIds } }, { model: { $in: modelIds } }] })
      .select({ id: 1, model: 1, name: 1, provider: 1 })
      .lean()
      .exec();

    const modelMap = new Map<string, { name: string; provider: string }>();
    for (const item of modelDocs) {
      const name = String(item.name || item.model || item.id);
      const provider = String(item.provider || 'unknown');
      modelMap.set(String(item.id), { name, provider });
      modelMap.set(String(item.model), { name, provider });
    }

    return rows.map((row) => {
      const modelId = String(row._id?.modelId || 'unknown');
      const provider = String(row._id?.provider || 'unknown');
      const metadata = modelMap.get(modelId);
      return {
        modelId,
        modelName: metadata?.name || modelId,
        provider: metadata?.provider || provider,
        cost: Number(row.cost || 0),
        tokens: Number(row.tokens || 0),
        requests: Number(row.requests || 0),
      };
    });
  }

  async createDailySnapshot(targetDate?: string): Promise<{
    date: string;
    rowCount: number;
    createdAt: string;
  }> {
    const date = this.normalizeDateString(targetDate) || this.getDateString(this.shiftDate(new Date(), -1));
    const range = this.resolveWholeDayRange(date);

    const rows = await this.agentMessageModel.aggregate([
      { $match: this.buildMatch(range) },
      {
        $group: {
          _id: {
            agentId: { $ifNull: ['$agentId', null] },
            modelId: { $ifNull: ['$modelID', null] },
          },
          totalCost: { $sum: '$cost' },
          input: { $sum: { $ifNull: ['$tokens.input', 0] } },
          output: { $sum: { $ifNull: ['$tokens.output', 0] } },
          reasoning: { $sum: { $ifNull: ['$tokens.reasoning', 0] } },
          cacheRead: { $sum: { $ifNull: ['$tokens.cacheRead', 0] } },
          cacheWrite: { $sum: { $ifNull: ['$tokens.cacheWrite', 0] } },
          total: { $sum: { $ifNull: ['$tokens.total', 0] } },
          requestCount: { $sum: 1 },
        },
      },
    ]);

    if (rows.length === 0) {
      return {
        date,
        rowCount: 0,
        createdAt: new Date().toISOString(),
      };
    }

    await this.usageDailySnapshotModel.deleteMany({ date }).exec();
    await this.usageDailySnapshotModel.insertMany(
      rows.map((row) => ({
        date,
        agentId: row._id?.agentId ?? null,
        modelId: row._id?.modelId ?? null,
        tokens: {
          input: Number(row.input || 0),
          output: Number(row.output || 0),
          reasoning: Number(row.reasoning || 0),
          cacheRead: Number(row.cacheRead || 0),
          cacheWrite: Number(row.cacheWrite || 0),
          total: Number(row.total || 0),
        },
        totalCost: Number(row.totalCost || 0),
        requestCount: Number(row.requestCount || 0),
      })),
    );

    return {
      date,
      rowCount: rows.length,
      createdAt: new Date().toISOString(),
    };
  }

  private async aggregateSummaryByRange(range: DateRange): Promise<{
    totalCost: number;
    totalTokens: number;
    requestCount: number;
    activeModels: number;
  }> {
    const [summary] = await this.agentMessageModel.aggregate([
      { $match: this.buildMatch(range) },
      {
        $group: {
          _id: null,
          totalCost: { $sum: '$cost' },
          totalTokens: { $sum: { $ifNull: ['$tokens.total', 0] } },
          requestCount: { $sum: 1 },
          activeModels: {
            $addToSet: {
              $ifNull: ['$modelID', '$providerID'],
            },
          },
        },
      },
    ]);

    return {
      totalCost: Number(summary?.totalCost || 0),
      totalTokens: Number(summary?.totalTokens || 0),
      requestCount: Number(summary?.requestCount || 0),
      activeModels: Array.isArray(summary?.activeModels) ? summary.activeModels.length : 0,
    };
  }

  private async aggregateDailyTrend(range: DateRange): Promise<Array<{ _id: string; cost: number; tokens: number; requests: number }>> {
    return this.agentMessageModel.aggregate([
      { $match: this.buildMatch(range) },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          cost: { $sum: '$cost' },
          tokens: { $sum: { $ifNull: ['$tokens.total', 0] } },
          requests: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
  }

  private resolvePeriodRange(period: UsagePeriod, now: Date): DateRange {
    const end = new Date(now);
    const start = new Date(now);
    const days = period === 'week' ? 7 : 30;
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    return { from: start, to: end };
  }

  private resolvePreviousRange(range: DateRange): DateRange {
    const duration = range.to.getTime() - range.from.getTime();
    const to = new Date(range.from.getTime() - 1);
    const from = new Date(to.getTime() - duration);
    return { from, to };
  }

  private resolveDateRange(from?: string, to?: string): DateRange {
    const now = new Date();
    const defaultFrom = this.shiftDate(now, -29);
    defaultFrom.setHours(0, 0, 0, 0);

    const parsedFrom = this.parseDate(from) || defaultFrom;
    const parsedTo = this.parseDate(to) || now;

    const normalizedFrom = new Date(parsedFrom);
    normalizedFrom.setHours(0, 0, 0, 0);

    const normalizedTo = new Date(parsedTo);
    normalizedTo.setHours(23, 59, 59, 999);

    if (normalizedFrom.getTime() > normalizedTo.getTime()) {
      return {
        from: defaultFrom,
        to: now,
      };
    }

    return {
      from: normalizedFrom,
      to: normalizedTo,
    };
  }

  private resolveWholeDayRange(date: string): DateRange {
    const day = this.parseDate(date) || new Date();
    const from = new Date(day);
    from.setHours(0, 0, 0, 0);
    const to = new Date(day);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }

  private buildMatch(range: DateRange): Record<string, unknown> {
    return {
      role: 'assistant',
      createdAt: { $gte: range.from, $lte: range.to },
      $or: [
        { cost: { $exists: true, $ne: null } },
        { 'tokens.total': { $gt: 0 } },
      ],
    };
  }

  private normalizeLimit(limit: number): number {
    const numeric = Number(limit);
    if (!Number.isFinite(numeric)) return 10;
    return Math.max(1, Math.min(100, Math.floor(numeric)));
  }

  private parseDate(value?: string): Date | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }
    return parsed;
  }

  private shiftDate(date: Date, delta: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + delta);
    return next;
  }

  private getDateString(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private normalizeDateString(value?: string): string | undefined {
    if (!value) return undefined;
    const date = this.parseDate(value);
    if (!date) return undefined;
    return this.getDateString(date);
  }

  private startDailySnapshotSchedule(): void {
    this.dailySnapshotTimer = setInterval(() => {
      void this.maybeRunDailySnapshot();
    }, 60 * 60 * 1000);
    this.dailySnapshotTimer.unref();
    void this.maybeRunDailySnapshot();
  }

  private async maybeRunDailySnapshot(): Promise<void> {
    const yesterday = this.getDateString(this.shiftDate(new Date(), -1));
    if (this.lastDailySnapshotDate === yesterday) {
      return;
    }

    try {
      const result = await this.createDailySnapshot(yesterday);
      this.lastDailySnapshotDate = yesterday;
      this.logger.log(`Daily usage snapshot updated date=${result.date} rows=${result.rowCount}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Daily usage snapshot failed date=${yesterday} error=${message}`);
    }
  }
}

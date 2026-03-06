import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AgentActionLog,
  AgentActionLogDocument,
  AgentActionContextType,
  AgentActionStatus,
} from '../../shared/schemas/agent-action-log.schema';

export interface QueryAgentActionLogsParams {
  from?: string;
  to?: string;
  agentId?: string;
  contextType?: string;
  contextId?: string;
  action?: string;
  status?: string;
  page?: string;
  pageSize?: string;
}

export interface AgentActionLogInput {
  agentId: string;
  contextType: AgentActionContextType;
  contextId?: string;
  action: string;
  status: AgentActionStatus;
  durationMs?: number;
  details?: Record<string, unknown>;
}

@Injectable()
export class AgentActionLogService {
  private readonly logger = new Logger(AgentActionLogService.name);

  constructor(
    @InjectModel(AgentActionLog.name)
    private readonly agentActionLogModel: Model<AgentActionLogDocument>,
  ) {}

  async record(input: AgentActionLogInput): Promise<void> {
    try {
      await this.agentActionLogModel.create({
        agentId: input.agentId,
        contextType: input.contextType,
        contextId: input.contextId,
        action: input.action,
        details: {
          ...(input.details || {}),
          status: input.status,
          durationMs: input.durationMs || 0,
        },
        timestamp: new Date(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to record agent action log: ${message}`);
    }
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private parseDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }
    return parsed;
  }

  async queryAgentActionLogs(params: QueryAgentActionLogsParams) {
    const from = this.parseDate(params.from);
    const to = this.parseDate(params.to);
    if (from && to && from.getTime() > to.getTime()) {
      return {
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
        logs: [],
        fetchedAt: new Date().toISOString(),
      };
    }

    const page = Math.max(1, Math.min(Number(params.page || 1), 10000));
    const pageSize = Math.max(1, Math.min(Number(params.pageSize || 20), 200));
    const skip = (page - 1) * pageSize;

    const filter: Record<string, any> = {};
    if (params.agentId?.trim()) {
      filter.agentId = params.agentId.trim();
    }
    if (params.contextType?.trim()) {
      filter.contextType = params.contextType.trim();
    }
    if (params.contextId?.trim()) {
      filter.contextId = params.contextId.trim();
    }
    if (params.action?.trim()) {
      filter.action = { $regex: this.escapeRegex(params.action.trim()), $options: 'i' };
    }
    if (params.status?.trim()) {
      const status = params.status.trim();
      filter.$or = [
        { 'details.status': status },
        { status },
      ];
    }

    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = from;
      if (to) filter.timestamp.$lte = to;
    }

    const [total, logs] = await Promise.all([
      this.agentActionLogModel.countDocuments(filter).exec(),
      this.agentActionLogModel
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
        .exec(),
    ]);

    return {
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      logs: logs.map((item) => ({
        id: item.id,
        agentId: item.agentId,
        contextType: item.contextType,
        contextId: item.contextId,
        action: item.action,
        details: item.details,
        timestamp: item.timestamp,
      })),
      fetchedAt: new Date().toISOString(),
    };
  }
}

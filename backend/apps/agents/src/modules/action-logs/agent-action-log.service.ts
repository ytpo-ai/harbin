import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AgentActionContextType,
  AgentActionLog,
  AgentActionLogDocument,
  AgentActionStatus,
} from '../../schemas/agent-action-log.schema';
import { AgentRun, AgentRunDocument } from '../../schemas/agent-run.schema';

interface RuntimeRunContextSnapshot {
  runId: string;
  taskTitle?: string;
  taskType?: string;
  planId?: string;
  planTitle?: string;
  meetingId?: string;
  meetingTitle?: string;
}

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
  status: AgentActionStatus | string;
  durationMs?: number;
  sourceEventId?: string;
  details?: Record<string, unknown>;
}

export interface RuntimeHookEventInput {
  eventId: string;
  eventType: string;
  agentId: string;
  sessionId?: string;
  runId: string;
  taskId?: string;
  messageId?: string;
  partId?: string;
  toolCallId?: string;
  sequence: number;
  timestamp: number;
  traceId: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class AgentActionLogService {
  private readonly logger = new Logger(AgentActionLogService.name);
  private readonly runtimeStatusMap: Record<string, AgentActionStatus> = {
    'run.started': 'started',
    'run.step.started': 'step_started',
    'run.completed': 'completed',
    'run.failed': 'failed',
    'run.paused': 'paused',
    'run.resumed': 'resumed',
    'run.cancelled': 'cancelled',
    'tool.pending': 'pending',
    'tool.running': 'running',
    'tool.completed': 'completed',
    'tool.failed': 'failed',
    'permission.asked': 'asked',
    'permission.replied': 'replied',
    'permission.denied': 'denied',
  };

  constructor(
    @InjectModel(AgentActionLog.name)
    private readonly agentActionLogModel: Model<AgentActionLogDocument>,
    @InjectModel(AgentRun.name)
    private readonly agentRunModel: Model<AgentRunDocument>,
  ) {}

  async record(input: AgentActionLogInput): Promise<void> {
    try {
      await this.agentActionLogModel.create({
        agentId: input.agentId,
        contextType: input.contextType,
        contextId: input.contextId,
        action: input.action,
        sourceEventId: input.sourceEventId,
        details: {
          ...(input.details || {}),
          status: input.status,
          durationMs: Number.isFinite(input.durationMs) ? input.durationMs : 0,
        },
        timestamp: new Date(),
      });
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to record agent action log: ${message}`);
    }
  }

  async recordRuntimeHookEvent(event: RuntimeHookEventInput): Promise<void> {
    const status = this.runtimeStatusMap[event.eventType] || 'unknown';
    const context = this.resolveRuntimeContext(event);
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
    const toolId = this.extractString(payload, 'toolId');
    const toolName = this.extractString(payload, 'toolName');
    const params = this.extractUnknown(payload, 'params') ?? this.extractUnknown(payload, 'input');

    await this.record({
      agentId: event.agentId,
      contextType: context.contextType,
      contextId: context.contextId,
      action: `runtime:${event.eventType}`,
      status,
      sourceEventId: event.eventId,
      details: {
        eventType: event.eventType,
        agentSessionId: event.sessionId,
        runId: event.runId,
        sessionId: event.sessionId,
        taskId: event.taskId,
        messageId: event.messageId,
        partId: event.partId,
        toolCallId: event.toolCallId,
        toolId,
        toolName,
        params,
        sequence: event.sequence,
        traceId: event.traceId,
        eventTimestamp: event.timestamp,
        payload,
      },
    });
  }

  private resolveRuntimeContext(event: RuntimeHookEventInput): {
    contextType: AgentActionContextType;
    contextId?: string;
  } {
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
    const meetingId = this.extractString(payload, 'meetingId');
    if (meetingId) {
      return { contextType: 'chat', contextId: meetingId };
    }

    const planId = this.extractString(payload, 'planId');
    if (planId) {
      return { contextType: 'orchestration', contextId: planId };
    }

    const sessionMeetingId = this.resolveMeetingIdFromSession(event.sessionId);
    if (sessionMeetingId) {
      return { contextType: 'chat', contextId: sessionMeetingId };
    }

    if (event.taskId) {
      return { contextType: 'orchestration', contextId: event.taskId };
    }

    const sessionTaskId = this.resolveTaskIdFromSession(event.sessionId);
    if (sessionTaskId) {
      return { contextType: 'orchestration', contextId: sessionTaskId };
    }

    return { contextType: 'chat', contextId: event.runId };
  }

  private resolveMeetingIdFromSession(sessionId?: string): string | undefined {
    if (!sessionId || !sessionId.startsWith('meeting-')) return undefined;
    const parts = sessionId.split('-');
    if (parts.length < 3) return undefined;
    return parts.slice(1, -1).join('-') || undefined;
  }

  private resolveTaskIdFromSession(sessionId?: string): string | undefined {
    if (!sessionId || !sessionId.startsWith('task-')) return undefined;
    return sessionId.slice('task-'.length) || undefined;
  }

  private extractString(payload: Record<string, unknown>, key: string): string | undefined {
    const value = payload[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private extractUnknown(payload: Record<string, unknown>, key: string): unknown {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      return undefined;
    }
    return payload[key];
  }

  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const code = (error as { code?: number }).code;
    return code === 11000;
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

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const normalized = value.trim();
    return normalized ? normalized : undefined;
  }

  private readObject(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private resolveMetadataString(metadata: Record<string, unknown>, keys: string[]): string | undefined {
    const direct = keys.map((key) => this.readString(metadata[key])).find(Boolean);
    if (direct) {
      return direct;
    }

    const firstLayer = this.readObject(metadata.collaborationContext);
    if (firstLayer) {
      const firstLayerValue = keys.map((key) => this.readString(firstLayer[key])).find(Boolean);
      if (firstLayerValue) {
        return firstLayerValue;
      }

      const secondLayer = this.readObject(firstLayer.collaborationContext);
      if (secondLayer) {
        const secondLayerValue = keys.map((key) => this.readString(secondLayer[key])).find(Boolean);
        if (secondLayerValue) {
          return secondLayerValue;
        }
      }
    }

    return undefined;
  }

  private async buildRuntimeRunContextSnapshotMap(runIds: string[]): Promise<Map<string, RuntimeRunContextSnapshot>> {
    if (!runIds.length) {
      return new Map();
    }

    const runs = await this.agentRunModel
      .find({ id: { $in: runIds } })
      .select({ id: 1, taskTitle: 1, metadata: 1 })
      .lean()
      .exec();

    const result = new Map<string, RuntimeRunContextSnapshot>();
    for (const run of runs) {
      const runId = this.readString((run as { id?: unknown }).id);
      if (!runId) {
        continue;
      }
      const metadata = this.readObject((run as { metadata?: unknown }).metadata) || {};
      const meetingContext = this.readObject(metadata.meetingContext);
      const planTitle = this.resolveMetadataString(metadata, ['planTitle', 'planName', 'title']);
      const meetingTitle =
        this.resolveMetadataString(metadata, ['meetingTitle'])
        || this.readString(meetingContext?.meetingTitle)
        || this.resolveMetadataString(metadata, ['title']);

      result.set(runId, {
        runId,
        taskTitle: this.readString((run as { taskTitle?: unknown }).taskTitle),
        taskType: this.resolveMetadataString(metadata, ['taskType']),
        planId: this.resolveMetadataString(metadata, ['planId']),
        planTitle,
        meetingId:
          this.resolveMetadataString(metadata, ['meetingId'])
          || this.readString(meetingContext?.meetingId),
        meetingTitle,
      });
    }

    return result;
  }

  private enrichLogDetails(
    details: Record<string, unknown> | undefined,
    runContext: RuntimeRunContextSnapshot | undefined,
    contextType: AgentActionContextType,
    contextId?: string,
  ): Record<string, unknown> | undefined {
    const normalizedDetails = details ? { ...details } : {};

    const taskId = this.readString(normalizedDetails.taskId);
    const explicitTaskType = this.readString(normalizedDetails.taskType);
    const runTaskType = runContext?.taskType;
    const taskType = explicitTaskType || runTaskType;
    const taskTitle = this.readString(normalizedDetails.taskTitle) || runContext?.taskTitle;
    const meetingTitle = this.readString(normalizedDetails.meetingTitle) || runContext?.meetingTitle;
    const meetingId = this.readString(normalizedDetails.meetingId) || runContext?.meetingId;
    const planId = this.readString(normalizedDetails.planId) || runContext?.planId || contextId;
    const planTitle = this.readString(normalizedDetails.planTitle) || runContext?.planTitle;

    let environmentType = this.readString(normalizedDetails.environmentType);
    if (!environmentType) {
      if (taskType === 'internal_message' || (taskId && taskId.startsWith('inner-message:'))) {
        environmentType = 'internal_message';
      } else if (contextType === 'chat' && (meetingTitle || meetingId || contextId)) {
        environmentType = 'meeting_chat';
      } else if (contextType === 'orchestration') {
        environmentType = 'orchestration_plan';
      } else {
        environmentType = 'chat';
      }
    }

    return {
      ...normalizedDetails,
      ...(taskTitle ? { taskTitle } : {}),
      ...(taskType ? { taskType } : {}),
      ...(meetingTitle ? { meetingTitle } : {}),
      ...(meetingId ? { meetingId } : {}),
      ...(planId ? { planId } : {}),
      ...(planTitle ? { planTitle } : {}),
      ...(environmentType ? { environmentType } : {}),
    };
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
      filter.$or = [{ 'details.status': status }, { status }];
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

    const runIds = Array.from(
      new Set(
        logs
          .map((item) => {
            const details = this.readObject(item.details);
            return this.readString(details?.runId);
          })
          .filter((runId): runId is string => Boolean(runId)),
      ),
    );
    const runContextMap = await this.buildRuntimeRunContextSnapshotMap(runIds);

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
        details: this.enrichLogDetails(
          this.readObject(item.details),
          runContextMap.get(this.readString(this.readObject(item.details)?.runId) || ''),
          item.contextType,
          item.contextId,
        ),
        timestamp: item.timestamp,
      })),
      fetchedAt: new Date().toISOString(),
    };
  }
}

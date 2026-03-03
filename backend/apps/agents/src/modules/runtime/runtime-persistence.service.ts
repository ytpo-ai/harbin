import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AgentRun, AgentRunDocument } from '../../schemas/agent-run.schema';
import { AgentMessage, AgentMessageDocument } from '../../schemas/agent-message.schema';
import { AgentPart, AgentPartDocument } from '../../schemas/agent-part.schema';
import { AgentEventOutbox, AgentEventOutboxDocument } from '../../schemas/agent-event-outbox.schema';
import { RuntimeEvent, RuntimeEventSchema } from './contracts/runtime-event.contract';

@Injectable()
export class RuntimePersistenceService {
  constructor(
    @InjectModel(AgentRun.name) private readonly runModel: Model<AgentRunDocument>,
    @InjectModel(AgentMessage.name) private readonly messageModel: Model<AgentMessageDocument>,
    @InjectModel(AgentPart.name) private readonly partModel: Model<AgentPartDocument>,
    @InjectModel(AgentEventOutbox.name) private readonly outboxModel: Model<AgentEventOutboxDocument>,
  ) {}

  async createRun(input: {
    agentId: string;
    agentName: string;
    sessionId?: string;
    taskId?: string;
    organizationId?: string;
    taskTitle: string;
    taskDescription: string;
    metadata?: Record<string, unknown>;
  }): Promise<AgentRun> {
    const run = new this.runModel({
      id: `run-${uuidv4()}`,
      ...input,
      status: 'running',
      currentStep: 0,
      startedAt: new Date(),
    });
    return run.save();
  }

  async updateRun(runId: string, updates: Partial<AgentRun>): Promise<void> {
    await this.runModel.updateOne({ id: runId }, { $set: updates }).exec();
  }

  async getRun(runId: string): Promise<AgentRun | null> {
    return this.runModel.findOne({ id: runId }).exec();
  }

  async findLatestActiveRun(agentId: string, sessionId?: string, taskId?: string): Promise<AgentRun | null> {
    const filter: Record<string, unknown> = {
      agentId,
      status: { $in: ['pending', 'running', 'paused'] },
    };
    if (sessionId) {
      filter.sessionId = sessionId;
    }
    if (taskId) {
      filter.taskId = taskId;
    }
    return this.runModel.findOne(filter).sort({ createdAt: -1 }).exec();
  }

  async incrementRunStep(runId: string): Promise<number> {
    const updated = await this.runModel
      .findOneAndUpdate({ id: runId }, { $inc: { currentStep: 1 } }, { new: true })
      .exec();
    return updated?.currentStep ?? 0;
  }

  async createMessage(input: {
    runId: string;
    agentId: string;
    sessionId?: string;
    taskId?: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    sequence: number;
    content: string;
    status?: 'pending' | 'streaming' | 'completed' | 'error';
    metadata?: Record<string, unknown>;
  }): Promise<AgentMessage> {
    const message = new this.messageModel({
      id: `msg-${uuidv4()}`,
      ...input,
      status: input.status || 'completed',
    });
    return message.save();
  }

  async findLatestMessageByRunAndRole(
    runId: string,
    role: 'system' | 'user' | 'assistant' | 'tool',
  ): Promise<AgentMessage | null> {
    return this.messageModel.findOne({ runId, role }).sort({ createdAt: -1 }).exec();
  }

  async createPart(input: {
    runId: string;
    messageId: string;
    sequence: number;
    type: 'text' | 'reasoning' | 'tool_call' | 'tool_result' | 'system_event';
    status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
    toolId?: string;
    toolCallId?: string;
    input?: unknown;
    output?: unknown;
    content?: string;
    metadata?: Record<string, unknown>;
    error?: string;
    startedAt?: Date;
    endedAt?: Date;
  }): Promise<AgentPart> {
    const part = new this.partModel({
      id: `part-${uuidv4()}`,
      ...input,
    });
    return part.save();
  }

  async updatePart(partId: string, updates: Partial<AgentPart>): Promise<void> {
    await this.partModel.updateOne({ id: partId }, { $set: updates }).exec();
  }

  async getPart(partId: string): Promise<AgentPart | null> {
    return this.partModel.findOne({ id: partId }).exec();
  }

  async enqueueEvent(event: RuntimeEvent): Promise<void> {
    const parsed = RuntimeEventSchema.parse(event);
    const outbox = new this.outboxModel({
      id: `outbox-${uuidv4()}`,
      eventId: parsed.eventId,
      eventType: parsed.eventType,
      runId: parsed.runId,
      agentId: parsed.agentId,
      organizationId: parsed.organizationId,
      sessionId: parsed.sessionId,
      taskId: parsed.taskId,
      messageId: parsed.messageId,
      partId: parsed.partId,
      toolCallId: parsed.toolCallId,
      sequence: parsed.sequence,
      payload: parsed.payload,
      status: 'pending',
      attempts: 0,
      timestamp: new Date(parsed.timestamp),
    });
    await outbox.save();
  }

  async markEventDispatched(eventId: string): Promise<void> {
    await this.outboxModel
      .updateOne(
        { eventId },
        {
          $set: {
            status: 'dispatched',
            dispatchedAt: new Date(),
            lastError: undefined,
          },
          $inc: { attempts: 1 },
        },
      )
      .exec();
  }

  async markEventFailed(eventId: string, error: string): Promise<void> {
    const current = await this.outboxModel.findOne({ eventId }).exec();
    const attempts = (current?.attempts || 0) + 1;
    const delayMs = Math.min(60_000, Math.max(2_000, 2_000 * Math.pow(2, Math.min(attempts, 5))));
    await this.outboxModel
      .updateOne(
        { eventId },
        {
          $set: {
            status: 'failed',
            lastError: error,
            nextRetryAt: new Date(Date.now() + delayMs),
          },
          $inc: { attempts: 1 },
        },
      )
      .exec();
  }

  async findDispatchableEvents(limit = 100): Promise<AgentEventOutbox[]> {
    return this.outboxModel
      .find({
        $or: [
          { status: 'pending' },
          {
            status: 'failed',
            nextRetryAt: { $lte: new Date() },
          },
        ],
      })
      .sort({ createdAt: 1 })
      .limit(limit)
      .exec();
  }

  async findEventsByRun(runId: string, limit = 200): Promise<AgentEventOutbox[]> {
    return this.outboxModel
      .find({ runId })
      .sort({ sequence: 1, createdAt: 1 })
      .limit(limit)
      .exec();
  }
}

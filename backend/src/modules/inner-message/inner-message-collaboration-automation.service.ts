import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RedisService } from '@libs/infra';
import { InnerMessageService, ORCHESTRATION_TASK_EVENT_HOOK_CHANNEL } from './inner-message.service';
import { Agent, AgentDocument } from '../../shared/schemas/agent.schema';

interface TaskEventPayload {
  eventType: string;
  taskId: string;
  planId?: string;
  status?: string;
  senderAgentId?: string;
  payload?: Record<string, any>;
  timestamp?: string;
}

@Injectable()
export class InnerMessageCollaborationAutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InnerMessageCollaborationAutomationService.name);
  private readonly listener = (message: string) => {
    void this.handleTaskEvent(message);
  };

  constructor(
    private readonly redisService: RedisService,
    private readonly innerMessageService: InnerMessageService,
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.redisService.subscribe(ORCHESTRATION_TASK_EVENT_HOOK_CHANNEL, this.listener);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redisService.unsubscribe(ORCHESTRATION_TASK_EVENT_HOOK_CHANNEL, this.listener);
  }

  private async handleTaskEvent(raw: string): Promise<void> {
    let event: TaskEventPayload;
    try {
      event = JSON.parse(raw) as TaskEventPayload;
    } catch {
      this.logger.warn('Ignored malformed task hook payload for collaboration automation');
      return;
    }

    if (!event?.eventType || !event?.taskId) {
      return;
    }

    if (event.eventType === 'task.created') {
      await this.handleTaskCreated(event);
      return;
    }

    if (event.eventType === 'task.completed') {
      await this.handleTaskCompleted(event);
    }
  }

  private async handleTaskCreated(event: TaskEventPayload): Promise<void> {
    const assignment = event.payload?.assignment as {
      executorType?: string;
      executorId?: string;
    } | undefined;

    const executorAgentId = String(assignment?.executorType === 'agent' ? assignment?.executorId || '' : '').trim();
    if (!executorAgentId) {
      return;
    }

    const ctoAgentId = await this.resolveCtoAgentId();
    if (!ctoAgentId) {
      return;
    }

    const direct = await this.innerMessageService.sendDirectMessage({
      senderAgentId: ctoAgentId,
      receiverAgentId: executorAgentId,
      eventType: 'task.assigned',
      title: `任务安排：${String(event.payload?.taskTitle || event.taskId)}`,
      content: `请处理任务 ${event.taskId}，完成后同步结果。`,
      payload: {
        taskId: event.taskId,
        planId: event.planId,
        sourceEventType: event.eventType,
      },
      source: 'inner-message-collaboration-automation',
      dedupKey: `auto:cto-assign:${event.taskId}:${executorAgentId}`,
    });

    await this.innerMessageService.acknowledgeMessage(direct.messageId, executorAgentId, 'delivered').catch(() => undefined);

    await this.innerMessageService.sendDirectMessage({
      senderAgentId: executorAgentId,
      receiverAgentId: ctoAgentId,
      eventType: 'task.assigned.ack',
      title: `任务已收到：${String(event.payload?.taskTitle || event.taskId)}`,
      content: `已收到任务 ${event.taskId}，开始执行。`,
      payload: {
        taskId: event.taskId,
        planId: event.planId,
        ackMessageId: direct.messageId,
      },
      source: 'inner-message-collaboration-automation',
      dedupKey: `auto:executor-ack:${event.taskId}:${executorAgentId}:${ctoAgentId}`,
    });
  }

  private async handleTaskCompleted(event: TaskEventPayload): Promise<void> {
    const senderAgentId = String(event.senderAgentId || '').trim();
    if (!senderAgentId || senderAgentId === 'orchestration-system') {
      return;
    }

    const ctoAgentId = await this.resolveCtoAgentId();
    if (!ctoAgentId || ctoAgentId === senderAgentId) {
      return;
    }

    await this.innerMessageService.sendDirectMessage({
      senderAgentId,
      receiverAgentId: ctoAgentId,
      eventType: 'task.completed.report',
      title: `任务完成汇报：${String(event.payload?.taskTitle || event.taskId)}`,
      content: `任务 ${event.taskId} 已完成，请审阅。`,
      payload: {
        taskId: event.taskId,
        planId: event.planId,
        sourceEventType: event.eventType,
      },
      source: 'inner-message-collaboration-automation',
      dedupKey: `auto:executor-report:${event.taskId}:${senderAgentId}:${ctoAgentId}`,
    });
  }

  private async resolveCtoAgentId(): Promise<string | undefined> {
    const configured = String(process.env.ORCHESTRATION_CTO_AGENT_ID || '').trim();
    if (configured) {
      return configured;
    }

    const ctoAgent = await this.agentModel
      .findOne({
        isActive: true,
        $or: [{ name: { $regex: 'cto', $options: 'i' } }, { description: { $regex: 'cto', $options: 'i' } }],
      })
      .select({ _id: 1 })
      .lean()
      .exec();

    return ctoAgent?._id?.toString() || undefined;
  }
}

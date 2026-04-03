import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  buildMessageCenterEvent,
  MESSAGE_CENTER_EVENT_SOURCE_ORCHESTRATION,
  MESSAGE_CENTER_EVENT_STREAM_KEY,
  RedisService,
} from '@libs/infra';
import { Model } from 'mongoose';
import {
  OrchestrationPlan,
  OrchestrationPlanDocument,
} from '../../../shared/schemas/orchestration-plan.schema';

@Injectable()
export class OrchestrationMessageCenterEventService {
  private readonly logger = new Logger(OrchestrationMessageCenterEventService.name);

  constructor(
    private readonly redisService: RedisService,
    @InjectModel(OrchestrationPlan.name)
    private readonly orchestrationPlanModel: Model<OrchestrationPlanDocument>,
  ) {}

  async publishTaskCompletedEvent(input: {
    planId: string;
    taskId: string;
    taskTitle: string;
    status: 'completed' | 'failed';
    summary?: string;
    error?: string;
  }): Promise<void> {
    const planId = String(input.planId || '').trim();
    const taskId = String(input.taskId || '').trim();
    if (!planId || !taskId) {
      return;
    }

    const plan = await this.orchestrationPlanModel
      .findOne({ _id: planId })
      .select({ createdBy: 1, title: 1 })
      .lean<{ createdBy?: string; title?: string }>()
      .exec();

    const receiverId = String(plan?.createdBy || '').trim();
    if (!receiverId) {
      this.logger.log(
        `Skip orchestration completion message-center event: planId=${planId} taskId=${taskId} reason=missing_receiver`,
      );
      return;
    }

    const planTitle = String(plan?.title || '').trim();
    const taskTitle = String(input.taskTitle || '').trim() || taskId;
    const statusLabel = input.status === 'completed' ? '成功' : '失败';
    const summary = String(input.summary || '').trim();
    const errorText = String(input.error || '').trim();
    const output = summary || errorText || `任务执行${statusLabel}`;
    const actionUrl = `/orchestration?planId=${encodeURIComponent(planId)}&taskId=${encodeURIComponent(taskId)}`;

    const event = buildMessageCenterEvent({
      eventType: 'orchestration.task.completed',
      source: MESSAGE_CENTER_EVENT_SOURCE_ORCHESTRATION,
      data: {
        receiverId,
        messageType: 'orchestration',
        title: `编排任务${statusLabel}`,
        content: `计划「${planTitle || planId}」中的任务「${taskTitle}」执行${statusLabel}。${output}`,
        bizKey: `orchestration:${planId}:${taskId}:${input.status}`,
        actionUrl,
        priority: input.status === 'failed' ? 'high' : 'normal',
        extra: {
          planId,
          taskId,
          taskTitle,
          status: input.status,
          summary,
          error: errorText || undefined,
        },
      },
    });

    try {
      await this.redisService.xadd(
        MESSAGE_CENTER_EVENT_STREAM_KEY,
        {
          event: JSON.stringify(event),
        },
        {
          maxLen: 10000,
        },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'unknown');
      this.logger.warn(
        `Publish orchestration task completion message-center event failed (non-blocking): planId=${planId} taskId=${taskId} reason=${reason}`,
      );
    }
  }
}

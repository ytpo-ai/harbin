import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ChannelEventEnvelope,
  RedisService,
  validateChannelEventEnvelope,
  MESSAGE_BUS,
  type MessageBus,
  type MessageContext,
  type Subscription,
} from '@libs/infra';
import { hostname } from 'os';
import { ChannelMessage } from '../../contracts/channel-message.types';
import { ChannelTarget } from '../../contracts/channel-target.types';
import { ChannelAggregatorService } from './channel-aggregator.service';
import { ChannelConfigService } from './channel-config.service';
import { ChannelProviderRegistry } from './channel-provider.registry';

@Injectable()
export class ChannelDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChannelDispatcherService.name);
  private readonly consumerName = `${hostname()}-${process.pid}`;
  private subscription?: Subscription;

  constructor(
    private readonly redisService: RedisService,
    private readonly channelConfigService: ChannelConfigService,
    private readonly providerRegistry: ChannelProviderRegistry,
    private readonly channelAggregatorService: ChannelAggregatorService,
    @Inject(MESSAGE_BUS) private readonly messageBus: MessageBus,
  ) {}

  async onModuleInit(): Promise<void> {
    // [MESSAGE_BUS] 通过消息总线订阅 channel.events topic
    this.subscription = await this.messageBus.subscribe(
      'channel.events',
      (context: MessageContext<unknown>) => this.handleMessage(context),
      {
        group: 'channel-group',
        consumer: this.consumerName,
        batchSize: 20,
        blockMs: 2000,
      },
    );
    this.logger.log('Channel dispatcher started via MessageBus');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = undefined;
    }
    await this.channelAggregatorService.flushAll(async (target, _eventType, events) => {
      await this.flushAggregatedEvents(target, events);
    });
  }

  // ── [MESSAGE_BUS] 消息处理入口 ─────────────────────────────────────────

  private async handleMessage(context: MessageContext<unknown>): Promise<void> {
    const { envelope } = context;
    const rawPayload = envelope.payload;

    const validated = validateChannelEventEnvelope(rawPayload);
    if (!validated.ok || !validated.event) {
      this.logger.warn(
        `[channel-dispatcher] validation failed messageId=${envelope.messageId} error=${validated.error}`,
      );
      // 校验失败是永久性错误，不重试，直接进 DLQ
      await context.nack(validated.error || 'contract_validation_failed', { noRetry: true });
      return;
    }

    try {
      const allFailed = await this.dispatchOneEvent(validated.event);
      if (allFailed) {
        await context.nack('all_deliveries_failed');
        return;
      }
      await context.ack();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'dispatch_failed');
      await context.nack(reason);
    }
  }

  private async dispatchOneEvent(event: ChannelEventEnvelope): Promise<boolean> {
    const targets = await this.channelConfigService.findActiveTargetsByEventType(event.eventType);
    if (!targets.length) {
      return false;
    }

    let successCount = 0;
    for (const target of targets) {
      if (this.shouldAggregate(event.eventType)) {
        this.channelAggregatorService.queue(target, event, async (flushTarget, _eventType, events) => {
          await this.flushAggregatedEvents(flushTarget, events);
        });
        successCount += 1;
        continue;
      }

      const result = await this.sendToTarget(target, event, this.buildChannelMessage(event));
      if (result) {
        successCount += 1;
      }
    }

    return successCount === 0;
  }

  private buildChannelMessage(event: ChannelEventEnvelope): ChannelMessage {
    const extra = (event.data.extra || {}) as Record<string, unknown>;
    const cardType = this.resolveCardType(event.eventType);

    return {
      title: event.data.title,
      content: event.data.content,
      contentType: 'card',
      payload: {
        cardType,
        status: String(extra.status || '').trim(),
        durationMs: Number(extra.durationMs || 0),
        agentId: String(extra.agentId || '').trim(),
        agentName: String(extra.agentName || '').trim(),
        taskTitle: String(extra.taskTitle || '').trim(),
        action: String(extra.action || '').trim(),
        reason: String(extra.reason || '').trim(),
        scheduleName: String(extra.scheduleName || '').trim(),
        endedAt: String(extra.endedAt || '').trim(),
        summary: String(extra.summary || event.data.content || '').trim(),
        actionItems: Array.isArray(extra.actionItems) ? extra.actionItems : [],
        decisions: Array.isArray(extra.decisions) ? extra.decisions : [],
        executionTime: String(extra.executionTime || '').trim(),
        outputSummary: String(extra.outputSummary || '').trim(),
        actionUrl: event.data.actionUrl,
      },
      sourceEvent: {
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
      },
    };
  }

  private async sendToTarget(target: ChannelTarget, event: ChannelEventEnvelope, message: ChannelMessage): Promise<boolean> {
    let deliveryResult;

    try {
      const provider = this.providerRegistry.getProvider(target.providerType);
      deliveryResult = await provider.send(target, message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'unknown_provider_error');
      deliveryResult = {
        success: false,
        providerType: target.providerType,
        errorMessage: reason,
        deliveredAt: new Date(),
      };
    }

    await this.channelConfigService.createDeliveryLog({
      configId: target.configId,
      eventId: event.eventId,
      eventType: event.eventType,
      providerType: target.providerType,
      status: deliveryResult.success ? 'success' : 'failed',
      attempt: 1,
      errorMessage: deliveryResult.errorMessage,
      requestPayload: {
        contentType: message.contentType,
        title: message.title,
      },
      responsePayload: {
        success: deliveryResult.success,
        statusCode: deliveryResult.statusCode,
      },
      deliveredAt: deliveryResult.deliveredAt,
    });

    return Boolean(deliveryResult.success);
  }

  private async flushAggregatedEvents(target: ChannelTarget, events: ChannelEventEnvelope[]): Promise<void> {
    if (!events.length) {
      return;
    }

    const first = events[0];
    const items = events.map((event) => {
      const extra = (event.data.extra || {}) as Record<string, unknown>;
      return {
        status: String(extra.status || '').trim(),
        action: String(extra.action || '').trim(),
        agentId: String(extra.agentId || '').trim(),
        agentName: String(extra.agentName || '').trim(),
        taskTitle: String(extra.taskTitle || '').trim(),
      };
    });

    const message: ChannelMessage = {
      title: 'Agent 执行日志汇总',
      content: `过去 ${this.channelAggregatorService.getWindowSeconds()} 秒共 ${events.length} 条执行记录`,
      contentType: 'card',
      payload: {
        cardType: 'agent_log_aggregated',
        count: events.length,
        windowSeconds: this.channelAggregatorService.getWindowSeconds(),
        items,
        actionUrl: first.data.actionUrl,
      },
      sourceEvent: {
        eventId: `aggregate:${first.eventId}`,
        eventType: first.eventType,
        occurredAt: new Date().toISOString(),
      },
    };

    await this.sendToTarget(
      target,
      {
        ...first,
        eventId: message.sourceEvent.eventId,
      },
      message,
    );
  }

  private shouldAggregate(eventType: string): boolean {
    return eventType === 'agent.action.completed';
  }

  private resolveCardType(eventType: string): string {
    if (eventType === 'agent.action.completed') {
      return 'agent_log';
    }
    if (eventType === 'system.alert.scheduler') {
      return 'alert';
    }
    if (eventType === 'meeting.session.ended') {
      return 'meeting_ended';
    }
    if (eventType === 'meeting.summary.generated') {
      return 'meeting_summary';
    }
    if (eventType === 'scheduler.report.generated') {
      return 'report';
    }
    return 'task_result';
  }

}

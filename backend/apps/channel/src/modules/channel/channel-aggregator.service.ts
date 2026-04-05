import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ChannelEventEnvelope } from '@libs/infra';
import { ChannelTarget } from '../../contracts/channel-target.types';

interface AggregationBucket {
  target: ChannelTarget;
  eventType: string;
  events: ChannelEventEnvelope[];
  timer: NodeJS.Timeout;
}

@Injectable()
export class ChannelAggregatorService implements OnModuleDestroy {
  private readonly bucketMap = new Map<string, AggregationBucket>();
  private readonly windowMs = Math.max(1000, Number(process.env.CHANNEL_AGENT_LOG_AGGREGATION_WINDOW_MS || 60000));

  queue(
    target: ChannelTarget,
    event: ChannelEventEnvelope,
    onFlush: (target: ChannelTarget, eventType: string, events: ChannelEventEnvelope[]) => Promise<void>,
  ): void {
    const key = this.buildKey(target.configId, event.eventType);
    const existing = this.bucketMap.get(key);
    if (existing) {
      existing.events.push(event);
      return;
    }

    const timer = setTimeout(() => {
      void this.flushBucket(key, onFlush);
    }, this.windowMs);

    this.bucketMap.set(key, {
      target,
      eventType: event.eventType,
      events: [event],
      timer,
    });
  }

  getWindowSeconds(): number {
    return Math.ceil(this.windowMs / 1000);
  }

  async flushAll(
    onFlush: (target: ChannelTarget, eventType: string, events: ChannelEventEnvelope[]) => Promise<void>,
  ): Promise<void> {
    const entries = Array.from(this.bucketMap.entries());
    this.bucketMap.clear();

    for (const [, bucket] of entries) {
      clearTimeout(bucket.timer);
      await onFlush(bucket.target, bucket.eventType, bucket.events);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.flushAll(async () => undefined);
  }

  private async flushBucket(
    key: string,
    onFlush: (target: ChannelTarget, eventType: string, events: ChannelEventEnvelope[]) => Promise<void>,
  ): Promise<void> {
    const bucket = this.bucketMap.get(key);
    if (!bucket) {
      return;
    }
    this.bucketMap.delete(key);
    clearTimeout(bucket.timer);
    await onFlush(bucket.target, bucket.eventType, bucket.events);
  }

  private buildKey(configId: string, eventType: string): string {
    return `${configId}:${eventType}`;
  }
}

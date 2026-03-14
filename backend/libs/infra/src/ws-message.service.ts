import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { RedisService } from './redis.service';
import {
  buildWsFeatureChannel,
  buildWsSystemChannel,
  buildWsUserChannel,
  WS_PROTOCOL_VERSION,
  WsStandardMessage,
} from './ws-message.types';

interface PublishSystemMessageInput<T = Record<string, any>> {
  event: string;
  data: T;
  source: string;
  meta?: Record<string, any>;
}

interface PublishUserMessageInput<T = Record<string, any>> {
  userId: string;
  event: string;
  data: T;
  source: string;
  meta?: Record<string, any>;
}

interface PublishFeatureMessageInput<T = Record<string, any>> {
  feature: string;
  entityId: string;
  event: string;
  data: T;
  source: string;
  meta?: Record<string, any>;
}

@Injectable()
export class WsMessageService {
  constructor(private readonly redisService: RedisService) {}

  async publishSystemMessage<T = Record<string, any>>(input: PublishSystemMessageInput<T>): Promise<number> {
    const channel = buildWsSystemChannel();
    const message: WsStandardMessage<T> = {
      protocol: WS_PROTOCOL_VERSION,
      messageId: uuidv4(),
      level: 'system',
      event: input.event,
      timestamp: new Date().toISOString(),
      source: input.source,
      target: { channel },
      data: input.data,
      meta: input.meta,
    };
    return this.redisService.publish(channel, message);
  }

  async publishUserMessage<T = Record<string, any>>(input: PublishUserMessageInput<T>): Promise<number> {
    const userId = String(input.userId || '').trim();
    if (!userId) {
      return 0;
    }

    const channel = buildWsUserChannel(userId);
    const message: WsStandardMessage<T> = {
      protocol: WS_PROTOCOL_VERSION,
      messageId: uuidv4(),
      level: 'user',
      event: input.event,
      timestamp: new Date().toISOString(),
      source: input.source,
      target: { channel, userId },
      data: input.data,
      meta: input.meta,
    };
    return this.redisService.publish(channel, message);
  }

  async publishFeatureMessage<T = Record<string, any>>(input: PublishFeatureMessageInput<T>): Promise<number> {
    const feature = String(input.feature || '').trim();
    const entityId = String(input.entityId || '').trim();
    if (!feature || !entityId) {
      return 0;
    }

    const channel = buildWsFeatureChannel(feature, entityId);
    const message: WsStandardMessage<T> = {
      protocol: WS_PROTOCOL_VERSION,
      messageId: uuidv4(),
      level: 'feature',
      event: input.event,
      timestamp: new Date().toISOString(),
      source: input.source,
      target: { channel, feature, entityId },
      data: input.data,
      meta: input.meta,
    };
    return this.redisService.publish(channel, message);
  }
}

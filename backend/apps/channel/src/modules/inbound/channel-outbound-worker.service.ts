import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CHANNEL_OUTBOUND_FEISHU_CHANNEL, ChannelOutboundFeishuEnvelope, RedisService } from '@libs/infra';
import { FeishuAppProvider } from '../../providers/feishu/feishu-app.provider';
import { ChannelSessionService } from './channel-session.service';

@Injectable()
export class ChannelOutboundWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChannelOutboundWorkerService.name);
  private readonly messageListener = (message: string) => {
    void this.handleMessage(message);
  };

  constructor(
    private readonly redisService: RedisService,
    private readonly feishuAppProvider: FeishuAppProvider,
    private readonly channelSessionService: ChannelSessionService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.redisService.subscribe(CHANNEL_OUTBOUND_FEISHU_CHANNEL, this.messageListener);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redisService.unsubscribe(CHANNEL_OUTBOUND_FEISHU_CHANNEL, this.messageListener);
  }

  private async handleMessage(raw: string): Promise<void> {
    let payload: ChannelOutboundFeishuEnvelope;
    try {
      payload = JSON.parse(raw) as ChannelOutboundFeishuEnvelope;
    } catch {
      this.logger.warn('Ignored malformed outbound payload');
      return;
    }

    const chatId = String(payload.chatId || '').trim();
    const text = this.normalizeReplyText(String(payload.text || '').trim());
    if (!chatId || !text) {
      return;
    }

    try {
      await this.feishuAppProvider.replyText(chatId, text, payload.replyToMessageId);
      if (payload.channelSessionId && payload.sessionId) {
        await this.channelSessionService.updateAgentSessionId(payload.channelSessionId, payload.sessionId);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'unknown_error');
      this.logger.warn(`Outbound feishu reply failed: ${reason}`);
    }
  }

  private normalizeReplyText(text: string): string {
    const normalized = String(text || '').trim();
    if (!normalized) {
      return '';
    }
    if (normalized.length <= 500) {
      return normalized;
    }
    return `${normalized.slice(0, 500)}\n\n（内容较长，已截断展示）`;
  }
}

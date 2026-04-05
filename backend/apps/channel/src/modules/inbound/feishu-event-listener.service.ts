import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as lark from '@larksuiteoapi/node-sdk';
import { ChannelInboundService } from './channel-inbound.service';
import { FeishuAppProvider } from '../../providers/feishu/feishu-app.provider';
import { FeishuCardActionEnvelope, FeishuInboundMessage } from './inbound.types';

@Injectable()
export class FeishuEventListenerService implements OnModuleInit {
  private readonly logger = new Logger(FeishuEventListenerService.name);
  private wsClient: any;
  private readonly inboundEnabled = String(process.env.CHANNEL_INBOUND_ENABLED || 'false').toLowerCase() === 'true';
  private readonly appId = String(process.env.FEISHU_APP_ID || '').trim();
  private readonly appSecret = String(process.env.FEISHU_APP_SECRET || '').trim();
  private readonly botOpenId = String(process.env.FEISHU_BOT_OPEN_ID || '').trim();

  constructor(
    private readonly channelInboundService: ChannelInboundService,
    private readonly feishuAppProvider: FeishuAppProvider,
  ) {}

  onModuleInit(): void {
    if (!this.inboundEnabled) {
      this.logger.log('Inbound listener disabled by CHANNEL_INBOUND_ENABLED');
      return;
    }
    if (!this.appId || !this.appSecret) {
      this.logger.warn('Inbound listener skipped: FEISHU_APP_ID/FEISHU_APP_SECRET not configured');
      return;
    }

    try {
      this.startWsClient();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'unknown_error');
      this.logger.error(`Failed to start Feishu WS listener: ${reason}`);
    }
  }

  private startWsClient(): void {
    const larkAny = lark as any;
    const eventDispatcher = new larkAny.EventDispatcher({});

    eventDispatcher.register({
      'im.message.receive_v1': async (raw: unknown) => {
        await this.handleIncomingMessage(raw);
      },
      'card.action.trigger': async (raw: unknown) => {
        await this.handleCardAction(raw);
      },
    });

    this.wsClient = new larkAny.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: larkAny.LoggerLevel?.info,
    });

    this.wsClient.start({ eventDispatcher });
    this.logger.log('Feishu WS listener started');
  }

  private async handleIncomingMessage(raw: unknown): Promise<void> {
    const payload = this.extractPayload(raw);
    const event = payload?.event || payload?.data || payload;

    const externalUserId = String(event?.sender?.sender_id?.open_id || '').trim();
    const externalChatId = String(event?.message?.chat_id || '').trim();
    const messageId = String(event?.message?.message_id || '').trim();
    const chatType = String(event?.message?.chat_type || 'p2p').trim() as 'p2p' | 'group';
    const content = this.parseMessageContent(String(event?.message?.content || '').trim());
    const messageText = this.sanitizeIncomingText(String(content?.text || '').trim());
    const mentions = this.extractMentionIds(event?.message?.mentions);

    if (!externalUserId || !externalChatId || !messageId || !messageText) {
      return;
    }

    if (chatType === 'group' && this.botOpenId && !mentions.includes(this.botOpenId)) {
      return;
    }

    await this.feishuAppProvider.replyText(externalChatId, '处理中，请稍候...', messageId).catch(() => undefined);

    const inbound: FeishuInboundMessage = {
      providerType: 'feishu-app',
      externalUserId,
      externalChatId,
      chatType,
      messageId,
      messageText,
      displayName: String(event?.sender?.name || event?.sender?.sender_id?.union_id || '').trim() || undefined,
      mentions,
      rawEvent: payload,
      receivedAt: new Date().toISOString(),
    };

    const queued = await this.channelInboundService.enqueueInbound(inbound);
    if (!queued) {
      this.logger.debug(`Ignored duplicated inbound message: messageId=${messageId}`);
    }
  }

  private async handleCardAction(raw: unknown): Promise<void> {
    const payload = this.extractPayload(raw);
    const event = payload?.event || payload?.data || payload;

    const actionEnvelope: FeishuCardActionEnvelope = {
      providerType: 'feishu-app',
      operatorOpenId: String(event?.operator?.open_id || '').trim(),
      chatId: String(event?.open_chat_id || '').trim() || undefined,
      messageId: String(event?.open_message_id || '').trim() || undefined,
      actionValue: this.extractActionValue(event?.action?.value),
      rawEvent: payload,
    };

    if (!actionEnvelope.operatorOpenId || !Object.keys(actionEnvelope.actionValue).length) {
      return;
    }

    const resultText = await this.channelInboundService.handleCardAction(actionEnvelope);
    if (actionEnvelope.chatId) {
      await this.feishuAppProvider.replyText(actionEnvelope.chatId, resultText, actionEnvelope.messageId).catch(() => undefined);
    }
  }

  private extractPayload(raw: unknown): Record<string, any> {
    if (raw && typeof raw === 'object') {
      return raw as Record<string, any>;
    }
    return {};
  }

  private parseMessageContent(rawContent: string): Record<string, unknown> {
    if (!rawContent) {
      return {};
    }

    try {
      const parsed = JSON.parse(rawContent);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return { text: rawContent };
    }
  }

  private extractMentionIds(mentions: unknown): string[] {
    if (!Array.isArray(mentions)) {
      return [];
    }
    return mentions
      .map((item) => {
        const mention = item as Record<string, any>;
        return String(mention?.id?.open_id || '').trim();
      })
      .filter(Boolean);
  }

  private extractActionValue(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return {};
      }
    }

    return {};
  }

  private sanitizeIncomingText(text: string): string {
    const raw = String(text || '').trim();
    if (!raw) {
      return '';
    }

    return raw
      .replace(/<at\b[^>]*>.*?<\/at>/gi, ' ')
      .replace(/@_user_\d+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

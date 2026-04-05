import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisService } from '@libs/infra';
import { FeishuAppProvider } from '../../providers/feishu/feishu-app.provider';
import { ChannelApiClientService } from './channel-api-client.service';
import { ChannelSessionService } from './channel-session.service';

interface RelayMessage {
  senderId?: string;
  senderType?: 'employee' | 'agent' | 'system' | string;
  content?: string;
  metadata?: {
    source?: string;
    [key: string]: unknown;
  };
}

interface RelayEvent {
  type?: string;
  meetingId?: string;
  data?: RelayMessage | Record<string, unknown>;
}

interface RelayContext {
  meetingId: string;
  chatId: string;
  employeeId: string;
  listener: (message: string) => void;
  bufferedLines: string[];
  flushTimer?: NodeJS.Timeout;
  forceFlushTimer?: NodeJS.Timeout;
}

@Injectable()
export class ChannelMeetingRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChannelMeetingRelayService.name);
  private readonly activeRelays = new Map<string, RelayContext>();
  private readonly senderNameCache = new Map<string, { value: string; expiresAt: number }>();
  private readonly flushDelayMs = 1500;
  private readonly forceFlushMs = 3000;
  private readonly bufferSizeLimit = 10;
  private readonly senderNameCacheTtlMs = 5 * 60 * 1000;

  constructor(
    private readonly redisService: RedisService,
    private readonly feishuAppProvider: FeishuAppProvider,
    private readonly apiClient: ChannelApiClientService,
    private readonly sessionService: ChannelSessionService,
  ) {}

  async onModuleInit(): Promise<void> {
    const activeSessions = await this.sessionService.listSessionsWithActiveMeeting();
    for (const session of activeSessions) {
      await this.startRelay({
        meetingId: session.meetingId,
        chatId: session.chatId,
        employeeId: session.employeeId,
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    const relays = Array.from(this.activeRelays.values());
    for (const relay of relays) {
      await this.stopRelay(relay.meetingId, relay.employeeId);
    }
  }

  async startRelay(input: { meetingId: string; chatId: string; employeeId: string }): Promise<void> {
    const meetingId = String(input.meetingId || '').trim();
    const chatId = String(input.chatId || '').trim();
    const employeeId = String(input.employeeId || '').trim();
    if (!meetingId || !chatId || !employeeId) {
      return;
    }

    const key = this.getRelayKey(meetingId, employeeId);
    if (this.activeRelays.has(key)) {
      return;
    }

    const context: RelayContext = {
      meetingId,
      chatId,
      employeeId,
      listener: (message: string) => {
        void this.handleRelayMessage(key, message);
      },
      bufferedLines: [],
    };

    this.activeRelays.set(key, context);
    try {
      await this.redisService.subscribe(`meeting:${meetingId}`, context.listener);
    } catch (error) {
      this.activeRelays.delete(key);
      const reason = error instanceof Error ? error.message : 'unknown_error';
      this.logger.warn(`startRelay failed: meetingId=${meetingId} employeeId=${employeeId} reason=${reason}`);
    }
  }

  async stopRelay(meetingId: string, employeeId: string): Promise<void> {
    const key = this.getRelayKey(meetingId, employeeId);
    const context = this.activeRelays.get(key);
    if (!context) {
      return;
    }

    this.clearRelayTimers(context);
    this.activeRelays.delete(key);
    await this.redisService.unsubscribe(`meeting:${context.meetingId}`, context.listener).catch(() => undefined);
  }

  private async handleRelayMessage(relayKey: string, raw: string): Promise<void> {
    const context = this.activeRelays.get(relayKey);
    if (!context) {
      return;
    }

    let event: RelayEvent;
    try {
      event = JSON.parse(raw) as RelayEvent;
    } catch {
      return;
    }

    if (event.type === 'message') {
      const line = await this.formatRelayLine(context.employeeId, event.data as RelayMessage | undefined);
      if (!line) {
        return;
      }
      this.bufferLine(relayKey, line);
      return;
    }

    if (event.type === 'status_changed') {
      const status = String((event.data as Record<string, unknown> | undefined)?.status || '').trim();
      if (status === 'ended') {
        await this.feishuAppProvider.replyText(context.chatId, '会议已结束。').catch(() => undefined);
        await this.stopRelay(context.meetingId, context.employeeId);
        await this.sessionService.clearActiveMeetingByMeetingId(context.meetingId);
      }
    }
  }

  private async formatRelayLine(employeeId: string, message?: RelayMessage): Promise<string> {
    if (!message) {
      return '';
    }

    const senderId = String(message.senderId || '').trim();
    const senderType = String(message.senderType || '').trim();
    const content = String(message.content || '').trim();
    const source = String(message.metadata?.source || '').trim();
    const explicitSenderName = String(message.metadata?.senderName || message.metadata?.displayName || '').trim();
    if (!content) {
      return '';
    }

    if (senderType === 'system') {
      return '';
    }

    if (senderType === 'employee' && senderId === employeeId && source === 'feishu') {
      return '';
    }

    if (senderType === 'employee' && senderId === employeeId && source === 'web') {
      return `[你·网页] ${content}`;
    }

    if (senderType === 'agent') {
      const senderName =
        explicitSenderName ||
        (await this.resolveSenderName('agent', senderId, employeeId)) ||
        `Agent-${this.toShortId(senderId || 'unknown')}`;
      return `[${senderName}] ${content}`;
    }

    if (senderType === 'employee') {
      const senderName =
        explicitSenderName ||
        (await this.resolveSenderName('employee', senderId, employeeId)) ||
        `员工-${this.toShortId(senderId || 'unknown')}`;
      return `[${senderName}] ${content}`;
    }

    return content;
  }

  private bufferLine(relayKey: string, line: string): void {
    const context = this.activeRelays.get(relayKey);
    if (!context) {
      return;
    }

    context.bufferedLines.push(line);

    if (!context.flushTimer) {
      context.flushTimer = setTimeout(() => {
        void this.flushBuffer(relayKey);
      }, this.flushDelayMs);
    }
    if (!context.forceFlushTimer) {
      context.forceFlushTimer = setTimeout(() => {
        void this.flushBuffer(relayKey);
      }, this.forceFlushMs);
    }

    if (context.bufferedLines.length >= this.bufferSizeLimit) {
      void this.flushBuffer(relayKey);
    }
  }

  private async flushBuffer(relayKey: string): Promise<void> {
    const context = this.activeRelays.get(relayKey);
    if (!context) {
      return;
    }

    const lines = [...context.bufferedLines];
    context.bufferedLines = [];
    this.clearRelayTimers(context);
    if (lines.length === 0) {
      return;
    }

    const content = lines.join('\n');
    await this.feishuAppProvider.replyText(context.chatId, content).catch(() => undefined);
  }

  private clearRelayTimers(context: RelayContext): void {
    if (context.flushTimer) {
      clearTimeout(context.flushTimer);
      context.flushTimer = undefined;
    }
    if (context.forceFlushTimer) {
      clearTimeout(context.forceFlushTimer);
      context.forceFlushTimer = undefined;
    }
  }

  private getRelayKey(meetingId: string, employeeId: string): string {
    return `${meetingId}:${employeeId}`;
  }

  private async resolveSenderName(
    senderType: 'agent' | 'employee',
    senderId: string,
    employeeId: string,
  ): Promise<string | undefined> {
    const normalizedId = String(senderId || '').trim();
    if (!normalizedId) {
      return undefined;
    }

    const cacheKey = `${senderType}:${normalizedId}`;
    const cached = this.senderNameCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      const profile = (await this.apiClient.callApiAsUser(employeeId, {
        method: 'get',
        url: senderType === 'agent' ? `/api/agents/${normalizedId}` : `/api/employees/${normalizedId}`,
      })) as Record<string, unknown>;
      const name = String(profile.name || profile.displayName || profile.email || profile.id || '').trim();
      if (!name) {
        return undefined;
      }
      this.senderNameCache.set(cacheKey, {
        value: name,
        expiresAt: Date.now() + this.senderNameCacheTtlMs,
      });
      return name;
    } catch {
      return undefined;
    }
  }

  private toShortId(value: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return 'unknown';
    }
    if (normalized.length <= 8) {
      return normalized;
    }
    return normalized.slice(0, 8);
  }
}

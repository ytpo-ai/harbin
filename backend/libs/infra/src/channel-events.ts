import { MessageCenterEventEnvelope } from './message-center-events';

export const CHANNEL_EVENTS_STREAM = 'streams:channel:events';
export const CHANNEL_CONSUMER_GROUP = 'channel-group';
export const CHANNEL_EVENTS_DLQ_STREAM = 'streams:channel:events:dlq';
export const CHANNEL_INBOUND_QUEUE_KEY = 'channel:inbound:queue';
export const CHANNEL_OUTBOUND_FEISHU_CHANNEL = 'channel:outbound:feishu';

export interface ChannelEventEnvelope {
  eventId: string;
  eventType: string;
  version: 'v1';
  occurredAt: string;
  source: string;
  traceId: string;
  data: {
    receiverId?: string;
    messageType: string;
    title: string;
    content: string;
    bizKey?: string;
    actionUrl?: string;
    priority: 'low' | 'normal' | 'high';
    extra?: Record<string, unknown>;
  };
}

export interface ChannelOutboundFeishuEnvelope {
  channelSource: 'feishu';
  chatId: string;
  replyToMessageId?: string;
  text: string;
  channelSessionId?: string;
  employeeId?: string;
  agentId?: string;
  runId?: string;
  sessionId?: string;
  traceId?: string;
  eventType?: string;
  sentAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return String(value || '').trim();
}

function normalizePriority(value: unknown): 'low' | 'normal' | 'high' {
  if (value === 'low' || value === 'high') {
    return value;
  }
  return 'normal';
}

export function buildChannelEventFromMessageCenter(event: MessageCenterEventEnvelope): ChannelEventEnvelope {
  return {
    eventId: String(event.eventId || '').trim(),
    eventType: String(event.eventType || '').trim(),
    version: 'v1',
    occurredAt: String(event.occurredAt || '').trim(),
    source: String(event.source || '').trim(),
    traceId: String(event.traceId || '').trim(),
    data: {
      receiverId: String(event.data?.receiverId || '').trim() || undefined,
      messageType: String(event.data?.messageType || '').trim(),
      title: String(event.data?.title || '').trim(),
      content: String(event.data?.content || '').trim(),
      bizKey: String(event.data?.bizKey || '').trim() || undefined,
      actionUrl: String(event.data?.actionUrl || '').trim() || undefined,
      priority: normalizePriority(event.data?.priority),
      extra: isRecord(event.data?.extra) ? event.data.extra : {},
    },
  };
}

export function validateChannelEventEnvelope(payload: unknown): {
  ok: boolean;
  error?: string;
  event?: ChannelEventEnvelope;
} {
  if (!isRecord(payload)) {
    return { ok: false, error: 'payload must be an object' };
  }

  const eventId = normalizeString(payload.eventId);
  const eventType = normalizeString(payload.eventType);
  const version = normalizeString(payload.version);
  const occurredAt = normalizeString(payload.occurredAt);
  const source = normalizeString(payload.source);
  const traceId = normalizeString(payload.traceId);
  const dataRaw = payload.data;

  if (!eventId || !eventType || !version || !occurredAt || !source || !traceId) {
    return { ok: false, error: 'eventId/eventType/version/occurredAt/source/traceId are required' };
  }

  if (version !== 'v1') {
    return { ok: false, error: `unsupported event version: ${version}` };
  }

  if (!isRecord(dataRaw)) {
    return { ok: false, error: 'data must be an object' };
  }

  const messageType = normalizeString(dataRaw.messageType);
  const title = normalizeString(dataRaw.title);
  const content = normalizeString(dataRaw.content);
  if (!messageType || !title || !content) {
    return { ok: false, error: 'data.messageType/title/content are required' };
  }

  return {
    ok: true,
    event: {
      eventId,
      eventType,
      version: 'v1',
      occurredAt,
      source,
      traceId,
      data: {
        receiverId: normalizeString(dataRaw.receiverId) || undefined,
        messageType,
        title,
        content,
        bizKey: normalizeString(dataRaw.bizKey) || undefined,
        actionUrl: normalizeString(dataRaw.actionUrl) || undefined,
        priority: normalizePriority(dataRaw.priority),
        extra: isRecord(dataRaw.extra) ? dataRaw.extra : {},
      },
    },
  };
}

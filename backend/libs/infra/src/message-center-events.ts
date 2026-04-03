import { randomUUID } from 'crypto';

export const MESSAGE_CENTER_EVENT_STREAM_KEY = 'streams:message-center:events';
export const MESSAGE_CENTER_EVENT_CONSUMER_GROUP = 'message-center-group';
export const MESSAGE_CENTER_EVENT_SOURCE_EI = 'engineering-intelligence';
export const MESSAGE_CENTER_EVENT_SOURCE_MEETING = 'meeting-service';
export const MESSAGE_CENTER_EVENT_SOURCE_ORCHESTRATION = 'orchestration-service';

export type MessageCenterEventType = 'meeting.session.ended' | 'engineering.tool.completed' | 'orchestration.task.completed';
export type MessageCenterMessageType = 'engineering_statistics' | 'orchestration' | 'system_alert';
export type MessageCenterMessagePriority = 'low' | 'normal' | 'high';

export interface MessageCenterEventData {
  receiverId: string;
  messageType: MessageCenterMessageType;
  title: string;
  content: string;
  bizKey: string;
  actionUrl?: string;
  priority?: MessageCenterMessagePriority;
  extra?: Record<string, unknown>;
}

export interface MessageCenterEventEnvelope {
  eventId: string;
  eventType: MessageCenterEventType;
  version: 'v1';
  occurredAt: string;
  source: string;
  traceId: string;
  data: MessageCenterEventData;
}

export interface BuildMessageCenterEventInput {
  eventType: MessageCenterEventType;
  source: string;
  traceId?: string;
  occurredAt?: string;
  data: MessageCenterEventData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return String(value || '').trim();
}

function normalizePriority(value: unknown): MessageCenterMessagePriority {
  if (value === 'low' || value === 'high') {
    return value;
  }
  return 'normal';
}

export function buildMessageCenterEvent(input: BuildMessageCenterEventInput): MessageCenterEventEnvelope {
  const nowIso = new Date().toISOString();
  return {
    eventId: randomUUID(),
    eventType: input.eventType,
    version: 'v1',
    occurredAt: normalizeString(input.occurredAt) || nowIso,
    source: normalizeString(input.source) || 'unknown',
    traceId: normalizeString(input.traceId) || randomUUID(),
    data: {
      receiverId: normalizeString(input.data?.receiverId),
      messageType: input.data?.messageType,
      title: normalizeString(input.data?.title),
      content: normalizeString(input.data?.content),
      bizKey: normalizeString(input.data?.bizKey),
      actionUrl: normalizeString(input.data?.actionUrl) || undefined,
      priority: normalizePriority(input.data?.priority),
      extra: isRecord(input.data?.extra) ? input.data.extra : {},
    },
  };
}

export function validateMessageCenterEventEnvelope(payload: unknown): {
  ok: boolean;
  error?: string;
  event?: MessageCenterEventEnvelope;
} {
  if (!isRecord(payload)) {
    return { ok: false, error: 'payload must be an object' };
  }

  const eventId = normalizeString(payload.eventId);
  const eventType = normalizeString(payload.eventType) as MessageCenterEventType;
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

  if (
    eventType !== 'meeting.session.ended' &&
    eventType !== 'engineering.tool.completed' &&
    eventType !== 'orchestration.task.completed'
  ) {
    return { ok: false, error: `unsupported event type: ${eventType}` };
  }

  if (!isRecord(dataRaw)) {
    return { ok: false, error: 'data must be an object' };
  }

  const receiverId = normalizeString(dataRaw.receiverId);
  const messageType = normalizeString(dataRaw.messageType) as MessageCenterMessageType;
  const title = normalizeString(dataRaw.title);
  const content = normalizeString(dataRaw.content);
  const bizKey = normalizeString(dataRaw.bizKey);
  const actionUrl = normalizeString(dataRaw.actionUrl);
  const priority = normalizePriority(dataRaw.priority);
  const extra = isRecord(dataRaw.extra) ? dataRaw.extra : {};

  if (!receiverId || !messageType || !title || !content || !bizKey) {
    return { ok: false, error: 'data.receiverId/messageType/title/content/bizKey are required' };
  }

  if (messageType !== 'engineering_statistics' && messageType !== 'orchestration' && messageType !== 'system_alert') {
    return { ok: false, error: `unsupported message type: ${messageType}` };
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
        receiverId,
        messageType,
        title,
        content,
        bizKey,
        actionUrl: actionUrl || undefined,
        priority,
        extra,
      },
    },
  };
}

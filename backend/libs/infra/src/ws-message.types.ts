export const WS_PROTOCOL_VERSION = 'harbin.ws.v1';

export type WsMessageLevel = 'system' | 'user' | 'feature';

export interface WsMessageTarget {
  channel: string;
  userId?: string;
  feature?: string;
  entityId?: string;
}

export interface WsStandardMessage<T = Record<string, any>> {
  protocol: typeof WS_PROTOCOL_VERSION;
  messageId: string;
  level: WsMessageLevel;
  event: string;
  timestamp: string;
  source: string;
  target: WsMessageTarget;
  data: T;
  meta?: Record<string, any>;
}

export const WS_SYSTEM_CHANNEL = 'ws:system';

export function buildWsSystemChannel(): string {
  return WS_SYSTEM_CHANNEL;
}

export function buildWsUserChannel(userId: string): string {
  return `ws:user:${String(userId || '').trim()}`;
}

export function buildWsFeatureChannel(feature: string, entityId: string): string {
  return `ws:feature:${String(feature || '').trim()}:${String(entityId || '').trim()}`;
}

export function isWsStandardChannel(channel: string): boolean {
  return String(channel || '').startsWith('ws:');
}

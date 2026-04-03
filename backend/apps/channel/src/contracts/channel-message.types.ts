export interface ChannelMessage {
  title: string;
  content: string;
  contentType: 'text' | 'markdown' | 'card';
  payload?: Record<string, unknown>;
  sourceEvent: {
    eventId: string;
    eventType: string;
    occurredAt: string;
  };
}

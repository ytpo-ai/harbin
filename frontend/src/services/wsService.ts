type WsMessageHandler = (message: string) => void;

class WsService {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private isConnecting = false;
  private manuallyClosed = false;
  private reconnectTimer: number | null = null;
  private readonly channels = new Map<string, Set<WsMessageHandler>>();

  constructor() {
    this.url = (import.meta as any).env?.VITE_WS_URL || 'ws://localhost:3003/ws';
  }

  subscribe(channel: string, handler: WsMessageHandler): () => void {
    const handlers = this.channels.get(channel) || new Set<WsMessageHandler>();
    const firstSubscriber = handlers.size === 0;
    handlers.add(handler);
    this.channels.set(channel, handlers);

    this.ensureConnected();

    if (firstSubscriber) {
      this.send({ action: 'subscribe', channel });
    }

    return () => {
      const channelHandlers = this.channels.get(channel);
      if (!channelHandlers) return;

      channelHandlers.delete(handler);
      if (channelHandlers.size > 0) return;

      this.channels.delete(channel);
      this.send({ action: 'unsubscribe', channel });
    };
  }

  private ensureConnected(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.isConnecting) return;

    this.isConnecting = true;
    this.manuallyClosed = false;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.isConnecting = false;
      this.resubscribeAll();
    };

    this.ws.onmessage = (event) => {
      const raw = event.data as string;
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }

      if (parsed?.type === 'subscribed' || parsed?.type === 'unsubscribed' || parsed?.type === 'pong') {
        return;
      }

      const text = JSON.stringify(parsed);
      if (parsed?.channel && typeof parsed.channel === 'string') {
        const handlers = this.channels.get(parsed.channel);
        if (!handlers) return;
        handlers.forEach((handler) => handler(text));
        return;
      }

      this.channels.forEach((handlers) => {
        handlers.forEach((handler) => handler(text));
      });
    };

    this.ws.onclose = () => {
      this.isConnecting = false;
      this.ws = null;
      if (this.manuallyClosed || this.channels.size === 0) return;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.isConnecting = false;
    };
  }

  private resubscribeAll(): void {
    this.channels.forEach((_, channel) => {
      this.send({ action: 'subscribe', channel });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, 1500);
  }

  private send(payload: { action: 'subscribe' | 'unsubscribe'; channel: string }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }
}

export const wsService = new WsService();

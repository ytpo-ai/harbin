import { NestFactory } from '@nestjs/core';
import { WsAppModule } from './app.module';
import { RedisService } from '@libs/infra';
import { WebSocketServer, WebSocket } from 'ws';
import { isWsStandardChannel, WS_PROTOCOL_VERSION, WsStandardMessage } from '@libs/infra';

interface WsEnvelope {
  action: 'subscribe' | 'unsubscribe' | 'ping';
  channel?: string;
}

async function bootstrap() {
  const app = await NestFactory.create(WsAppModule);
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });
  app.setGlobalPrefix('api');

  const port = Number(process.env.WS_PORT || 3003);
  await app.listen(port);

  const redis = app.get(RedisService);
  const server = app.getHttpServer();
  const wss = new WebSocketServer({ server, path: '/ws' });

  const channelSockets = new Map<string, Set<WebSocket>>();
  const channelHandlers = new Map<string, (message: string) => void>();

  const addSubscription = async (ws: WebSocket, channel: string) => {
    let sockets = channelSockets.get(channel);
    if (!sockets) {
      sockets = new Set<WebSocket>();
      channelSockets.set(channel, sockets);
    }
    sockets.add(ws);

    if (!channelHandlers.has(channel)) {
      const handler = (message: string) => {
        const targets = channelSockets.get(channel);
        if (!targets?.size) return;

        let outbound = message;
        try {
          const parsed = JSON.parse(message);
          const isStandardWsMessage =
            isWsStandardChannel(channel) &&
            parsed &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed) &&
            (parsed as WsStandardMessage).protocol === WS_PROTOCOL_VERSION;

          if (isStandardWsMessage) {
            outbound = JSON.stringify(parsed);
          } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            outbound = JSON.stringify({ ...parsed, channel });
          } else {
            outbound = JSON.stringify({ channel, payload: parsed });
          }
        } catch {
          outbound = JSON.stringify({ channel, payload: message });
        }

        targets.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(outbound);
          }
        });
      };
      channelHandlers.set(channel, handler);
      await redis.subscribe(channel, handler);
    }
  };

  const removeSubscription = async (ws: WebSocket, channel: string) => {
    const sockets = channelSockets.get(channel);
    if (!sockets) return;

    sockets.delete(ws);
    if (sockets.size > 0) return;

    channelSockets.delete(channel);
    const handler = channelHandlers.get(channel);
    if (!handler) return;
    channelHandlers.delete(channel);
    await redis.unsubscribe(channel, handler);
  };

  wss.on('connection', (ws) => {
    const subscribedChannels = new Set<string>();

    ws.on('message', async (raw) => {
      let payload: WsEnvelope;
      try {
        payload = JSON.parse(raw.toString()) as WsEnvelope;
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        return;
      }

      if (payload.action === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        return;
      }

      if (!payload.channel) {
        ws.send(JSON.stringify({ type: 'error', message: 'Missing channel' }));
        return;
      }

      if (payload.action === 'subscribe') {
        await addSubscription(ws, payload.channel);
        subscribedChannels.add(payload.channel);
        ws.send(JSON.stringify({ type: 'subscribed', channel: payload.channel }));
      }

      if (payload.action === 'unsubscribe') {
        await removeSubscription(ws, payload.channel);
        subscribedChannels.delete(payload.channel);
        ws.send(JSON.stringify({ type: 'unsubscribed', channel: payload.channel }));
      }
    });

    ws.on('close', async () => {
      for (const channel of subscribedChannels) {
        await removeSubscription(ws, channel);
      }
    });
  });

  console.log(`WebSocket service running on http://localhost:${port}`);
  console.log(`WebSocket endpoint: ws://localhost:${port}/ws`);
}

bootstrap();

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const infra_1 = require("@libs/infra");
const ws_1 = require("ws");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.WsAppModule);
    app.enableCors({
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true,
    });
    app.setGlobalPrefix('api');
    const port = Number(process.env.WS_PORT || 3003);
    await app.listen(port);
    const redis = app.get(infra_1.RedisService);
    const server = app.getHttpServer();
    const wss = new ws_1.WebSocketServer({ server, path: '/ws' });
    const channelSockets = new Map();
    const channelHandlers = new Map();
    const addSubscription = async (ws, channel) => {
        let sockets = channelSockets.get(channel);
        if (!sockets) {
            sockets = new Set();
            channelSockets.set(channel, sockets);
        }
        sockets.add(ws);
        if (!channelHandlers.has(channel)) {
            const handler = (message) => {
                const targets = channelSockets.get(channel);
                if (!targets?.size)
                    return;
                let outbound = message;
                try {
                    const parsed = JSON.parse(message);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        outbound = JSON.stringify({ ...parsed, channel });
                    }
                    else {
                        outbound = JSON.stringify({ channel, payload: parsed });
                    }
                }
                catch {
                    outbound = JSON.stringify({ channel, payload: message });
                }
                targets.forEach((client) => {
                    if (client.readyState === ws_1.WebSocket.OPEN) {
                        client.send(outbound);
                    }
                });
            };
            channelHandlers.set(channel, handler);
            await redis.subscribe(channel, handler);
        }
    };
    const removeSubscription = async (ws, channel) => {
        const sockets = channelSockets.get(channel);
        if (!sockets)
            return;
        sockets.delete(ws);
        if (sockets.size > 0)
            return;
        channelSockets.delete(channel);
        const handler = channelHandlers.get(channel);
        if (!handler)
            return;
        channelHandlers.delete(channel);
        await redis.unsubscribe(channel, handler);
    };
    wss.on('connection', (ws) => {
        const subscribedChannels = new Set();
        ws.on('message', async (raw) => {
            let payload;
            try {
                payload = JSON.parse(raw.toString());
            }
            catch {
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
//# sourceMappingURL=main.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeNetworkProxy = initializeNetworkProxy;
exports.getProxyDispatcher = getProxyDispatcher;
const common_1 = require("@nestjs/common");
const undici_1 = require("undici");
const net = require("net");
const logger = new common_1.Logger('NetworkProxy');
let proxyInitialized = false;
let proxyDispatcher;
const LOCAL_PROXY_FALLBACK = 'http://127.0.0.1:7890';
function getConfiguredProxyUrl() {
    return (process.env.AI_PROXY_URL ||
        process.env.HTTPS_PROXY ||
        process.env.HTTP_PROXY ||
        process.env.ALL_PROXY);
}
async function isLocalProxyReachable(url) {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname;
        const port = Number(parsed.port || 80);
        return await new Promise((resolve) => {
            const socket = net.createConnection({ host, port });
            const timer = setTimeout(() => {
                socket.destroy();
                resolve(false);
            }, 300);
            socket.on('connect', () => {
                clearTimeout(timer);
                socket.end();
                resolve(true);
            });
            socket.on('error', () => {
                clearTimeout(timer);
                resolve(false);
            });
        });
    }
    catch {
        return false;
    }
}
async function initializeNetworkProxy() {
    if (proxyInitialized)
        return;
    let proxyUrl = getConfiguredProxyUrl();
    if (!proxyUrl) {
        const reachable = await isLocalProxyReachable(LOCAL_PROXY_FALLBACK);
        if (reachable) {
            proxyUrl = LOCAL_PROXY_FALLBACK;
            logger.log(`Auto-detected local proxy: ${LOCAL_PROXY_FALLBACK}`);
        }
    }
    if (!proxyUrl) {
        logger.log('Proxy not configured, using direct network access');
        return;
    }
    try {
        const proxyAgent = new undici_1.ProxyAgent(proxyUrl);
        (0, undici_1.setGlobalDispatcher)(proxyAgent);
        proxyDispatcher = proxyAgent;
        proxyInitialized = true;
        logger.log(`Proxy enabled for model requests: ${proxyUrl}`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown proxy setup error';
        logger.error(`Failed to initialize proxy: ${message}`);
    }
}
function getProxyDispatcher() {
    return proxyDispatcher;
}
//# sourceMappingURL=proxy.util.js.map
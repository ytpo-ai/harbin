import { Logger } from '@nestjs/common';
import { Dispatcher, ProxyAgent, setGlobalDispatcher } from 'undici';
import * as net from 'net';

const logger = new Logger('NetworkProxy');

let proxyInitialized = false;
let proxyDispatcher: Dispatcher | undefined;

const LOCAL_PROXY_FALLBACK = 'http://127.0.0.1:7890';

function getConfiguredProxyUrl(): string | undefined {
  return (
    process.env.AI_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY
  );
}

async function isLocalProxyReachable(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port = Number(parsed.port || 80);

    return await new Promise<boolean>((resolve) => {
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
  } catch {
    return false;
  }
}

export async function initializeNetworkProxy(): Promise<void> {
  if (proxyInitialized) return;

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
    const proxyAgent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(proxyAgent);
    proxyDispatcher = proxyAgent;
    proxyInitialized = true;
    logger.log(`Proxy enabled for model requests: ${proxyUrl}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown proxy setup error';
    logger.error(`Failed to initialize proxy: ${message}`);
  }
}

export function getProxyDispatcher(): Dispatcher | undefined {
  return proxyDispatcher;
}

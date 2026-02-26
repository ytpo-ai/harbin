import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';

@Injectable()
export class GatewayProxyService {
  private readonly logger = new Logger(GatewayProxyService.name);
  private readonly agentsBaseUrl = process.env.AGENTS_SERVICE_URL || 'http://localhost:3002';
  private readonly legacyBaseUrl = process.env.LEGACY_SERVICE_URL || 'http://localhost:3001';
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';

  resolveTarget(originalUrl: string): string {
    if (
      originalUrl.startsWith('/api/agents') ||
      originalUrl.startsWith('/api/tasks') ||
      originalUrl.startsWith('/api/meetings') ||
      originalUrl.startsWith('/api/discussions')
    ) {
      return this.agentsBaseUrl;
    }
    return this.legacyBaseUrl;
  }

  buildSignedHeaders(userContext?: GatewayUserContext): Record<string, string> {
    if (!userContext) return {};
    const encoded = encodeUserContext(userContext);
    const signature = signEncodedContext(encoded, this.contextSecret);
    return {
      'x-user-context': encoded,
      'x-user-signature': signature,
    };
  }

  async forward(req: any, res: any): Promise<void> {
    const targetBase = this.resolveTarget(req.originalUrl || req.url);
    const targetUrl = `${targetBase}${req.originalUrl || req.url}`;

    const headers: Record<string, string> = {};
    if (req.headers['content-type']) {
      headers['content-type'] = req.headers['content-type'];
    }
    if (req.headers.authorization) {
      headers.authorization = req.headers.authorization;
    }

    Object.assign(headers, this.buildSignedHeaders(req.userContext));

    const config: AxiosRequestConfig = {
      url: targetUrl,
      method: req.method,
      headers,
      params: req.query,
      data: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
      validateStatus: () => true,
      timeout: Number(process.env.GATEWAY_PROXY_TIMEOUT_MS || 30000),
      responseType: 'arraybuffer',
    };

    try {
      const response = await axios.request(config);
      Object.entries(response.headers || {}).forEach(([key, value]) => {
        if (value === undefined) return;
        if (key.toLowerCase() === 'transfer-encoding') return;
        res.setHeader(key, value as any);
      });
      res.status(response.status).send(response.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gateway proxy error';
      this.logger.error(`Proxy failed: ${message}`);
      throw new InternalServerErrorException('Gateway proxy failed');
    }
  }
}

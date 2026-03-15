import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { Method } from 'axios';
import {
  OpenCodeAdapterEvent,
  OpenCodeRuntimeOptions,
  OpenCodeAdapterSessionInfo,
  OpenCodeCreateSessionInput,
  OpenCodePromptInput,
} from './contracts/opencode.contract';

@Injectable()
export class OpenCodeAdapter {
  private readonly logger = new Logger(OpenCodeAdapter.name);
  private readonly defaultRequestTimeoutMs: number;
  private readonly messageRequestTimeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.defaultRequestTimeoutMs = this.resolveTimeoutMs('OPENCODE_REQUEST_TIMEOUT_MS', 120000);
    this.messageRequestTimeoutMs = this.resolveTimeoutMs(
      'OPENCODE_MESSAGE_REQUEST_TIMEOUT_MS',
      this.defaultRequestTimeoutMs,
    );
  }

  async createSession(input: OpenCodeCreateSessionInput): Promise<OpenCodeAdapterSessionInfo> {
    const config = input.config || {};
    const directory = String(config.directory || config.projectPath || '').trim() || undefined;

    const session = await this.request<any>('POST', '/session', {
      params: directory ? { directory } : undefined,
      data: {
        title: input.title || 'OpenCode Runtime Session',
        ...(input.model ? { model: input.model } : {}),
        ...config,
      },
      runtime: input.runtime,
      throwOnError: true,
    });

    return {
      id: String(session?.id || ''),
      title: session?.title,
      createdAt: session?.createdAt,
    };
  }

  async promptSession(input: OpenCodePromptInput): Promise<{ response: string; metadata: Record<string, unknown> }> {
    const result = await this.request<any>('POST', `/session/${encodeURIComponent(input.sessionId)}/message`, {
      data: {
        parts: [{ type: 'text', text: input.prompt }],
        ...(input.model ? { model: input.model } : {}),
      },
      runtime: input.runtime,
      throwOnError: true,
    });

    return {
      response: String(result?.info?.content || result?.content || ''),
      metadata: (result?.info || {}) as Record<string, unknown>,
    };
  }

  async *subscribeEvents(sessionId?: string, runtime?: OpenCodeRuntimeOptions): AsyncGenerator<OpenCodeAdapterEvent> {
    for await (const event of this.streamSse(runtime)) {
      const payload = event.payload;
      const eventSessionId = this.resolveSessionId(payload);
      if (sessionId && eventSessionId && eventSessionId !== sessionId) {
        continue;
      }

      yield {
        type: event.type,
        sessionId: eventSessionId,
        timestamp: new Date().toISOString(),
        payload,
        raw: payload,
      };
    }
  }

  private getBaseUrl(runtime?: OpenCodeRuntimeOptions): string {
    return String(runtime?.baseUrl || this.configService.get<string>('OPENCODE_SERVER_URL') || 'http://localhost:4096')
      .trim()
      .replace(/\/+$/, '');
  }

  private getPassword(): string {
    return String(this.configService.get<string>('OPENCODE_SERVER_PASSWORD') || '').trim();
  }

  private isAuthEnabled(runtime?: OpenCodeRuntimeOptions): boolean {
    return runtime?.authEnable === true;
  }

  private async request<T = any>(
    method: Method,
    route: string,
    options?: {
      params?: Record<string, any>;
      data?: any;
      timeout?: number;
      responseType?: 'json' | 'stream';
      runtime?: OpenCodeRuntimeOptions;
      throwOnError?: boolean;
    },
  ): Promise<T> {
    const runtime = options?.runtime;
    const baseUrl = this.getBaseUrl(runtime);
    const username = 'opencode';
    const authEnabled = this.isAuthEnabled(runtime);
    const password = authEnabled ? this.getPassword() : '';
    const hasPassword = Boolean(password);
    const timeoutMs = this.resolveRequestTimeoutMs(route, runtime, options?.timeout);
    const requestUrl = this.buildRequestUrl(baseUrl, route, options?.params);
    if (authEnabled && !password) {
      this.logger.error(
        `[opencode_request_config_invalid] method=${method} url=${requestUrl} username=${username} authEnabled=${authEnabled} hasPassword=${hasPassword} timeoutMs=${timeoutMs} error=OpenCode password is missing`,
      );
      throw new Error('OpenCode password is missing. Please set OPENCODE_SERVER_PASSWORD');
    }

    try {
      const response = await axios.request<T>({
        method,
        baseURL: baseUrl,
        url: route,
        ...(authEnabled ? { auth: { username, password } } : {}),
        params: options?.params,
        data: options?.data,
        timeout: timeoutMs,
        responseType: options?.responseType,
      });
      return response.data;
    } catch (error: any) {
      const message = error?.message || String(error || 'unknown error');
      const status = error?.response?.status;
      const code = error?.code;
      const isTimeout = this.isTimeoutError(error);
      this.logger.error(
        `[opencode_request_failed] method=${method} url=${requestUrl} username=${username} authEnabled=${authEnabled} hasPassword=${hasPassword} timeoutMs=${timeoutMs} isTimeout=${isTimeout} status=${status || 'unknown'} code=${code || 'none'} error=${message}`,
      );
      if (options?.throwOnError) {
        throw error;
      }
      throw error;
    }
  }

  private buildRequestUrl(baseUrl: string, route: string, params?: Record<string, any>): string {
    const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
    const url = new URL(normalizedRoute, `${baseUrl}/`);
    if (params && typeof params === 'object') {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item === undefined || item === null) continue;
            url.searchParams.append(key, String(item));
          }
          continue;
        }
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private isTimeoutError(error: any): boolean {
    const code = String(error?.code || '').toUpperCase();
    if (code === 'ECONNABORTED') {
      return true;
    }
    const message = String(error?.message || '').toLowerCase();
    return message.includes('timeout');
  }

  private resolveRequestTimeoutMs(route: string, runtime?: OpenCodeRuntimeOptions, requestedTimeoutMs?: number): number {
    if (requestedTimeoutMs !== undefined && requestedTimeoutMs !== null) {
      return this.normalizeTimeoutMs(requestedTimeoutMs, this.defaultRequestTimeoutMs);
    }

    if (runtime?.requestTimeoutMs !== undefined && runtime?.requestTimeoutMs !== null) {
      return this.normalizeTimeoutMs(runtime.requestTimeoutMs, this.defaultRequestTimeoutMs);
    }

    if (this.isMessageRoute(route)) {
      return this.messageRequestTimeoutMs;
    }

    return this.defaultRequestTimeoutMs;
  }

  private isMessageRoute(route: string): boolean {
    const normalizedRoute = route.toLowerCase();
    return normalizedRoute.includes('/session/') && normalizedRoute.endsWith('/message');
  }

  private resolveTimeoutMs(envKey: string, fallback: number): number {
    const raw = this.configService.get<string>(envKey);
    return this.normalizeTimeoutMs(raw, fallback);
  }

  private normalizeTimeoutMs(rawValue: unknown, fallback: number): number {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }
    if (parsed === 0) {
      return 0;
    }
    return Math.max(1000, Math.floor(parsed));
  }

  private parseSsePayload(rawData: string): Record<string, unknown> {
    const value = rawData.trim();
    if (!value) {
      return {};
    }
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { value: parsed };
    } catch {
      return { message: value };
    }
  }

  private async *streamSse(runtime?: OpenCodeRuntimeOptions): AsyncGenerator<{ type: string; payload: Record<string, unknown> }> {
    const stream = await this.request<any>('GET', '/event', {
      responseType: 'stream',
      timeout: 0,
      runtime,
      throwOnError: true,
    });

    let buffer = '';
    let eventType = 'message';
    let dataLines: string[] = [];

    const flush = () => {
      if (dataLines.length === 0) {
        eventType = 'message';
        return null;
      }
      const payload = this.parseSsePayload(dataLines.join('\n'));
      const type = String(payload.type || payload.eventType || payload.kind || eventType || 'message');
      dataLines = [];
      eventType = 'message';
      return { type, payload };
    };

    try {
      for await (const chunk of stream) {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line) {
            const item = flush();
            if (item) {
              yield item;
            }
            continue;
          }

          if (line.startsWith('event:')) {
            eventType = line.slice('event:'.length).trim() || 'message';
            continue;
          }

          if (line.startsWith('data:')) {
            const data = line.slice('data:'.length).trimStart();
            if (data !== '[DONE]') {
              dataLines.push(data);
            }
          }
        }
      }
    } finally {
      if (typeof stream?.destroy === 'function') {
        stream.destroy();
      }
    }
  }

  private resolveSessionId(payload: Record<string, unknown>): string | undefined {
    const directCandidates = [
      payload.sessionId,
      payload.sessionID,
      payload.session_id,
      (payload.path as Record<string, unknown> | undefined)?.id,
      (payload.meta as Record<string, unknown> | undefined)?.sessionId,
      (payload.metadata as Record<string, unknown> | undefined)?.sessionId,
    ];

    for (const value of directCandidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }
}

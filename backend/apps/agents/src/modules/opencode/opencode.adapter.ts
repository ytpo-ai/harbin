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
    // message 路由（/session/{id}/message）是阻塞式等待 opencode 完整执行，
    // 开发任务通常需要 5-15 分钟，默认 30 分钟上限由外层 step timeout 兜底。
    this.messageRequestTimeoutMs = this.resolveTimeoutMs(
      'OPENCODE_MESSAGE_REQUEST_TIMEOUT_MS',
      1800000,
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

  async promptSession(
    input: OpenCodePromptInput,
    options?: { signal?: AbortSignal },
  ): Promise<{ response: string; metadata: Record<string, unknown> }> {
    const result = await this.request<any>('POST', `/session/${encodeURIComponent(input.sessionId)}/message`, {
      data: {
        parts: [{ type: 'text', text: input.prompt }],
        ...(input.model ? { model: input.model } : {}),
      },
      runtime: input.runtime,
      throwOnError: true,
      signal: options?.signal,
    });

    return {
      response: this.extractResponseText(result),
      metadata: (result?.info || {}) as Record<string, unknown>,
    };
  }

  async abortSession(
    sessionId: string,
    runtime?: OpenCodeRuntimeOptions,
  ): Promise<{ response: string; metadata: Record<string, unknown> }> {
    const result = await this.request<any>('POST', `/session/${encodeURIComponent(sessionId)}/abort`, {
      runtime,
      data: {},
    });

    return {
      response: this.extractResponseText(result),
      metadata: (result?.info || {}) as Record<string, unknown>,
    };
  }

  async getSessionStatus(
    sessionId: string,
    runtime?: OpenCodeRuntimeOptions,
  ): Promise<{ active: boolean; lastActivityAt?: string }> {
    try {
      const session = await this.request<any>('GET', `/session/${encodeURIComponent(sessionId)}`, {
        runtime,
        timeout: 5000,
        throwOnError: true,
      });

      const messages = this.extractSessionMessages(session);
      const lastAssistantMessage = this.findLastAssistantMessage(messages);
      const sessionState = String(session?.status || session?.state || '').trim().toLowerCase();
      const activeBySessionState = this.isActiveSessionState(sessionState);
      const activeByAssistantMessage = this.isActiveMessage(lastAssistantMessage);
      const lastActivityAt = this.resolveLastActivityAt(lastAssistantMessage, session);

      return {
        active: activeBySessionState || activeByAssistantMessage,
        ...(lastActivityAt ? { lastActivityAt } : {}),
      };
    } catch {
      return { active: true };
    }
  }

  private extractResponseText(result: any): string {
    const direct = [result?.info?.content, result?.content, result?.message, result?.output];
    for (const value of direct) {
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }

    const candidates = [result?.parts, result?.info?.parts, result?.payload?.parts];
    for (const parts of candidates) {
      const text = this.extractTextFromParts(parts);
      if (text) {
        return text;
      }
    }

    return '';
  }

  private extractTextFromParts(parts: unknown): string {
    if (!Array.isArray(parts)) {
      return '';
    }

    const chunks: string[] = [];
    for (const part of parts) {
      if (!part || typeof part !== 'object' || Array.isArray(part)) {
        continue;
      }
      const row = part as Record<string, unknown>;
      if (typeof row.text === 'string' && row.text.trim()) {
        chunks.push(row.text);
        continue;
      }
      if (typeof row.content === 'string' && row.content.trim()) {
        chunks.push(row.content);
      }
    }

    return chunks.join('').trim();
  }

  private extractSessionMessages(session: unknown): Array<Record<string, unknown>> {
    if (!session || typeof session !== 'object' || Array.isArray(session)) {
      return [];
    }
    const data = session as Record<string, unknown>;
    const direct = data.messages;
    if (Array.isArray(direct)) {
      return direct.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
    }
    const nestedInfo = data.info;
    if (nestedInfo && typeof nestedInfo === 'object' && !Array.isArray(nestedInfo)) {
      const nestedMessages = (nestedInfo as Record<string, unknown>).messages;
      if (Array.isArray(nestedMessages)) {
        return nestedMessages.filter(
          (item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'),
        );
      }
    }
    return [];
  }

  private findLastAssistantMessage(messages: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const role = String(message.role || '').trim().toLowerCase();
      if (role === 'assistant') {
        return message;
      }
    }
    return undefined;
  }

  private isActiveMessage(message: Record<string, unknown> | undefined): boolean {
    if (!message) {
      return false;
    }
    const status = String(message.status || message.state || '').trim().toLowerCase();
    if (!status) {
      return true;
    }
    return this.isActiveSessionState(status);
  }

  private isActiveSessionState(status: string): boolean {
    if (!status) {
      return false;
    }
    return status === 'pending' || status === 'running' || status === 'in_progress' || status === 'processing';
  }

  private resolveLastActivityAt(
    message: Record<string, unknown> | undefined,
    session: unknown,
  ): string | undefined {
    const candidates: unknown[] = [
      message?.updatedAt,
      message?.createdAt,
      message?.timestamp,
      (session as Record<string, unknown> | undefined)?.updatedAt,
      (session as Record<string, unknown> | undefined)?.createdAt,
    ];
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
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
      signal?: AbortSignal;
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
        signal: options?.signal,
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
      return undefined as unknown as T;
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

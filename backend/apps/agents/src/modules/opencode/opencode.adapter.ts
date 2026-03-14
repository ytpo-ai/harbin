import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { Method } from 'axios';
import {
  OpenCodeAdapterEvent,
  OpenCodeAdapterSessionInfo,
  OpenCodeCreateSessionInput,
  OpenCodePromptInput,
} from './contracts/opencode.contract';

@Injectable()
export class OpenCodeAdapter {
  private readonly logger = new Logger(OpenCodeAdapter.name);

  constructor(private readonly configService: ConfigService) {}

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
      throwOnError: true,
    });

    return {
      response: String(result?.info?.content || result?.content || ''),
      metadata: (result?.info || {}) as Record<string, unknown>,
    };
  }

  async *subscribeEvents(sessionId?: string): AsyncGenerator<OpenCodeAdapterEvent> {
    for await (const event of this.streamSse()) {
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

  private getBaseUrl(): string {
    return String(this.configService.get<string>('OPENCODE_SERVER_URL') || 'http://localhost:4096')
      .trim()
      .replace(/\/+$/, '');
  }

  private getPassword(): string {
    return String(this.configService.get<string>('OPENCODE_SERVER_PASSWORD') || '').trim();
  }

  private async request<T = any>(
    method: Method,
    route: string,
    options?: {
      params?: Record<string, any>;
      data?: any;
      timeout?: number;
      responseType?: 'json' | 'stream';
      throwOnError?: boolean;
    },
  ): Promise<T> {
    const password = this.getPassword();
    if (!password) {
      throw new Error('OpenCode password is missing. Please set OPENCODE_SERVER_PASSWORD');
    }

    try {
      const response = await axios.request<T>({
        method,
        baseURL: this.getBaseUrl(),
        url: route,
        auth: { username: 'opencode', password },
        params: options?.params,
        data: options?.data,
        timeout: options?.timeout ?? 10000,
        responseType: options?.responseType,
      });
      return response.data;
    } catch (error: any) {
      const message = error?.message || String(error || 'unknown error');
      this.logger.error(`OpenCode API request failed: ${method} ${route} - ${message}`);
      if (options?.throwOnError) {
        throw error;
      }
      throw error;
    }
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

  private async *streamSse(): AsyncGenerator<{ type: string; payload: Record<string, unknown> }> {
    const stream = await this.request<any>('GET', '/event', {
      responseType: 'stream',
      timeout: 0,
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

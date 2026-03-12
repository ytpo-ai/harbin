import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OpenCodeAdapterEvent,
  OpenCodeAdapterSessionInfo,
  OpenCodeCreateSessionInput,
  OpenCodePromptInput,
} from './contracts/opencode.contract';

@Injectable()
export class OpenCodeAdapter {
  private readonly logger = new Logger(OpenCodeAdapter.name);
  private client: any;
  private clientInitPromise?: Promise<void>;

  constructor(private readonly configService: ConfigService) {}

  async createSession(input: OpenCodeCreateSessionInput): Promise<OpenCodeAdapterSessionInfo> {
    const client = await this.requireClient();
    const session = await client.session.create({
      body: {
        title: input.title || 'OpenCode Runtime Session',
        ...(input.config || {}),
      },
    });

    return {
      id: String(session?.data?.id || ''),
      title: session?.data?.title,
      createdAt: session?.data?.createdAt,
    };
  }

  async promptSession(input: OpenCodePromptInput): Promise<{ response: string; metadata: Record<string, unknown> }> {
    const client = await this.requireClient();
    const result = await client.session.prompt({
      path: { id: input.sessionId },
      body: {
        parts: [{ type: 'text', text: input.prompt }],
        ...(input.model ? { model: input.model } : {}),
      },
    });

    return {
      response: String(result?.data?.info?.content || result?.data?.content || ''),
      metadata: (result?.data?.info || {}) as Record<string, unknown>,
    };
  }

  async *subscribeEvents(sessionId?: string): AsyncGenerator<OpenCodeAdapterEvent> {
    const client = await this.requireClient();
    if (!client.event?.subscribe) {
      throw new Error('OpenCode event stream is not available');
    }

    const events = await client.event.subscribe();
    for await (const event of events.stream) {
      const payload = this.normalizePayload(event);
      const eventSessionId = this.resolveSessionId(payload);
      if (sessionId && eventSessionId && eventSessionId !== sessionId) {
        continue;
      }

      yield {
        type: String(payload.type || payload.eventType || payload.kind || 'unknown'),
        sessionId: eventSessionId,
        timestamp: new Date().toISOString(),
        payload,
        raw: event,
      };
    }
  }

  private async requireClient(): Promise<any> {
    if (!this.clientInitPromise) {
      this.clientInitPromise = this.initializeClient();
    }
    await this.clientInitPromise;

    if (!this.client) {
      throw new Error('OpenCode client is not initialized');
    }
    return this.client;
  }

  private async initializeClient(): Promise<void> {
    const baseUrl = this.configService.get<string>('OPENCODE_SERVER_URL') || 'http://localhost:4096';
    const password = this.configService.get<string>('OPENCODE_SERVER_PASSWORD');

    try {
      const createClient = await this.loadClientFactory();
      this.client = createClient({ baseUrl, password });
      this.logger.log(`OpenCode adapter initialized with baseUrl=${baseUrl}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'unknown error');
      this.logger.error(`OpenCode adapter initialization failed: ${message}`);
      this.client = null;
      throw error;
    }
  }

  private async loadClientFactory(): Promise<(options: { baseUrl: string; password?: string }) => any> {
    let mod: any;
    try {
      mod = await import('@opencode-ai/sdk');
    } catch (error) {
      throw new Error('Failed to import @opencode-ai/sdk');
    }

    const factory = mod?.createOpencodeClient ?? mod?.default?.createOpencodeClient ?? mod?.default;
    if (typeof factory !== 'function') {
      throw new Error('createOpencodeClient factory not found in @opencode-ai/sdk exports');
    }
    return factory;
  }

  private normalizePayload(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return { value };
  }

  private resolveSessionId(payload: Record<string, unknown>): string | undefined {
    const direct = payload.sessionId;
    if (typeof direct === 'string' && direct.trim()) {
      return direct.trim();
    }

    const path = payload.path;
    if (path && typeof path === 'object' && !Array.isArray(path)) {
      const pathId = (path as Record<string, unknown>).id;
      if (typeof pathId === 'string' && pathId.trim()) {
        return pathId.trim();
      }
    }

    return undefined;
  }
}

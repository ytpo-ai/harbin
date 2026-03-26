import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { Method } from 'axios';

@Injectable()
export class OpencodeService {
  private readonly logger = new Logger(OpencodeService.name);
  private readonly modelCatalogTtlMs = 60_000;
  private recentEvents: Array<{ timestamp: string; event: any }> = [];
  private backgroundSubscribed = false;
  private modelCatalogCache: {
    expiresAt: number;
    supported: Set<string>;
  } | null = null;

  constructor(private configService: ConfigService) {
    this.initializeClient().catch((error) => {
      this.logger.error(`Failed to initialize OpenCode API client: ${error?.message || error}`);
    });
  }

  private async initializeClient(): Promise<void> {
    const baseUrl = this.getBaseUrl();
    this.logger.log(`OpenCode API client initialized with baseUrl: ${baseUrl}`);
    await this.startBackgroundEventStream();
  }

  private getBaseUrl(baseUrl?: string): string {
    return String(baseUrl || this.configService.get<string>('OPENCODE_SERVER_URL') || 'http://localhost:4096')
      .trim()
      .replace(/\/+$/, '');
  }

  private getPassword(): string {
    return String(this.configService.get<string>('OPENCODE_SERVER_PASSWORD') || '').trim();
  }

  private buildAuth(authEnable?: boolean) {
    if (authEnable !== true) {
      return undefined;
    }

    const password = this.getPassword();
    if (!password) {
      throw new Error('OpenCode password is missing. Please set OPENCODE_SERVER_PASSWORD');
    }
    return { username: 'opencode', password };
  }

  private async request<T = any>(
    method: Method,
    route: string,
    options?: {
      baseUrl?: string;
      params?: Record<string, any>;
      data?: any;
      timeout?: number;
      responseType?: 'json' | 'stream';
      authEnable?: boolean;
      throwOnError?: boolean;
    },
  ): Promise<T> {
    const baseURL = this.getBaseUrl(options?.baseUrl);
    const auth = this.buildAuth(options?.authEnable);
    const requestUrl = `${baseURL}${route}`;

    try {
      const response = await axios.request<T>({
        method,
        baseURL,
        url: route,
        ...(auth ? { auth } : {}),
        params: options?.params,
        data: options?.data,
        timeout: options?.timeout ?? 10000,
        responseType: options?.responseType,
      });
      return response.data;
    } catch (error: any) {
      const message = error?.message || String(error || 'unknown error');
      const status = Number(error?.response?.status || 0) || 'N/A';
      if (options?.throwOnError) {
        this.logger.error(`OpenCode API request failed: ${method} ${requestUrl} - status=${status} - ${message}`);
        throw error;
      }
      this.logger.warn(`OpenCode API request failed: ${method} ${requestUrl} - status=${status} - ${message}`);
      throw error;
    }
  }

  private matchesProjectPath(source: any, projectPath: string): boolean {
    if (!projectPath) {
      return false;
    }

    const normalized = String(projectPath).toLowerCase();
    const candidates = [
      source?.path,
      source?.projectPath,
      source?.worktree,
      source?.cwd,
      source?.root,
      source?.directory,
      source?.project?.path,
      source?.project?.worktree,
      source?.project?.root,
      source?.properties?.path,
      source?.properties?.projectPath,
      source?.properties?.worktree,
      source?.properties?.cwd,
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    return candidates.some((value) => value.includes(normalized) || normalized.includes(value));
  }

  private resolveEventSessionId(payload: Record<string, unknown>): string | undefined {
    const properties =
      payload.properties && typeof payload.properties === 'object' && !Array.isArray(payload.properties)
        ? (payload.properties as Record<string, unknown>)
        : undefined;
    const info =
      properties?.info && typeof properties.info === 'object' && !Array.isArray(properties.info)
        ? (properties.info as Record<string, unknown>)
        : undefined;
    const part =
      properties?.part && typeof properties.part === 'object' && !Array.isArray(properties.part)
        ? (properties.part as Record<string, unknown>)
        : undefined;
    const status =
      properties?.status && typeof properties.status === 'object' && !Array.isArray(properties.status)
        ? (properties.status as Record<string, unknown>)
        : undefined;

    const candidates = [
      payload.sessionId,
      payload.sessionID,
      payload.session_id,
      (payload.path as Record<string, unknown> | undefined)?.id,
      (payload.meta as Record<string, unknown> | undefined)?.sessionId,
      (payload.metadata as Record<string, unknown> | undefined)?.sessionId,
      properties?.sessionId,
      properties?.sessionID,
      properties?.session_id,
      info?.sessionId,
      info?.sessionID,
      info?.session_id,
      part?.sessionId,
      part?.sessionID,
      part?.session_id,
      status?.sessionId,
      status?.sessionID,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return undefined;
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

  private normalizeModelKey(providerID: string, modelID: string): string {
    return `${String(providerID || '').trim().toLowerCase()}::${String(modelID || '').trim().toLowerCase()}`;
  }

  private extractModelCandidates(input: unknown, acc: string[], depth = 0): void {
    if (depth > 4 || input === null || input === undefined) {
      return;
    }

    if (typeof input === 'string') {
      const normalized = input.trim();
      if (normalized.includes('/')) {
        const [provider, model] = normalized.split('/');
        if (provider && model) {
          acc.push(this.normalizeModelKey(provider, model));
        }
      }
      return;
    }

    if (Array.isArray(input)) {
      for (const row of input) {
        this.extractModelCandidates(row, acc, depth + 1);
      }
      return;
    }

    if (typeof input !== 'object') {
      return;
    }

    const row = input as Record<string, unknown>;
    const provider =
      (typeof row.providerID === 'string' && row.providerID) ||
      (typeof row.providerId === 'string' && row.providerId) ||
      (typeof row.provider === 'string' && row.provider) ||
      (typeof row.vendor === 'string' && row.vendor) ||
      '';
    const model =
      (typeof row.modelID === 'string' && row.modelID) ||
      (typeof row.modelId === 'string' && row.modelId) ||
      (typeof row.model === 'string' && row.model) ||
      (typeof row.id === 'string' && row.id) ||
      '';
    if (provider && model) {
      acc.push(this.normalizeModelKey(provider, model));
    }

    const nestedCandidates = [
      row.models,
      row.modelList,
      row.providers,
      row.items,
      row.data,
      row.available,
      row.config,
      row.registry,
    ];
    for (const nested of nestedCandidates) {
      this.extractModelCandidates(nested, acc, depth + 1);
    }
  }

  private async getSupportedModelCatalog(forceRefresh = false): Promise<{ checked: boolean; supported: Set<string> }> {
    const now = Date.now();
    if (!forceRefresh && this.modelCatalogCache && this.modelCatalogCache.expiresAt > now) {
      return {
        checked: true,
        supported: this.modelCatalogCache.supported,
      };
    }

    const routes = ['/model', '/models', '/config'];
    const supported = new Set<string>();
    let checked = false;

    for (const route of routes) {
      try {
        const payload = await this.request<any>('GET', route, { throwOnError: true, timeout: 5000 });
        checked = true;
        const candidates: string[] = [];
        this.extractModelCandidates(payload, candidates);
        candidates.forEach((modelKey) => supported.add(modelKey));
        if (supported.size > 0) {
          break;
        }
      } catch (error: any) {
        const status = Number(error?.response?.status || 0);
        if (status === 404) {
          continue;
        }
        this.logger.warn(`Unable to read OpenCode model catalog from ${route}: ${error?.message || error}`);
      }
    }

    if (checked && supported.size > 0) {
      this.modelCatalogCache = {
        expiresAt: now + this.modelCatalogTtlMs,
        supported,
      };
      return { checked: true, supported };
    }

    return {
      checked: false,
      supported: new Set<string>(),
    };
  }

  async ensureModelSupported(model?: { providerID: string; modelID: string }): Promise<void> {
    if (!model?.providerID || !model?.modelID) {
      return;
    }

    const catalog = await this.getSupportedModelCatalog();
    if (!catalog.checked) {
      return;
    }

    const modelKey = this.normalizeModelKey(model.providerID, model.modelID);
    if (!catalog.supported.has(modelKey)) {
      const refreshedCatalog = await this.getSupportedModelCatalog(true);
      if (!refreshedCatalog.checked || refreshedCatalog.supported.has(modelKey)) {
        return;
      }
      throw new Error(
        `OpenCode 不支持当前 Agent 模型: ${model.providerID}/${model.modelID}。请先在 OpenCode 配置该模型，或切换 Agent 模型。`,
      );
    }
  }

  private extractOpencodeErrorMessage(error: any): string {
    const responseData = error?.response?.data;
    const candidates = [
      responseData?.message,
      responseData?.error,
      responseData?.detail,
      responseData?.info?.message,
      error?.message,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return 'Unknown OpenCode error';
  }

  private async *streamSse(baseUrl?: string, authEnable?: boolean): AsyncGenerator<{ type: string; payload: Record<string, unknown> }> {
    const stream = await this.request<any>('GET', '/event', {
      baseUrl,
      responseType: 'stream',
      timeout: 0,
      authEnable,
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

  private async startBackgroundEventStream(): Promise<void> {
    if (this.backgroundSubscribed) {
      return;
    }
    if (!this.getPassword()) {
      return;
    }

    this.backgroundSubscribed = true;

    (async () => {
      try {
        for await (const event of this.streamSse(undefined, true)) {
          this.recentEvents.unshift({
            timestamp: new Date().toISOString(),
            event: {
              ...event.payload,
              type: event.type,
              sessionId: this.resolveEventSessionId(event.payload),
            },
          });
          if (this.recentEvents.length > 500) {
            this.recentEvents = this.recentEvents.slice(0, 500);
          }
        }
      } catch (error: any) {
        this.logger.warn(`Background OpenCode event stream stopped: ${error?.message || error}`);
      } finally {
        this.backgroundSubscribed = false;
      }
    })();
  }

  async sendPrompt(options: {
    sessionId?: string;
    projectPath?: string;
    prompt: string;
    model?: { providerID: string; modelID: string };
    config?: Record<string, any>;
  }): Promise<any> {
    try {
      let sessionId = options.sessionId;

      if (!sessionId && options.projectPath) {
        const session = await this.createSession({
          projectPath: options.projectPath,
          config: options.config,
        });
        sessionId = session.id;
      }

      if (!sessionId) {
        throw new Error('Either sessionId or projectPath must be provided');
      }

      const result = await this.request<any>('POST', `/session/${encodeURIComponent(sessionId)}/message`, {
        data: {
          parts: [{ type: 'text', text: options.prompt }],
          ...(options.model ? { model: options.model } : {}),
        },
        throwOnError: true,
      });

      return {
        content: result?.info?.content || result?.content || '',
        sessionId,
        metadata: result?.info || {},
      };
    } catch (error: any) {
      this.logger.error(`Error sending prompt to opencode: ${error?.message || error}`, error?.stack);
      throw new Error(`OpenCode prompt failed: ${error?.message || error}`);
    }
  }

  async createSession(options: {
    projectPath: string;
    title?: string;
    config?: Record<string, any>;
    model?: { providerID: string; modelID: string };
    baseUrl?: string;
    authEnable?: boolean;
  }): Promise<any> {
    const doCreate = async () => {
      const directory =
        String(options?.projectPath || options?.config?.directory || options?.config?.projectPath || '').trim() || undefined;

      const body = {
        title: options.title || 'R&D Task Session',
        ...(options.model ? { model: options.model } : {}),
        ...(options.config || {}),
      };

      const session = await this.request<any>('POST', '/session', {
        baseUrl: options.baseUrl,
        authEnable: options.authEnable,
        params: directory ? { directory } : undefined,
        data: body,
        throwOnError: true,
      });

      this.logger.log(`Created OpenCode session: ${session?.id}`);

      return {
        id: session?.id,
        title: session?.title,
        createdAt: session?.createdAt,
      };
    };

    try {
      return await doCreate();
    } catch (error: any) {
      const message = this.extractOpencodeErrorMessage(error);
      this.logger.error(`Error creating opencode session: ${message}`, error?.stack);
      throw new Error(`Failed to create OpenCode session: ${message}`);
    }
  }

  async getSession(sessionId: string, baseUrl?: string, options?: { authEnable?: boolean }): Promise<any | null> {
    try {
      return await this.request<any>('GET', `/session/${encodeURIComponent(sessionId)}`, {
        baseUrl,
        authEnable: options?.authEnable,
        throwOnError: true,
      });
    } catch (error: any) {
      this.logger.error(`Error getting session: ${error?.message || error}`, error?.stack);
      return null;
    }
  }

  async promptSession(
    sessionId: string,
    prompt: string,
    model?: { providerID: string; modelID: string },
    options?: { baseUrl?: string; authEnable?: boolean },
  ): Promise<any> {
    const requestRoute = `/session/${encodeURIComponent(sessionId)}/message`;
    const requestUrl = `${this.getBaseUrl(options?.baseUrl)}${requestRoute}`;
    const doPrompt = () =>
      this.request<any>('POST', requestRoute, {
        baseUrl: options?.baseUrl,
        authEnable: options?.authEnable,
        data: {
          parts: [{ type: 'text', text: prompt }],
          ...(model ? { model } : {}),
        },
        throwOnError: true,
      });

    try {
      return await doPrompt();
    } catch (error: any) {
      const message = this.extractOpencodeErrorMessage(error);
      this.logger.error(`Error prompting session via ${requestUrl}: ${message}`, error?.stack);
      const wrapped: any = new Error(`Failed to prompt session: ${message}`);
      wrapped.status = Number(error?.response?.status || 0) || undefined;
      wrapped.cause = error;
      throw wrapped;
    }
  }

  async getSessionHistory(sessionId: string, options?: { baseUrl?: string; authEnable?: boolean }): Promise<any> {
    try {
      const messages = await this.request<any>('GET', `/session/${encodeURIComponent(sessionId)}/message`, {
        baseUrl: options?.baseUrl,
        authEnable: options?.authEnable,
        throwOnError: true,
      });
      return Array.isArray(messages) ? messages : [];
    } catch (error: any) {
      this.logger.error(`Error getting session history: ${error?.message || error}`, error?.stack);
      throw new Error(`Failed to get session history: ${error?.message || error}`);
    }
  }

  async listSessions(baseUrl?: string, options?: { authEnable?: boolean }): Promise<any[]> {
    try {
      const rows = await this.request<any>('GET', '/session', {
        baseUrl,
        authEnable: options?.authEnable,
        throwOnError: true,
      });
      return Array.isArray(rows) ? rows : [];
    } catch (error: any) {
      this.logger.error(`Error listing sessions: ${error?.message || error}`, error?.stack);
      return [];
    }
  }

  async listSessionsByProject(projectPath: string, baseUrl?: string, options?: { authEnable?: boolean }): Promise<any[]> {
    if (!projectPath) {
      return this.listSessions(baseUrl, options);
    }

    try {
      const rows = await this.request<any>('GET', '/session', {
        baseUrl,
        params: { directory: projectPath },
        authEnable: options?.authEnable,
        throwOnError: true,
      });
      if (Array.isArray(rows) && rows.length > 0) {
        return rows;
      }
    } catch (error: any) {
      this.logger.warn(`List sessions by directory failed: ${error?.message || error}`);
    }

    const sessions = await this.listSessions(baseUrl, options);
    return sessions.filter((session) => this.matchesProjectPath(session, projectPath));
  }

  getRecentEvents(limit = 200, projectPath?: string): any[] {
    let events = this.recentEvents;
    if (projectPath) {
      const filtered = events.filter((item) => this.matchesProjectPath(item.event, projectPath));
      if (filtered.length > 0) {
        events = filtered;
      }
    }

    return events.slice(0, limit).map((item) => ({
      ...item.event,
      timestamp: item.timestamp,
    }));
  }

  async listProjects(baseUrl?: string, options?: { throwOnError?: boolean; authEnable?: boolean }): Promise<any[]> {
    try {
      const rows = await this.request<any>('GET', '/project', {
        baseUrl,
        authEnable: options?.authEnable,
        throwOnError: true,
      });
      return Array.isArray(rows) ? rows : [];
    } catch (error: any) {
      this.logger.error(`Error listing projects: ${error?.message || error}`, error?.stack);
      if (options?.throwOnError) {
        throw error;
      }
      return [];
    }
  }

  async getCurrentProject(directory?: string): Promise<any | null> {
    try {
      const project = await this.request<any>('GET', '/project/current', {
        params: directory ? { directory } : undefined,
        throwOnError: true,
      });
      return project || null;
    } catch (error: any) {
      this.logger.error(`Error getting current project: ${error?.message || error}`, error?.stack);
      return null;
    }
  }

  async subscribeEvents(handlers: {
    onEvent: (event: any) => void;
    onError?: (error: any) => void;
    onComplete?: () => void;
  }, options?: { baseUrl?: string; authEnable?: boolean }): Promise<() => void> {
    let active = true;
    const iterator = this.streamSse(options?.baseUrl, options?.authEnable)[Symbol.asyncIterator]();

    (async () => {
      try {
        while (active) {
          const next = await iterator.next();
          if (next.done || !active) {
            break;
          }

          const event = {
            ...next.value.payload,
            type: next.value.type,
            sessionId: this.resolveEventSessionId(next.value.payload),
          };
          handlers.onEvent(event);
        }
      } catch (error) {
        handlers.onError?.(error);
      } finally {
        handlers.onComplete?.();
      }
    })();

    return () => {
      if (!active) {
        return;
      }
      active = false;
      iterator.return?.(undefined as any).catch((error: any) => {
        this.logger.warn(`Failed to close OpenCode event stream: ${error?.message || error}`);
      });
    };
  }

  async getCurrentContext(): Promise<{
    project: any;
    path: any;
    sessions: any[];
    currentSession: any | null;
    available: boolean;
    error?: string;
  }> {
    if (!this.getPassword()) {
      return {
        project: null,
        path: null,
        sessions: [],
        currentSession: null,
        available: false,
        error: 'OpenCode password is not configured',
      };
    }

    try {
      const configuredDirectory = String(this.configService.get<string>('OPENCODE_PROJECT_PATH') || '').trim() || undefined;

      const [projectResult, sessionsResult] = await Promise.allSettled([
        this.getCurrentProject(configuredDirectory),
        this.listSessions(undefined, { authEnable: true }),
      ]);

      const project = projectResult.status === 'fulfilled' ? projectResult.value : null;
      const sessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : [];

      const sortedSessions = [...sessions].sort((a, b) => {
        const left = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
        const right = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
        return left - right;
      });

      const resolvedPath =
        project?.directory ||
        project?.path ||
        project?.root ||
        configuredDirectory ||
        sortedSessions[0]?.directory ||
        null;

      return {
        project,
        path: resolvedPath ? { cwd: resolvedPath, root: resolvedPath } : null,
        sessions,
        currentSession: sortedSessions[0] || null,
        available: true,
      };
    } catch (error: any) {
      return {
        project: null,
        path: null,
        sessions: [],
        currentSession: null,
        available: false,
        error: error?.message || 'Failed to load OpenCode context',
      };
    }
  }

  async executeCommand(sessionId: string, command: string): Promise<any> {
    try {
      const result = await this.request<any>('POST', `/session/${encodeURIComponent(sessionId)}/command`, {
        data: { command },
        throwOnError: true,
      });

      return {
        content: result?.info?.content || result?.content || '',
        metadata: result?.info || {},
      };
    } catch (error: any) {
      this.logger.error(`Error executing command: ${error?.message || error}`, error?.stack);
      throw new Error(`Failed to execute command: ${error?.message || error}`);
    }
  }

  async getProjectInfo(projectPath: string): Promise<any> {
    try {
      return (await this.getCurrentProject(projectPath)) || {};
    } catch (error: any) {
      this.logger.error(`Error getting project info: ${error?.message || error}`, error?.stack);
      return {};
    }
  }

  async searchFiles(projectPath: string, pattern: string): Promise<any> {
    try {
      const results = await this.request<any>('GET', '/find/text', {
        params: {
          directory: projectPath,
          pattern,
        },
        throwOnError: true,
      });
      return Array.isArray(results) ? results : [];
    } catch (error: any) {
      this.logger.error(`Error searching files: ${error?.message || error}`, error?.stack);
      return [];
    }
  }

  async readFile(filePath: string): Promise<string> {
    try {
      const result = await this.request<any>('GET', '/file/read', {
        params: { path: filePath },
        throwOnError: true,
      });
      return result?.content || '';
    } catch (error: any) {
      this.logger.error(`Error reading file: ${error?.message || error}`, error?.stack);
      throw new Error(`Failed to read file: ${error?.message || error}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const health = await this.request<any>('GET', '/health', {
        throwOnError: true,
      });
      return health?.healthy === true;
    } catch (error: any) {
      this.logger.warn(`OpenCode health check failed: ${error?.message || error}`);
      return false;
    }
  }
}

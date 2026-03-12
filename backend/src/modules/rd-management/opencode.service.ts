import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as path from 'path';
import { pathToFileURL } from 'url';
// import { createOpencode } from "@opencode-ai/sdk"

@Injectable()
export class OpencodeService {
  private readonly logger = new Logger(OpencodeService.name);
  private client: any;
  private readonly endpointClients = new Map<string, any>();
  private recentEvents: Array<{ timestamp: string; event: any }> = [];
  private backgroundSubscribed = false;

  constructor(private configService: ConfigService) {
    this.initializeClient().catch((error) => {
      this.logger.error(`Failed to initialize OpenCode client: ${error?.message || error}`);
    });
  }
  private async buildClient(baseUrl: string): Promise<any> {
    try {
      let mod: any;
      try {
        mod = await import('@opencode-ai/sdk');
      } catch (e) {
        // Fallback: try to load the package's built file directly by resolving package.json
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          // @ts-ignore
          const pkgJsonPath = require.resolve('@opencode-ai/sdk/package.json');
          const distPath = path.join(path.dirname(pkgJsonPath), 'dist', 'index.js');
          mod = await import(pathToFileURL(distPath).href);
        } catch (e2) {
          try {
            // as a last resort try to require the deep import (may fail under pure ESM runtime)
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            // @ts-ignore
            mod = require('@opencode-ai/sdk/dist/index.js');
          } catch (e3) {
            throw e; // rethrow original import error
          }
        }
      }
      // handle different possible export shapes
      const createOpencodeClient = mod?.createOpencodeClient ?? mod?.default?.createOpencodeClient ?? mod?.default ?? mod;
      if (typeof createOpencodeClient !== 'function') {
        throw new Error('createOpencode factory not found in @opencode-ai/sdk exports');
      }

      return createOpencodeClient({
        baseUrl,
        password: this.configService.get<string>('OPENCODE_SERVER_PASSWORD'),
      });
    } catch (error: any) {
      this.logger.error(`Failed to build OpenCode client(${baseUrl}): ${error?.message || error}`);
      throw error;
    }
  }

  private async initializeClient(): Promise<void> {
    const baseUrl = this.configService.get<string>('OPENCODE_SERVER_URL') || 'http://localhost:4096';

    try {
      this.client = await this.buildClient(baseUrl);
      this.logger.log(`OpenCode client initialized with baseUrl: ${baseUrl}`);
      this.startBackgroundEventStream();
    } catch (error: any) {
      this.logger.error(`Failed to initialize OpenCode client: ${error?.message || error}`);
    }
  }

  private async getClientByEndpoint(baseUrl?: string): Promise<any> {
    const normalizedBaseUrl = String(baseUrl || '').trim();
    if (!normalizedBaseUrl) {
      return this.requireClient();
    }

    if (this.endpointClients.has(normalizedBaseUrl)) {
      return this.endpointClients.get(normalizedBaseUrl);
    }

    const client = await this.buildClient(normalizedBaseUrl);
    this.endpointClients.set(normalizedBaseUrl, client);
    return client;
  }

  private async startBackgroundEventStream(): Promise<void> {
    if (this.backgroundSubscribed) {
      return;
    }
    const client = this.getClient();
    if (!client?.event?.subscribe) {
      return;
    }

    this.backgroundSubscribed = true;

    try {
      const events = await client.event.subscribe();
      (async () => {
        try {
          for await (const event of events.stream) {
            this.recentEvents.unshift({
              timestamp: new Date().toISOString(),
              event,
            });
            if (this.recentEvents.length > 500) {
              this.recentEvents = this.recentEvents.slice(0, 500);
            }
          }
        } catch (error) {
          this.logger.warn(`Background OpenCode event stream stopped: ${error?.message || error}`);
          this.backgroundSubscribed = false;
        }
      })();
    } catch (error) {
      this.logger.warn(`Failed to start background OpenCode event stream: ${error?.message || error}`);
      this.backgroundSubscribed = false;
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
      source?.project?.path,
      source?.project?.worktree,
      source?.properties?.path,
      source?.properties?.projectPath,
      source?.properties?.worktree,
      source?.properties?.cwd,
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    return candidates.some((value) => value.includes(normalized) || normalized.includes(value));
  }

  private getClient(): any {
    if (!this.client) {
      this.initializeClient();
    }
    return this.client;
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return String(baseUrl || '').trim().replace(/\/+$/, '');
  }

  private async listProjectsByHttp(baseUrl?: string): Promise<any[]> {
    const normalizedBaseUrl = this.normalizeBaseUrl(
      baseUrl || this.configService.get<string>('OPENCODE_SERVER_URL') || 'http://localhost:4096',
    );
    const password = this.configService.get<string>('OPENCODE_SERVER_PASSWORD') || '';
    if (!password) {
      return [];
    }

    try {
      const response = await axios.get(`${normalizedBaseUrl}/project`, {
        auth: { username: 'opencode', password },
        timeout: 8000,
      });
      return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
      this.logger.warn(`HTTP fallback listProjects failed (${normalizedBaseUrl}): ${error?.message || error}`);
      return [];
    }
  }

  private async listSessionsByHttp(baseUrl?: string, directory?: string): Promise<any[]> {
    const normalizedBaseUrl = this.normalizeBaseUrl(
      baseUrl || this.configService.get<string>('OPENCODE_SERVER_URL') || 'http://localhost:4096',
    );
    const password = this.configService.get<string>('OPENCODE_SERVER_PASSWORD') || '';
    if (!password) {
      return [];
    }

    try {
      const response = await axios.get(`${normalizedBaseUrl}/session`, {
        auth: { username: 'opencode', password },
        params: directory ? { directory } : undefined,
        timeout: 8000,
      });
      return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
      this.logger.warn(`HTTP fallback listSessions failed (${normalizedBaseUrl}): ${error?.message || error}`);
      return [];
    }
  }

  private async getSessionByHttp(sessionId: string, baseUrl?: string): Promise<any | null> {
    const normalizedBaseUrl = this.normalizeBaseUrl(
      baseUrl || this.configService.get<string>('OPENCODE_SERVER_URL') || 'http://localhost:4096',
    );
    const password = this.configService.get<string>('OPENCODE_SERVER_PASSWORD') || '';
    if (!password) {
      return null;
    }

    try {
      const response = await axios.get(`${normalizedBaseUrl}/session/${encodeURIComponent(sessionId)}`, {
        auth: { username: 'opencode', password },
        timeout: 8000,
      });
      return response.data || null;
    } catch (error: any) {
      this.logger.warn(`HTTP fallback getSession failed (${normalizedBaseUrl}): ${error?.message || error}`);
      return null;
    }
  }

  private requireClient(): any {
    const client = this.getClient();
    if (!client) {
      throw new Error('OpenCode client is not initialized. Please install @opencode-ai/sdk and verify OPENCODE_SERVER_URL');
    }
    return client;
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

      // 如果没有sessionId，创建一个新session
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

      // 发送prompt
      const client = this.requireClient();
      const result = await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text: options.prompt }],
          ...(options.model && { model: options.model }),
        },
      });

      return {
        content: result.data?.info?.content || result.data?.content || '',
        sessionId,
        metadata: result.data?.info || {},
      };
    } catch (error) {
      this.logger.error(`Error sending prompt to opencode: ${error.message}`, error.stack);
      throw new Error(`OpenCode prompt failed: ${error.message}`);
    }
  }

  async createSession(options: {
    projectPath: string;
    title?: string;
    config?: Record<string, any>;
  }): Promise<any> {
    try {
      const client = this.requireClient();
      const session = await client.session.create({
        body: {
          title: options.title || 'R&D Task Session',
          ...options.config,
        },
      });

      this.logger.log(`Created OpenCode session: ${session.data?.id}`);

      return {
        id: session.data?.id,
        title: session.data?.title,
        createdAt: session.data?.createdAt,
      };
    } catch (error) {
      this.logger.error(`Error creating opencode session: ${error.message}`, error.stack);
      throw new Error(`Failed to create OpenCode session: ${error.message}`);
    }
  }

  async getSession(sessionId: string): Promise<any | null> {
    try {
      const client = this.requireClient();
      if (!client.session?.get) {
        return this.getSessionByHttp(sessionId);
      }
      const session = await client.session.get({ path: { id: sessionId } });
      if (session.data) {
        return session.data;
      }
      return this.getSessionByHttp(sessionId);
    } catch (error) {
      this.logger.error(`Error getting session: ${error.message}`, error.stack);
      return this.getSessionByHttp(sessionId);
    }
  }

  async promptSession(sessionId: string, prompt: string, model?: { providerID: string; modelID: string }): Promise<any> {
    try {
      const client = this.requireClient();
      const result = await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text: prompt }],
          ...(model && { model }),
        },
      });

      return result.data || null;
    } catch (error) {
      this.logger.error(`Error prompting session: ${error.message}`, error.stack);
      throw new Error(`Failed to prompt session: ${error.message}`);
    }
  }

  async getSessionHistory(sessionId: string): Promise<any> {
    try {
      const client = this.requireClient();
      const messages = await client.session.messages({
        path: { id: sessionId },
      });

      return messages.data || [];
    } catch (error) {
      this.logger.error(`Error getting session history: ${error.message}`, error.stack);
      throw new Error(`Failed to get session history: ${error.message}`);
    }
  }

  async listSessions(baseUrl?: string): Promise<any[]> {
    try {
      const client = await this.getClientByEndpoint(baseUrl);
      if (!client.session?.list) {
        return this.listSessionsByHttp(baseUrl);
      }
      const sessions = await client.session.list();
      const rows = sessions.data || [];
      if (Array.isArray(rows) && rows.length > 0) {
        return rows;
      }

      const fallbackRows = await this.listSessionsByHttp(baseUrl);
      if (fallbackRows.length > 0) {
        this.logger.warn('OpenCode SDK listSessions returned empty; fallback /session used');
      }
      return fallbackRows;
    } catch (error) {
      this.logger.error(`Error listing sessions: ${error.message}`, error.stack);
      return this.listSessionsByHttp(baseUrl);
    }
  }

  async listSessionsByProject(projectPath: string, baseUrl?: string): Promise<any[]> {
    if (!projectPath) {
      return this.listSessions(baseUrl);
    }

    const byDirectory = await this.listSessionsByHttp(baseUrl, projectPath);
    if (byDirectory.length > 0) {
      return byDirectory;
    }

    const sessions = await this.listSessions(baseUrl);

    const filtered = sessions.filter((session) => this.matchesProjectPath(session, projectPath));
    return filtered;
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

  async listProjects(baseUrl?: string, options?: { throwOnError?: boolean }): Promise<any[]> {
    try {
      const client = await this.getClientByEndpoint(baseUrl);
      if (!client.project?.list) {
        return this.listProjectsByHttp(baseUrl);
      }
      const projects = await client.project.list();
      const rows = projects.data || [];
      if (Array.isArray(rows) && rows.length > 0) {
        return rows;
      }

      const fallbackRows = await this.listProjectsByHttp(baseUrl);
      if (fallbackRows.length > 0) {
        this.logger.warn(`OpenCode SDK listProjects returned empty; fallback /project used for ${baseUrl || 'default endpoint'}`);
      }
      return fallbackRows;
    } catch (error) {
      this.logger.error(`Error listing projects: ${error.message}`, error.stack);
      if (options?.throwOnError) {
        throw error;
      }
      return this.listProjectsByHttp(baseUrl);
    }
  }

  async getCurrentProject(): Promise<any | null> {
    try {
      const client = this.requireClient();
      if (!client.project?.current) {
        return null;
      }
      const project = await client.project.current();
      return project.data || null;
    } catch (error) {
      this.logger.error(`Error getting current project: ${error.message}`, error.stack);
      return null;
    }
  }

  async subscribeEvents(handlers: {
    onEvent: (event: any) => void;
    onError?: (error: any) => void;
    onComplete?: () => void;
  }): Promise<() => void> {
    const client = this.requireClient();
    if (!client.event?.subscribe) {
      throw new Error('OpenCode event stream is not available');
    }

    let active = true;
    let cleanupDone = false;

    const events = await client.event.subscribe();

    (async () => {
      try {
        for await (const event of events.stream) {
          if (!active) {
            break;
          }
          handlers.onEvent(event);
        }
      } catch (error) {
        handlers.onError?.(error);
      } finally {
        handlers.onComplete?.();
      }
    })();

    return () => {
      if (cleanupDone) {
        return;
      }
      cleanupDone = true;
      active = false;
      try {
        if (typeof events?.close === 'function') {
          events.close();
        }
      } catch (error) {
        this.logger.warn(`Failed to close OpenCode event stream: ${error?.message || error}`);
      }
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
    const client = this.getClient();
    if (!client) {
      return {
        project: null,
        path: null,
        sessions: [],
        currentSession: null,
        available: false,
        error: 'OpenCode client is not initialized',
      };
    }

    if (!client.project?.current || !client.path?.get || !client.session?.list) {
      return {
        project: null,
        path: null,
        sessions: [],
        currentSession: null,
        available: false,
        error: 'OpenCode client API is incomplete for context synchronization',
      };
    }

    const [projectResult, pathResult, sessionsResult] = await Promise.allSettled([
      client.project.current(),
      client.path.get(),
      client.session.list(),
    ]);

    const project = projectResult.status === 'fulfilled' ? (projectResult.value.data || null) : null;
    const path = pathResult.status === 'fulfilled' ? (pathResult.value.data || null) : null;
    const sessions = sessionsResult.status === 'fulfilled' ? (sessionsResult.value.data || []) : [];

    const sortedSessions = [...sessions].sort((a, b) => {
      const left = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
      const right = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
      return left - right;
    });

    return {
      project,
      path,
      sessions,
      currentSession: sortedSessions[0] || null,
      available: true,
    };
  }

  async executeCommand(sessionId: string, command: string): Promise<any> {
    try {
      const client = this.requireClient();
      const result = await client.session.command({
        path: { id: sessionId },
        body: {
          command,
        },
      });

      return {
        content: result.data?.info?.content || '',
        metadata: result.data?.info || {},
      };
    } catch (error) {
      this.logger.error(`Error executing command: ${error.message}`, error.stack);
      throw new Error(`Failed to execute command: ${error.message}`);
    }
  }

  async getProjectInfo(projectPath: string): Promise<any> {
    try {
      const client = this.requireClient();
      const project = await client.project.current();
      return project.data || {};
    } catch (error) {
      this.logger.error(`Error getting project info: ${error.message}`, error.stack);
      return {};
    }
  }

  async searchFiles(projectPath: string, pattern: string): Promise<any> {
    try {
      const client = this.requireClient();
      const results = await client.find.text({
        query: { pattern },
      });

      return results.data || [];
    } catch (error) {
      this.logger.error(`Error searching files: ${error.message}`, error.stack);
      return [];
    }
  }

  async readFile(filePath: string): Promise<string> {
    try {
      const client = this.requireClient();
      const result = await client.file.read({
        query: { path: filePath },
      });

      return result.data?.content || '';
    } catch (error) {
      this.logger.error(`Error reading file: ${error.message}`, error.stack);
      throw new Error(`Failed to read file: ${error.message}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const client = this.getClient();
      if (!client?.global?.health) {
        return false;
      }
      const health = await client.global.health();
      return health.data?.healthy === true;
    } catch (error) {
      this.logger.warn(`OpenCode health check failed: ${error.message}`);
      return false;
    }
  }
}

import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, timingSafeEqual } from 'crypto';
import axios from 'axios';
import { Dirent } from 'fs';
import { readdir, readFile } from 'fs/promises';
import * as path from 'path';
import { Model, Types } from 'mongoose';
import { EngineeringRepository, EngineeringRepositoryDocument } from '../../schemas/engineering-repository.schema';
import {
  EiOpenCodeRunSyncBatch,
  EiOpenCodeRunSyncBatchDocument,
} from '../../schemas/ei-opencode-run-sync-batch.schema';
import {
  EiOpenCodeEventFact,
  EiOpenCodeEventFactDocument,
} from '../../schemas/ei-opencode-event-fact.schema';
import {
  EiOpenCodeRunAnalytics,
  EiOpenCodeRunAnalyticsDocument,
} from '../../schemas/ei-opencode-run-analytics.schema';
import {
  EiProjectStatisticsSnapshot,
  EiProjectStatisticsSnapshotDocument,
  EiStatisticsProjectRow,
  EiStatisticsSummary,
} from '../../schemas/ei-project-statistics-snapshot.schema';
import { RdProject, RdProjectDocument } from '../../../../../src/shared/schemas/rd-project.schema';
import {
  CreateEngineeringRepositoryDto,
  CreateStatisticsSnapshotDto,
  UpdateEngineeringRepositoryDto,
} from './dto';

type GitHubContentItem = {
  type: 'file' | 'dir';
  name: string;
  path: string;
  size?: number;
  sha?: string;
  html_url?: string;
  download_url?: string;
  content?: string;
  encoding?: string;
};

type GitHubCommitItem = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: {
      name?: string;
      date?: string;
    };
  };
  author?: {
    login?: string;
    avatar_url?: string;
  };
};

type DocTreeNode = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: DocTreeNode[];
};

type OpenCodeRunSyncRun = {
  runId: string;
  agentId: string;
  roleCode?: string;
  status?: string;
  startedAt?: Date;
  completedAt?: Date;
};

type OpenCodeRunSyncEvent = {
  eventId: string;
  sequence: number;
  eventType: string;
  timestamp: Date;
  payloadDigest?: string;
};

type OpenCodeRunSyncPayload = {
  syncBatchId: string;
  envId: string;
  nodeId: string;
  run: OpenCodeRunSyncRun;
  events: OpenCodeRunSyncEvent[];
};

type FileMetrics = {
  fileCount: number;
  bytes: number;
  lines: number;
  tsCount: number;
  tsxCount: number;
  testFileCount: number;
  tokens: number;
};

@Injectable()
export class EngineeringIntelligenceService {
  private readonly workspaceRoot = process.env.EI_WORKSPACE_ROOT || path.resolve(process.cwd(), '..', '..', '..', '..');
  private readonly githubApiBase = 'https://api.github.com';
  private readonly maxFilesPerSummary = 20;
  private readonly maxCharsPerFile = 12000;
  private readonly nodeIdentityPattern = /^[a-zA-Z0-9._-]{2,64}$/;
  private readonly legacyBaseUrl = process.env.LEGACY_SERVICE_URL || 'http://localhost:3001';

  constructor(
    @InjectModel(EngineeringRepository.name) private repositoryModel: Model<EngineeringRepositoryDocument>,
    @InjectModel(EiOpenCodeRunSyncBatch.name)
    private syncBatchModel: Model<EiOpenCodeRunSyncBatchDocument>,
    @InjectModel(EiOpenCodeEventFact.name)
    private eventFactModel: Model<EiOpenCodeEventFactDocument>,
    @InjectModel(EiOpenCodeRunAnalytics.name)
    private runAnalyticsModel: Model<EiOpenCodeRunAnalyticsDocument>,
    @InjectModel(EiProjectStatisticsSnapshot.name)
    private readonly statisticsSnapshotModel: Model<EiProjectStatisticsSnapshotDocument>,
    @InjectModel(RdProject.name)
    private readonly rdProjectModel: Model<RdProjectDocument>,
  ) {}

  private ensureContinuousSequence(events: OpenCodeRunSyncEvent[]): void {
    if (events.length <= 1) {
      return;
    }

    const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].sequence !== sorted[i - 1].sequence + 1) {
        throw new BadRequestException(
          `events sequence gap detected between ${sorted[i - 1].sequence} and ${sorted[i].sequence}`,
        );
      }
    }
  }

  private async upsertEventFacts(payload: OpenCodeRunSyncPayload): Promise<void> {
    if (payload.events.length === 0) {
      return;
    }

    const operations = payload.events.map((event) => ({
      updateOne: {
        filter: {
          runId: payload.run.runId,
          eventId: event.eventId,
        },
        update: {
          $setOnInsert: {
            runId: payload.run.runId,
            eventId: event.eventId,
            sequence: event.sequence,
            eventType: event.eventType,
            eventTimestamp: event.timestamp,
            envId: payload.envId,
            nodeId: payload.nodeId,
            agentId: payload.run.agentId,
            roleCode: payload.run.roleCode,
            payloadDigest: event.payloadDigest,
            syncBatchId: payload.syncBatchId,
            rawEvent: {
              eventId: event.eventId,
              sequence: event.sequence,
              eventType: event.eventType,
              timestamp: event.timestamp.toISOString(),
              payloadDigest: event.payloadDigest,
            },
          },
        },
        upsert: true,
      },
    }));

    await this.eventFactModel.bulkWrite(operations, { ordered: false });
  }

  private async upsertRunAnalytics(payload: OpenCodeRunSyncPayload): Promise<void> {
    const events = payload.events;
    const sequences = events.map((item) => item.sequence);
    const firstSequence = sequences.length ? Math.min(...sequences) : 0;
    const lastSequence = sequences.length ? Math.max(...sequences) : 0;
    const eventTypeBreakdown = events.reduce<Record<string, number>>((acc, event) => {
      acc[event.eventType] = (acc[event.eventType] || 0) + 1;
      return acc;
    }, {});

    const startedAt = payload.run.startedAt;
    const completedAt = payload.run.completedAt;
    const durationMs =
      startedAt && completedAt
        ? Math.max(0, completedAt.getTime() - startedAt.getTime())
        : 0;

    await this.runAnalyticsModel.updateOne(
      { runId: payload.run.runId },
      {
        $set: {
          runId: payload.run.runId,
          agentId: payload.run.agentId,
          roleCode: payload.run.roleCode,
          runStatus: payload.run.status,
          envId: payload.envId,
          nodeId: payload.nodeId,
          startedAt,
          completedAt,
          durationMs,
          eventCount: events.length,
          firstSequence,
          lastSequence,
          uniqueEventTypeCount: Object.keys(eventTypeBreakdown).length,
          eventTypeBreakdown,
          lastSyncBatchId: payload.syncBatchId,
          lastSyncedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  private ensureObject(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`${field} must be an object`);
    }
    return value as Record<string, unknown>;
  }

  private ensureString(value: unknown, field: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
      throw new BadRequestException(`${field} is required`);
    }
    return normalized;
  }

  private parseDate(value: unknown, field: string): Date {
    if (value === undefined || value === null || value === '') {
      throw new BadRequestException(`${field} is required`);
    }
    const parsed = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid datetime`);
    }
    return parsed;
  }

  private parseOptionalDate(value: unknown, field: string): Date | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return this.parseDate(value, field);
  }

  private ensureNodeIdentity(value: unknown, field: string): string {
    const normalized = this.ensureString(value, field);
    if (!this.nodeIdentityPattern.test(normalized)) {
      throw new BadRequestException(`${field} format is invalid`);
    }
    return normalized;
  }

  private verifyNodeSignatureSkeleton(input: {
    payload: unknown;
    signature?: string;
    timestamp?: string;
  }): { verified: boolean; mode: 'disabled' | 'verified' | 'bypass' } {
    const enforce = String(process.env.EI_INGEST_ENFORCE_SIGNATURE || 'false').toLowerCase() === 'true';
    const secret = String(process.env.EI_INGEST_NODE_SECRET || '').trim();
    if (!secret) {
      if (enforce) {
        throw new UnauthorizedException('EI_INGEST_NODE_SECRET is required when signature enforcement is enabled');
      }
      return { verified: false, mode: 'disabled' };
    }

    const signature = String(input.signature || '').trim();
    const timestampRaw = String(input.timestamp || '').trim();
    if (!signature || !timestampRaw) {
      if (enforce) {
        throw new UnauthorizedException('x-ei-node-signature and x-ei-node-timestamp are required');
      }
      return { verified: false, mode: 'bypass' };
    }

    const timestamp = Number(timestampRaw);
    if (!Number.isFinite(timestamp)) {
      throw new UnauthorizedException('x-ei-node-timestamp is invalid');
    }

    const skewMs = Math.abs(Date.now() - timestamp);
    const allowedSkewMs = 5 * 60 * 1000;
    if (skewMs > allowedSkewMs) {
      throw new UnauthorizedException('x-ei-node-timestamp is expired');
    }

    const canonical = `${timestampRaw}.${JSON.stringify(input.payload ?? null)}`;
    const expected = createHmac('sha256', secret).update(canonical).digest('hex');
    const left = Buffer.from(signature, 'utf8');
    const right = Buffer.from(expected, 'utf8');
    const verified = left.length === right.length && timingSafeEqual(left, right);
    if (!verified) {
      throw new UnauthorizedException('x-ei-node-signature verification failed');
    }
    return { verified: true, mode: 'verified' };
  }

  private normalizeOpenCodeRunSyncPayload(input: unknown): OpenCodeRunSyncPayload {
    const payload = this.ensureObject(input, 'payload');
    const runRaw = this.ensureObject(payload.run, 'run');
    const eventsRaw = payload.events;
    if (!Array.isArray(eventsRaw)) {
      throw new BadRequestException('events must be an array');
    }

    const events = eventsRaw.map((eventRaw, index) => {
      const event = this.ensureObject(eventRaw, `events[${index}]`);
      const sequence = Number(event.sequence);
      if (!Number.isInteger(sequence) || sequence < 0) {
        throw new BadRequestException(`events[${index}].sequence must be a non-negative integer`);
      }
      const payloadDigest = event.payloadDigest === undefined ? undefined : String(event.payloadDigest || '').trim();
      return {
        eventId: this.ensureString(event.eventId, `events[${index}].eventId`),
        sequence,
        eventType: this.ensureString(event.eventType, `events[${index}].eventType`),
        timestamp: this.parseDate(event.timestamp, `events[${index}].timestamp`),
        payloadDigest: payloadDigest || undefined,
      };
    });

    return {
      syncBatchId: this.ensureString(payload.syncBatchId, 'syncBatchId'),
      envId: this.ensureNodeIdentity(payload.envId, 'envId'),
      nodeId: this.ensureNodeIdentity(payload.nodeId, 'nodeId'),
      run: {
        runId: this.ensureString(runRaw.runId, 'run.runId'),
        agentId: this.ensureString(runRaw.agentId, 'run.agentId'),
        roleCode: runRaw.roleCode ? String(runRaw.roleCode).trim() : undefined,
        status: runRaw.status ? String(runRaw.status).trim() : undefined,
        startedAt: this.parseOptionalDate(runRaw.startedAt, 'run.startedAt'),
        completedAt: this.parseOptionalDate(runRaw.completedAt, 'run.completedAt'),
      },
      events,
    };
  }

  async syncOpenCodeRun(payload: unknown) {
    const normalized = this.normalizeOpenCodeRunSyncPayload(payload);
    this.ensureContinuousSequence(normalized.events);

    const existing = await this.syncBatchModel
      .findOne({ runId: normalized.run.runId, syncBatchId: normalized.syncBatchId })
      .exec();

    if (existing) {
      return {
        success: true,
        duplicate: true,
        syncBatchId: normalized.syncBatchId,
        runId: normalized.run.runId,
        eventCount: normalized.events.length,
        acceptedAt: existing.updatedAt || existing.createdAt,
      };
    }

    const sequenceValues = normalized.events.map((item) => item.sequence);
    const eventTimestamps = normalized.events.map((item) => item.timestamp.getTime());

    await this.upsertEventFacts(normalized);
    await this.upsertRunAnalytics(normalized);

    try {
      await this.syncBatchModel.create({
        syncBatchId: normalized.syncBatchId,
        runId: normalized.run.runId,
        envId: normalized.envId,
        nodeId: normalized.nodeId,
        agentId: normalized.run.agentId,
        roleCode: normalized.run.roleCode,
        runStatus: normalized.run.status,
        runStartedAt: normalized.run.startedAt,
        runCompletedAt: normalized.run.completedAt,
        eventCount: normalized.events.length,
        minSequence: sequenceValues.length ? Math.min(...sequenceValues) : undefined,
        maxSequence: sequenceValues.length ? Math.max(...sequenceValues) : undefined,
        firstEventAt: eventTimestamps.length ? new Date(Math.min(...eventTimestamps)) : undefined,
        lastEventAt: eventTimestamps.length ? new Date(Math.max(...eventTimestamps)) : undefined,
        status: 'received',
        payload: {
          ...normalized,
          run: {
            ...normalized.run,
            startedAt: normalized.run.startedAt?.toISOString(),
            completedAt: normalized.run.completedAt?.toISOString(),
          },
          events: normalized.events.map((event) => ({
            ...event,
            timestamp: event.timestamp.toISOString(),
          })),
        },
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        return {
          success: true,
          duplicate: true,
          syncBatchId: normalized.syncBatchId,
          runId: normalized.run.runId,
          eventCount: normalized.events.length,
          status: 'duplicate',
        };
      }
      throw error;
    }

    return {
      success: true,
      duplicate: false,
      syncBatchId: normalized.syncBatchId,
      runId: normalized.run.runId,
      eventCount: normalized.events.length,
      status: 'received',
    };
  }

  async ingestOpenCodeEvents(input: {
    payload: unknown;
    signature?: string;
    timestamp?: string;
  }) {
    const signatureResult = this.verifyNodeSignatureSkeleton(input);
    const payloadObject = this.ensureObject(input.payload, 'payload');
    const batchesRaw = payloadObject.batches;

    if (Array.isArray(batchesRaw)) {
      const results = [] as Array<{ runId: string; duplicate: boolean; eventCount: number }>;
      for (let i = 0; i < batchesRaw.length; i += 1) {
        const result = await this.syncOpenCodeRun(batchesRaw[i]);
        results.push({
          runId: String((result as any).runId || ''),
          duplicate: Boolean((result as any).duplicate),
          eventCount: Number((result as any).eventCount || 0),
        });
      }

      return {
        success: true,
        mode: 'batch',
        batchCount: results.length,
        acceptedCount: results.filter((item) => !item.duplicate).length,
        duplicateCount: results.filter((item) => item.duplicate).length,
        signature: signatureResult,
        results,
      };
    }

    const single = await this.syncOpenCodeRun(payloadObject);
    return {
      success: true,
      mode: 'single',
      signature: signatureResult,
      result: single,
    };
  }

  private parseGithubUrl(repositoryUrl: string): { owner: string; repo: string } {
    const normalized = repositoryUrl.trim().replace(/\.git$/i, '');
    const match = normalized.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/i);
    if (!match) {
      throw new BadRequestException('Invalid GitHub repository URL');
    }

    return { owner: match[1], repo: match[2] };
  }

  private getGitHubToken(): string {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new BadRequestException('GITHUB_TOKEN is not configured');
    }
    return token;
  }

  private async githubRequest<T>(path: string): Promise<T> {
    const response = await fetch(`${this.githubApiBase}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.getGitHubToken()}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new BadRequestException(`GitHub API error (${response.status}): ${bodyText}`);
    }

    return (await response.json()) as T;
  }

  private isGitHub404(error: unknown): boolean {
    const message = (error as any)?.message || '';
    return String(message).includes('GitHub API error (404)') || String(message).includes('content: 404');
  }

  private async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const repoInfo = await this.githubRequest<{ default_branch: string }>(`/repos/${owner}/${repo}`);
    return repoInfo.default_branch || 'main';
  }

  private async runWithBranchFallback<T>(
    owner: string,
    repo: string,
    preferredBranch: string,
    runner: (branch: string) => Promise<T>,
  ): Promise<{ data: T; branch: string }> {
    try {
      const data = await runner(preferredBranch);
      return { data, branch: preferredBranch };
    } catch (error) {
      if (!this.isGitHub404(error)) {
        throw error;
      }

      const fallbackBranch = await this.getDefaultBranch(owner, repo);
      if (!fallbackBranch || fallbackBranch === preferredBranch) {
        throw error;
      }

      const data = await runner(fallbackBranch);
      return { data, branch: fallbackBranch };
    }
  }

  private async githubTextRequest(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.getGitHubToken()}`,
      },
    });

    if (!response.ok) {
      throw new BadRequestException(`Failed to fetch document content: ${response.status}`);
    }

    return response.text();
  }

  private isDocFilePath(path: string): boolean {
    const lower = path.toLowerCase();
    if (lower.startsWith('docs/')) return true;
    if (/^readme(\.|$)/i.test(lower)) return true;
    if (/contributing/i.test(lower)) return true;
    if (/architecture/i.test(lower)) return true;
    if (/adr/i.test(lower)) return true;
    return false;
  }

  private async listDirectoryRecursive(owner: string, repo: string, path: string, ref: string): Promise<GitHubContentItem[]> {
    const encodedPath = path ? `/${path}` : '';
    const items = await this.githubRequest<GitHubContentItem[]>(
      `/repos/${owner}/${repo}/contents${encodedPath}?ref=${encodeURIComponent(ref)}`,
    );

    const files: GitHubContentItem[] = [];
    for (const item of items) {
      if (item.type === 'file') {
        files.push(item);
      } else if (item.type === 'dir') {
        const nested = await this.listDirectoryRecursive(owner, repo, item.path, ref);
        files.push(...nested);
      }
    }

    return files;
  }

  private buildDocPathSuggestions(markdownPaths: string[], requestedPath: string): string[] {
    const normalizedRequested = requestedPath.toLowerCase();
    const requestedName = requestedPath.split('/').pop()?.toLowerCase() || '';

    const exactCaseInsensitive = markdownPaths.filter((item) => item.toLowerCase() === normalizedRequested);
    if (exactCaseInsensitive.length > 0) {
      return exactCaseInsensitive.slice(0, 5);
    }

    const byFileName = requestedName
      ? markdownPaths.filter((item) => item.split('/').pop()?.toLowerCase() === requestedName)
      : [];
    if (byFileName.length > 0) {
      return byFileName.slice(0, 5);
    }

    const partial = markdownPaths.filter((item) => item.toLowerCase().includes(requestedName || normalizedRequested));
    return partial.slice(0, 5);
  }

  private normalizeDocPath(docPath: string): string {
    const raw = (docPath || '').trim();
    if (!raw) return raw;

    const parts = raw.split(',').map((item) => item.trim()).filter(Boolean);
    return parts[0] || raw;
  }

  private async getDocPathSuggestions(owner: string, repo: string, preferredBranch: string, requestedPath: string) {
    const { data: docsFiles } = await this.runWithBranchFallback(owner, repo, preferredBranch, (branch) =>
      this.listDirectoryRecursive(owner, repo, 'docs', branch),
    );

    const markdownPaths = docsFiles
      .filter((item) => item.type === 'file' && /\.(md|mdx)$/i.test(item.name))
      .map((item) => item.path);

    return this.buildDocPathSuggestions(markdownPaths, requestedPath);
  }

  private async collectDocFiles(owner: string, repo: string, branch: string): Promise<GitHubContentItem[]> {
    const rootItems = await this.githubRequest<GitHubContentItem[]>(
      `/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(branch)}`,
    );

    const rootDocFiles = rootItems.filter((item) => item.type === 'file' && this.isDocFilePath(item.path));

    const docDirs = rootItems.filter(
      (item) => item.type === 'dir' && ['docs', 'doc', 'adr'].includes(item.name.toLowerCase()),
    );

    const nestedFiles: GitHubContentItem[] = [];
    for (const dir of docDirs) {
      const files = await this.listDirectoryRecursive(owner, repo, dir.path, branch);
      nestedFiles.push(...files);
    }

    const merged = [...rootDocFiles, ...nestedFiles].filter((item) => this.isDocFilePath(item.path));
    const uniqueByPath = new Map<string, GitHubContentItem>();
    merged.forEach((item) => uniqueByPath.set(item.path, item));
    return Array.from(uniqueByPath.values()).slice(0, this.maxFilesPerSummary);
  }

  private async getContentItem(owner: string, repo: string, path: string, branch: string): Promise<GitHubContentItem> {
    const encodedPath = path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return this.githubRequest<GitHubContentItem>(
      `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
    );
  }

  private buildDocTree(paths: string[]): DocTreeNode[] {
    const roots: DocTreeNode[] = [];

    for (const fullPath of paths) {
      const segments = fullPath.split('/').filter(Boolean);
      let level = roots;
      let currentPath = '';

      for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i];
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        const isFile = i === segments.length - 1;

        let node = level.find((item) => item.name === segment);
        if (!node) {
          node = {
            name: segment,
            path: currentPath,
            type: isFile ? 'file' : 'dir',
            ...(isFile ? {} : { children: [] }),
          };
          level.push(node);
        }

        if (!isFile) {
          if (!node.children) {
            node.children = [];
          }
          level = node.children;
        }
      }
    }

    const sortNodes = (nodes: DocTreeNode[]): DocTreeNode[] => {
      const sorted = [...nodes].sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'dir' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      return sorted.map((node) => ({
        ...node,
        ...(node.children ? { children: sortNodes(node.children) } : {}),
      }));
    };

    return sortNodes(roots);
  }

  private summarizeSingleDoc(path: string, content: string): {
    path: string;
    title: string;
    summary: string;
    evidence: string[];
  } {
    const normalized = content.replace(/\r\n/g, '\n').slice(0, this.maxCharsPerFile);
    const lines = normalized.split('\n').map((line) => line.trim());
    const heading = lines.find((line) => /^#{1,6}\s+/.test(line));
    const title = heading ? heading.replace(/^#{1,6}\s+/, '') : path;

    const paragraph = lines
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('```'))
      .slice(0, 6)
      .join(' ')
      .slice(0, 260);

    const evidence = lines
      .filter((line) => /^#{1,6}\s+/.test(line) || /^[-*]\s+/.test(line))
      .slice(0, 5)
      .map((line) => line.replace(/^#{1,6}\s+/, '').trim());

    return {
      path,
      title,
      summary: paragraph || '文档包含结构化说明，但未提取到清晰段落。',
      evidence,
    };
  }

  private extractStackSignals(text: string): string[] {
    const signalMap: Array<{ regex: RegExp; label: string }> = [
      { regex: /nestjs|express|fastify/i, label: '后端框架' },
      { regex: /react|vue|angular|next\.js/i, label: '前端框架' },
      { regex: /mongodb|mysql|postgres|redis/i, label: '数据与缓存' },
      { regex: /docker|kubernetes|helm|terraform/i, label: '部署与基础设施' },
      { regex: /jest|vitest|cypress|playwright/i, label: '测试体系' },
      { regex: /oauth|jwt|rbac|auth/i, label: '认证与权限' },
      { regex: /observability|monitoring|prometheus|grafana|logging/i, label: '可观测性' },
    ];

    return signalMap.filter((item) => item.regex.test(text)).map((item) => item.label);
  }

  private buildRepoSummary(docSummaries: Array<{ path: string; summary: string; evidence: string[] }>) {
    const mergedText = docSummaries.map((doc) => `${doc.path}\n${doc.summary}\n${doc.evidence.join('\n')}`).join('\n\n');
    const stackSignals = this.extractStackSignals(mergedText);

    return {
      overview:
        docSummaries.length > 0
          ? `已分析 ${docSummaries.length} 份文档，可用于研发技术状态初步感知。`
          : '未发现可读取文档，暂无法形成研发技术状态摘要。',
      keyPoints: docSummaries.slice(0, 5).map((doc) => `${doc.path}: ${doc.summary}`),
      stackSignals,
      confidence: docSummaries.length >= 5 ? 'medium' : 'low',
      risks:
        docSummaries.length === 0
          ? ['文档覆盖不足，评估可信度较低']
          : stackSignals.length === 0
            ? ['文档中技术栈信号较少，建议补充架构与部署说明']
            : [],
      };
  }

  private resolveWorkspacePath(relativePath: string): string {
    const normalized = String(relativePath || '').trim().replace(/\\/g, '/');
    const absPath = path.resolve(this.workspaceRoot, normalized);
    const normalizedRoot = path.resolve(this.workspaceRoot);
    if (!absPath.startsWith(normalizedRoot)) {
      throw new BadRequestException(`invalid project path: ${relativePath}`);
    }
    return absPath;
  }

  private shouldSkipDir(name: string): boolean {
    return ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.turbo', '.cache'].includes(name);
  }

  private shouldIncludeFile(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    return !['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.mp4', '.mov'].some((ext) =>
      lower.endsWith(ext),
    );
  }

  private countLinesFromText(text: string): number {
    if (!text) return 0;
    return text.split('\n').length;
  }

  private estimateTokensByChars(text: string): number {
    return Math.round((text || '').length / 4);
  }

  private async scanDirectoryMetrics(absRootPath: string): Promise<FileMetrics> {
    const metrics: FileMetrics = {
      fileCount: 0,
      bytes: 0,
      lines: 0,
      tsCount: 0,
      tsxCount: 0,
      testFileCount: 0,
      tokens: 0,
    };

    const walk = async (current: string): Promise<void> => {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries as Dirent[]) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (this.shouldSkipDir(entry.name)) {
            continue;
          }
          await walk(fullPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        if (!this.shouldIncludeFile(entry.name)) {
          continue;
        }

        const content = await readFile(fullPath, 'utf-8').catch(() => '');
        const bytes = Buffer.byteLength(content, 'utf-8');
        const lower = entry.name.toLowerCase();

        metrics.fileCount += 1;
        metrics.bytes += bytes;
        metrics.lines += this.countLinesFromText(content);
        metrics.tokens += this.estimateTokensByChars(content);

        if (lower.endsWith('.ts')) {
          metrics.tsCount += 1;
        }
        if (lower.endsWith('.tsx')) {
          metrics.tsxCount += 1;
        }
        if (lower.endsWith('.spec.ts') || lower.endsWith('.test.ts') || lower.endsWith('.spec.tsx') || lower.endsWith('.test.tsx')) {
          metrics.testFileCount += 1;
        }
      }
    };

    await walk(absRootPath);
    return metrics;
  }

  private buildSummary(rows: EiStatisticsProjectRow[]): EiStatisticsSummary {
    const totalDocsBytes = rows.filter((item) => item.metricType === 'docs').reduce((sum, item) => sum + item.bytes, 0);
    const totalDocsTokens = rows.filter((item) => item.metricType === 'docs').reduce((sum, item) => sum + (item.tokens || 0), 0);
    const totalFrontendBytes = rows
      .filter((item) => item.metricType === 'frontend')
      .reduce((sum, item) => sum + item.bytes, 0);
    const totalBackendBytes = rows.filter((item) => item.metricType === 'backend').reduce((sum, item) => sum + item.bytes, 0);
    const failureCount = rows.filter((item) => Boolean(item.error)).length;
    const successCount = rows.length - failureCount;

    return {
      totalDocsBytes,
      totalDocsTokens,
      totalFrontendBytes,
      totalBackendBytes,
      grandTotalBytes: totalDocsBytes + totalFrontendBytes + totalBackendBytes,
      projectCount: rows.length,
      successCount,
      failureCount,
    };
  }

  private async buildStatisticsRows(input: {
    scope: 'all' | 'docs' | 'frontend' | 'backend';
    requestedProjectIds: string[];
  }): Promise<EiStatisticsProjectRow[]> {
    const rows: EiStatisticsProjectRow[] = [];
    const baseProjects: Array<{
      projectId: string;
      projectName: string;
      source: 'workspace' | 'ei_project';
      metricType: 'docs' | 'frontend' | 'backend';
      rootPath: string;
    }> = [];

    if (input.scope === 'all' || input.scope === 'docs') {
      baseProjects.push({
        projectId: 'workspace-docs',
        projectName: 'Workspace Docs',
        source: 'workspace',
        metricType: 'docs',
        rootPath: 'docs',
      });
    }

    if (input.scope === 'all' || input.scope === 'frontend') {
      baseProjects.push({
        projectId: 'workspace-frontend',
        projectName: 'Workspace Frontend',
        source: 'workspace',
        metricType: 'frontend',
        rootPath: 'frontend/src',
      });
    }

    if (input.scope === 'all' || input.scope === 'backend') {
      baseProjects.push({
        projectId: 'workspace-backend',
        projectName: 'Workspace Backend',
        source: 'workspace',
        metricType: 'backend',
        rootPath: 'backend/src',
      });
    }

    const projectFilter = input.requestedProjectIds.length
      ? {
          $or: [
            { _id: { $in: input.requestedProjectIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)) } },
            { id: { $in: input.requestedProjectIds } },
          ],
        }
      : {};

    const eiProjects = await this.rdProjectModel
      .find({
        ...projectFilter,
        opencodeProjectPath: { $exists: true, $ne: '' },
      })
      .lean()
      .exec();

    for (const project of eiProjects as Array<Record<string, any>>) {
      const projectId = String(project.id || project._id || '');
      const projectName = String(project.name || project.opencodeProjectPath || projectId);
      const projectPath = String(project.opencodeProjectPath || '').trim();
      const metricType = projectPath.includes('frontend') ? 'frontend' : projectPath.includes('backend') ? 'backend' : 'docs';
      if (input.scope !== 'all' && input.scope !== metricType) {
        continue;
      }
      baseProjects.push({
        projectId,
        projectName,
        source: 'ei_project',
        metricType,
        rootPath: projectPath,
      });
    }

    for (const item of baseProjects) {
      try {
        const abs = this.resolveWorkspacePath(item.rootPath);
        const metrics = await this.scanDirectoryMetrics(abs);
        rows.push({
          projectId: item.projectId,
          projectName: item.projectName,
          source: item.source,
          metricType: item.metricType,
          rootPath: item.rootPath,
          fileCount: metrics.fileCount,
          bytes: metrics.bytes,
          lines: metrics.lines,
          tokens: item.metricType === 'docs' ? metrics.tokens : undefined,
          tsCount: metrics.tsCount,
          tsxCount: metrics.tsxCount,
          testFileCount: metrics.testFileCount,
        });
      } catch (error) {
        rows.push({
          projectId: item.projectId,
          projectName: item.projectName,
          source: item.source,
          metricType: item.metricType,
          rootPath: item.rootPath,
          fileCount: 0,
          bytes: 0,
          lines: 0,
          tokens: 0,
          tsCount: 0,
          tsxCount: 0,
          testFileCount: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return rows;
  }

  private async emitStatisticsMessage(input: {
    receiverId?: string;
    snapshotId: string;
    status: 'success' | 'failed';
    summary?: EiStatisticsSummary;
    error?: string;
  }): Promise<void> {
    const receiverId = String(input.receiverId || '').trim();
    if (!receiverId) {
      return;
    }

    await axios.post(
      `${this.legacyBaseUrl}/api/message-center/hooks/engineering-statistics`,
      {
        receiverId,
        snapshotId: input.snapshotId,
        status: input.status,
        summary: input.summary,
        error: input.error,
      },
      {
        timeout: 10000,
      },
    );
  }

  async createStatisticsSnapshot(payload: CreateStatisticsSnapshotDto) {
    const now = new Date();
    const scope = payload.scope || 'all';
    const tokenMode = payload.tokenMode || 'estimate';
    const requestedProjectIds = (payload.projectIds || []).map((item) => String(item || '').trim()).filter(Boolean);
    const snapshotId = `ei-stats-${now.getTime()}`;

    await this.statisticsSnapshotModel.create({
      snapshotId,
      status: 'running',
      scope,
      tokenMode,
      requestedProjectIds,
      triggeredBy: payload.triggeredBy || 'manual',
      startedAt: now,
      projects: [],
      summary: {
        totalDocsBytes: 0,
        totalDocsTokens: 0,
        totalFrontendBytes: 0,
        totalBackendBytes: 0,
        grandTotalBytes: 0,
        projectCount: 0,
        successCount: 0,
        failureCount: 0,
      },
      errors: [],
    });

    try {
      const rows = await this.buildStatisticsRows({
        scope,
        requestedProjectIds,
      });
      const summary = this.buildSummary(rows);
      const errors = rows.filter((item) => item.error).map((item) => `${item.projectName}: ${item.error}`);
      const status: 'success' | 'failed' = errors.length === rows.length && rows.length > 0 ? 'failed' : 'success';

      await this.statisticsSnapshotModel.updateOne(
        { snapshotId },
        {
          $set: {
            status,
            completedAt: new Date(),
            projects: rows,
            summary,
            errors,
          },
        },
      );

      await this.emitStatisticsMessage({
        receiverId: payload.receiverId,
        snapshotId,
        status,
        summary,
        error: errors.join('; ') || undefined,
      });
    } catch (error) {
      await this.statisticsSnapshotModel.updateOne(
        { snapshotId },
        {
          $set: {
            status: 'failed',
            completedAt: new Date(),
            errors: [error instanceof Error ? error.message : String(error)],
          },
        },
      );

      await this.emitStatisticsMessage({
        receiverId: payload.receiverId,
        snapshotId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return this.getStatisticsSnapshotById(snapshotId);
  }

  async getLatestStatisticsSnapshot() {
    return this.statisticsSnapshotModel.findOne({}).sort({ createdAt: -1 }).lean().exec();
  }

  async getStatisticsSnapshotById(snapshotId: string) {
    const snapshot = await this.statisticsSnapshotModel.findOne({ snapshotId }).lean().exec();
    if (!snapshot) {
      throw new NotFoundException('Statistics snapshot not found');
    }
    return snapshot;
  }

  async listStatisticsSnapshots(limit = 20) {
    const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.statisticsSnapshotModel.find({}).sort({ createdAt: -1 }).limit(normalizedLimit).lean().exec();
  }

  async createRepository(payload: CreateEngineeringRepositoryDto) {
    const { owner, repo } = this.parseGithubUrl(payload.repositoryUrl);

    const repoInfo = await this.githubRequest<{ default_branch: string }>(`/repos/${owner}/${repo}`);
    const branch = payload.branch?.trim() || repoInfo.default_branch || 'main';

    const created = await this.repositoryModel.findOneAndUpdate(
      { repositoryUrl: payload.repositoryUrl.trim() },
      {
        $set: {
          repositoryUrl: payload.repositoryUrl.trim(),
          owner,
          repo,
          branch,
        },
      },
      { new: true, upsert: true },
    );

    return created;
  }

  async listRepositories() {
    return this.repositoryModel
      .find({})
      .sort({ updatedAt: -1 })
      .exec();
  }

  async updateRepository(id: string, payload: UpdateEngineeringRepositoryDto) {
    const updated = await this.repositoryModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id) },
        { $set: payload },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('Repository config not found');
    }

    return updated;
  }

  async deleteRepository(id: string) {
    const result = await this.repositoryModel
      .deleteOne({ _id: new Types.ObjectId(id) })
      .exec();
    return { success: result.deletedCount > 0 };
  }

  async summarizeRepository(id: string) {
    const repoConfig = await this.repositoryModel
      .findOne({ _id: new Types.ObjectId(id) })
      .exec();

    if (!repoConfig) {
      throw new NotFoundException('Repository config not found');
    }

    try {
      const { data: files, branch: branchUsed } = await this.runWithBranchFallback(
        repoConfig.owner,
        repoConfig.repo,
        repoConfig.branch || 'main',
        (branch) => this.collectDocFiles(repoConfig.owner, repoConfig.repo, branch),
      );
      const docSummaries: Array<{ path: string; title: string; summary: string; evidence: string[] }> = [];

      for (const file of files) {
        if (!file.download_url) continue;
        const content = await this.githubTextRequest(file.download_url);
        docSummaries.push(this.summarizeSingleDoc(file.path, content));
      }

      const repoSummary = this.buildRepoSummary(docSummaries);
      const result = {
        repository: {
          id: repoConfig._id,
          repositoryUrl: repoConfig.repositoryUrl,
          branch: branchUsed,
        },
        generatedAt: new Date().toISOString(),
        filesScanned: docSummaries.length,
        assessment: {
          technicalState: docSummaries.length > 0 ? 'observable' : 'unknown',
          confidence: repoSummary.confidence,
          risks: repoSummary.risks,
        },
        repoSummary,
        documents: docSummaries,
      };

      await this.repositoryModel.updateOne(
        { _id: repoConfig._id },
        {
          $set: {
            lastSummary: result,
            lastSummarizedAt: new Date(),
            lastError: null,
            branch: branchUsed,
          },
        },
      );

      return result;
    } catch (error) {
      await this.repositoryModel.updateOne(
        { _id: repoConfig._id },
        {
          $set: {
            lastError: (error as Error).message || 'Summary failed',
          },
        },
      );
      throw error;
    }
  }

  async getRepositoryDocsTree(id: string) {
    const repoConfig = await this.repositoryModel
      .findOne({ _id: new Types.ObjectId(id) })
      .exec();

    if (!repoConfig) {
      throw new NotFoundException('Repository config not found');
    }

    const { data: docsFiles, branch: branchUsed } = await this.runWithBranchFallback(
      repoConfig.owner,
      repoConfig.repo,
      repoConfig.branch || 'main',
      (branch) => this.listDirectoryRecursive(repoConfig.owner, repoConfig.repo, 'docs', branch),
    ).catch(() => ({ data: [] as GitHubContentItem[], branch: repoConfig.branch || 'main' }));

    const markdownFiles = docsFiles
      .filter((item) => item.type === 'file' && /\.(md|mdx)$/i.test(item.name))
      .map((item) => item.path);

    return {
      repository: {
        id: repoConfig._id,
        repositoryUrl: repoConfig.repositoryUrl,
        branch: branchUsed,
      },
      root: 'docs',
      totalFiles: markdownFiles.length,
      tree: this.buildDocTree(markdownFiles),
    };
  }

  async getRepositoryDocContent(id: string, docPath: string) {
    const normalizedDocPath = this.normalizeDocPath(docPath);
    if (!normalizedDocPath || !normalizedDocPath.startsWith('docs/')) {
      throw new BadRequestException('docPath must start with docs/');
    }

    const repoConfig = await this.repositoryModel
      .findOne({ _id: new Types.ObjectId(id) })
      .exec();

    if (!repoConfig) {
      throw new NotFoundException('Repository config not found');
    }

    let file: GitHubContentItem;
    let branchUsed = repoConfig.branch || 'main';

    try {
      const contentResult = await this.runWithBranchFallback(
        repoConfig.owner,
        repoConfig.repo,
        repoConfig.branch || 'main',
        (branch) => this.getContentItem(repoConfig.owner, repoConfig.repo, normalizedDocPath, branch),
      );
      file = contentResult.data;
      branchUsed = contentResult.branch;
    } catch (error) {
      if (!this.isGitHub404(error)) {
        throw error;
      }

      const suggestions = await this.getDocPathSuggestions(
        repoConfig.owner,
        repoConfig.repo,
        repoConfig.branch || 'main',
        normalizedDocPath,
      ).catch(() => [] as string[]);

      const suggestionText = suggestions.length > 0 ? ` Suggested paths: ${suggestions.join(', ')}` : '';
      throw new BadRequestException(
        `Document not found at path '${normalizedDocPath}' (branch: ${repoConfig.branch || 'main'}).${suggestionText}`,
      );
    }

    if (file.type !== 'file') {
      throw new BadRequestException('docPath must point to a file');
    }

    let content = '';
    if (file.content && file.encoding === 'base64') {
      content = Buffer.from(file.content, 'base64').toString('utf-8');
    } else if (file.download_url) {
      content = await this.githubTextRequest(file.download_url);
    }

    return {
      repository: {
        id: repoConfig._id,
        repositoryUrl: repoConfig.repositoryUrl,
        branch: branchUsed,
      },
      document: {
        path: file.path,
        name: file.name,
        size: file.size || content.length,
        sha: file.sha,
        htmlUrl: file.html_url,
        content,
      },
    };
  }

  async getRepositoryDocHistory(id: string, docPath: string, limit = 20) {
    const normalizedDocPath = this.normalizeDocPath(docPath);
    if (!normalizedDocPath || !normalizedDocPath.startsWith('docs/')) {
      throw new BadRequestException('docPath must start with docs/');
    }

    const parsedLimit = Number.isFinite(limit) ? limit : 20;
    const normalizedLimit = Math.min(Math.max(parsedLimit, 1), 50);
    const repoConfig = await this.repositoryModel
      .findOne({ _id: new Types.ObjectId(id) })
      .exec();

    if (!repoConfig) {
      throw new NotFoundException('Repository config not found');
    }

    const { data: commits, branch: branchUsed } = await this.runWithBranchFallback(
      repoConfig.owner,
      repoConfig.repo,
      repoConfig.branch || 'main',
      (branch) =>
        this.githubRequest<GitHubCommitItem[]>(
          `/repos/${repoConfig.owner}/${repoConfig.repo}/commits?path=${encodeURIComponent(normalizedDocPath)}&sha=${encodeURIComponent(branch)}&per_page=${normalizedLimit}`,
        ),
    );

    const contributors = new Set<string>();
    commits.forEach((item) => {
      const authorName = item.author?.login || item.commit.author?.name;
      if (authorName) {
        contributors.add(authorName);
      }
    });

    return {
      repository: {
        id: repoConfig._id,
        repositoryUrl: repoConfig.repositoryUrl,
        branch: branchUsed,
      },
      path: normalizedDocPath,
      totalCommits: commits.length,
      uniqueContributors: contributors.size,
      lastUpdatedAt: commits[0]?.commit?.author?.date || null,
      commits: commits.map((item) => ({
        sha: item.sha,
        shortSha: item.sha.slice(0, 8),
        message: item.commit.message,
        author: item.author?.login || item.commit.author?.name || 'unknown',
        authorAvatar: item.author?.avatar_url,
        committedAt: item.commit.author?.date,
        htmlUrl: item.html_url,
      })),
    };
  }
}

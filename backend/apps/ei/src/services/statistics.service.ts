import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Dirent, existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import * as path from 'path';
import { Model } from 'mongoose';
import { CreateStatisticsSnapshotDto } from '../dto';
import {
  EiProjectStatisticsSnapshot,
  EiProjectStatisticsSnapshotDocument,
  EiStatisticsProjectRow,
  EiStatisticsSummary,
} from '../schemas/ei-project-statistics-snapshot.schema';
import {
  buildMessageCenterEvent,
  MESSAGE_CENTER_EVENT_SOURCE_EI,
  MESSAGE_CENTER_EVENT_STREAM_KEY,
  RedisService,
} from '@libs/infra';

type TopLineFileEntry = {
  filePath: string;
  lines: number;
  bytes: number;
};

type FileMetrics = {
  fileCount: number;
  bytes: number;
  lines: number;
  tsCount: number;
  tsxCount: number;
  testFileCount: number;
  tokens: number;
  topLineFiles: TopLineFileEntry[];
};

@Injectable()
export class EiStatisticsService {
  private readonly logger = new Logger(EiStatisticsService.name);
  private readonly workspaceRoot = this.resolveWorkspaceRoot();
  private readonly topLineFilesLimit = 10;

  constructor(
    @InjectModel(EiProjectStatisticsSnapshot.name)
    private readonly statisticsSnapshotModel: Model<EiProjectStatisticsSnapshotDocument>,
    private readonly redisService: RedisService,
  ) {}

  private resolveWorkspaceRoot(): string {
    const envRoot = process.env.EI_WORKSPACE_ROOT || process.env.WORKSPACE_ROOT;
    if (envRoot?.trim()) {
      return path.resolve(envRoot.trim());
    }

    const cwd = process.cwd();
    const candidates = [cwd, path.resolve(cwd, '..'), path.resolve(cwd, '..', '..')];

    for (const candidate of candidates) {
      if (existsSync(path.join(candidate, 'docs')) && existsSync(path.join(candidate, 'frontend')) && existsSync(path.join(candidate, 'backend'))) {
        return candidate;
      }
    }

    return cwd;
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

  private async listWorkspaceSubdirectories(relativeRootPath: string): Promise<string[]> {
    const absRootPath = this.resolveWorkspacePath(relativeRootPath);
    const entries = await readdir(absRootPath, { withFileTypes: true });
    return (entries as Dirent[])
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !this.shouldSkipDir(name) && !name.startsWith('.'))
      .sort((a, b) => a.localeCompare(b));
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
      topLineFiles: [],
    };

    const allFiles: TopLineFileEntry[] = [];

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
        const fileLines = this.countLinesFromText(content);
        const lower = entry.name.toLowerCase();

        metrics.fileCount += 1;
        metrics.bytes += bytes;
        metrics.lines += fileLines;
        metrics.tokens += this.estimateTokensByChars(content);

        const relativePath = path.relative(absRootPath, fullPath);
        allFiles.push({ filePath: relativePath, lines: fileLines, bytes });

        if (lower.endsWith('.ts')) {
          metrics.tsCount += 1;
        }
        if (lower.endsWith('.tsx')) {
          metrics.tsxCount += 1;
        }
        if (
          lower.endsWith('.spec.ts') ||
          lower.endsWith('.test.ts') ||
          lower.endsWith('.spec.tsx') ||
          lower.endsWith('.test.tsx')
        ) {
          metrics.testFileCount += 1;
        }
      }
    };

    await walk(absRootPath);

    metrics.topLineFiles = allFiles.sort((a, b) => b.lines - a.lines).slice(0, this.topLineFilesLimit);

    return metrics;
  }

  private buildSummary(rows: EiStatisticsProjectRow[]): EiStatisticsSummary {
    const docsRows = rows.filter((item) => item.metricType === 'docs');
    const frontendRows = rows.filter((item) => item.metricType === 'frontend');
    const backendRows = rows.filter((item) => item.metricType === 'backend');

    const totalDocsBytes = docsRows.reduce((sum, item) => sum + item.bytes, 0);
    const totalDocsTokens = docsRows.reduce((sum, item) => sum + (item.tokens || 0), 0);
    const totalDocsLines = docsRows.reduce((sum, item) => sum + item.lines, 0);
    const totalDocsFileCount = docsRows.reduce((sum, item) => sum + item.fileCount, 0);

    const totalFrontendBytes = frontendRows.reduce((sum, item) => sum + item.bytes, 0);
    const totalFrontendLines = frontendRows.reduce((sum, item) => sum + item.lines, 0);
    const totalFrontendFileCount = frontendRows.reduce((sum, item) => sum + item.fileCount, 0);

    const totalBackendBytes = backendRows.reduce((sum, item) => sum + item.bytes, 0);
    const totalBackendLines = backendRows.reduce((sum, item) => sum + item.lines, 0);
    const totalBackendFileCount = backendRows.reduce((sum, item) => sum + item.fileCount, 0);

    const failureCount = rows.filter((item) => Boolean(item.error)).length;
    const successCount = rows.length - failureCount;

    return {
      totalDocsBytes,
      totalDocsTokens,
      totalDocsLines,
      totalDocsFileCount,
      totalFrontendBytes,
      totalFrontendLines,
      totalFrontendFileCount,
      totalBackendBytes,
      totalBackendLines,
      totalBackendFileCount,
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

      const backendAppNames = await this.listWorkspaceSubdirectories('backend/apps').catch(() => [] as string[]);
      for (const appName of backendAppNames) {
        baseProjects.push({
          projectId: `workspace-backend-app-${appName}`,
          projectName: `Workspace Backend App (${appName})`,
          source: 'workspace',
          metricType: 'backend',
          rootPath: `backend/apps/${appName}`,
        });
      }
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
          topLineFiles: metrics.topLineFiles,
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

    const title = input.status === 'success' ? '工程工具执行完成' : '工程工具执行失败';
    const content =
      input.status === 'success'
        ? `工程工具任务 ${input.snapshotId} 已完成，可查看详情。`
        : `工程工具任务 ${input.snapshotId} 执行失败，请检查错误信息。`;

    const event = buildMessageCenterEvent({
      eventType: 'engineering.tool.completed',
      source: MESSAGE_CENTER_EVENT_SOURCE_EI,
      traceId: randomUUID(),
      data: {
        receiverId,
        messageType: 'engineering_statistics',
        title,
        content,
        actionUrl: `/ei/statistics?snapshotId=${encodeURIComponent(input.snapshotId)}`,
        bizKey: `engineering-tool:${input.snapshotId}:${input.status}`,
        priority: input.status === 'failed' ? 'high' : 'normal',
        extra: {
          snapshotId: input.snapshotId,
          status: input.status,
          summary: input.summary || {},
          error: input.error || '',
        },
      },
    });

    const streamId = await this.redisService.xadd(
      MESSAGE_CENTER_EVENT_STREAM_KEY,
      {
        event: JSON.stringify(event),
      },
      {
        maxLen: 10000,
      },
    );

    this.logger.log(
      `Published message-center event for engineering tool completion: eventId=${event.eventId} streamId=${streamId || 'n/a'} receiverId=${receiverId} snapshotId=${input.snapshotId} status=${input.status}`,
    );
  }

  private async safeEmitStatisticsMessage(input: {
    receiverId?: string;
    snapshotId: string;
    status: 'success' | 'failed';
    summary?: EiStatisticsSummary;
    error?: string;
  }): Promise<void> {
    try {
      await this.emitStatisticsMessage(input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to publish engineering tool message-center event (non-blocking): receiverId=${String(input.receiverId || '').trim()} snapshotId=${input.snapshotId} status=${input.status} reason=${reason}`,
      );
    }
  }

  createSnapshot(payload: CreateStatisticsSnapshotDto) {
    const now = new Date();
    const scope = payload.scope || 'all';
    const tokenMode = payload.tokenMode || 'estimate';
    const requestedProjectIds = (payload.projectIds || []).map((item) => String(item || '').trim()).filter(Boolean);
    const snapshotId = `ei-stats-${now.getTime()}`;

    return this.statisticsSnapshotModel
      .create({
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
          totalDocsLines: 0,
          totalDocsFileCount: 0,
          totalFrontendBytes: 0,
          totalFrontendLines: 0,
          totalFrontendFileCount: 0,
          totalBackendBytes: 0,
          totalBackendLines: 0,
          totalBackendFileCount: 0,
          grandTotalBytes: 0,
          projectCount: 0,
          successCount: 0,
          failureCount: 0,
        },
        errors: [],
      })
      .then(async () => {
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

          await this.safeEmitStatisticsMessage({
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

          await this.safeEmitStatisticsMessage({
            receiverId: payload.receiverId,
            snapshotId,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }

        return this.getSnapshotById(snapshotId);
      });
  }

  getLatestSnapshot() {
    return this.statisticsSnapshotModel.findOne({}).sort({ createdAt: -1 }).lean().exec();
  }

  async getSnapshotById(snapshotId: string) {
    const snapshot = await this.statisticsSnapshotModel.findOne({ snapshotId }).lean().exec();
    if (!snapshot) {
      throw new NotFoundException('Statistics snapshot not found');
    }
    return snapshot;
  }

  listSnapshots(limit?: number) {
    const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.statisticsSnapshotModel.find({}).sort({ createdAt: -1 }).limit(normalizedLimit).lean().exec();
  }
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import * as path from 'path';
import { Model } from 'mongoose';
import { RedisService } from '@libs/infra';
import { DocsHeatRankingQueryDto, RefreshDocsHeatDto } from '../dto/docs-heat.dto';
import { EiDocCommitFact, EiDocCommitFactDocument } from '../schemas/ei-doc-commit-fact.schema';
import { EiAppConfigService } from './ei-app-config.service';

const execFileAsync = promisify(execFile);

type HeatWindow = '8h' | '1d' | '7d';

type DocsHeatRow = {
  rank: number;
  path: string;
  writeCount: number;
  writeFreq: number;
  lastWrittenAt: string;
  heatScore: number;
  weight: number;
};

type DocsHeatLatest = {
  runId: string;
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  completedAt?: string;
  error?: string;
  summary?: {
    scannedCommits: number;
    scannedDocWrites: number;
    upsertedFacts: number;
  };
};

@Injectable()
export class DocsHeatService {
  private readonly rankingKeyPrefix = 'ei:docs-heat:v1:ranking';
  private readonly latestKey = 'ei:docs-heat:v1:latest';
  private readonly rankingTtlSeconds = 8 * 24 * 60 * 60;
  private readonly factRetentionDays = 30;
  private readonly workspaceRoot = this.resolveWorkspaceRoot();

  constructor(
    @InjectModel(EiDocCommitFact.name)
    private readonly factModel: Model<EiDocCommitFactDocument>,
    private readonly redisService: RedisService,
    private readonly appConfigService: EiAppConfigService,
  ) {}

  async refresh(dto: RefreshDocsHeatDto) {
    const runId = `docs-heat-${Date.now()}`;
    const startedAt = new Date();
    await this.setLatest({ runId, status: 'running', startedAt: startedAt.toISOString() });

    try {
      const commitFacts = await this.scanGitDocCommitFacts();
      let upsertedFacts = 0;
      if (commitFacts.length > 0) {
        const result = await this.factModel.bulkWrite(
          commitFacts.map((item) => ({
            updateOne: {
              filter: {
                commitSha: item.commitSha,
                docPath: item.docPath,
              },
              update: {
                $setOnInsert: item,
              },
              upsert: true,
            },
          })),
          { ordered: false },
        );
        upsertedFacts = Number((result as any)?.upsertedCount || 0);
      }

      await this.cleanupOldFacts();

      const docsHeatConfig = await this.appConfigService.getDocsHeatConfig();
      const effectiveTopN = dto?.topN || docsHeatConfig.topN;
      const allFacts = await this.fetchWindowFacts('7d');

      await Promise.all(
        (['8h', '1d', '7d'] as HeatWindow[]).map(async (window) => {
          const ranking = this.calculateRankingFromFacts({
            facts: allFacts,
            window,
            topN: effectiveTopN,
            config: docsHeatConfig,
          });
          await this.redisService.set(this.getRankingKey(window), JSON.stringify(ranking), this.rankingTtlSeconds);
        }),
      );

      const completedAt = new Date();
      const summary = {
        scannedCommits: new Set(commitFacts.map((item) => item.commitSha)).size,
        scannedDocWrites: commitFacts.length,
        upsertedFacts,
      };
      await this.setLatest({
        runId,
        status: 'success',
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        summary,
      });

      return {
        runId,
        status: 'success',
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        summary,
      };
    } catch (error: any) {
      const completedAt = new Date();
      const message = error instanceof Error ? error.message : String(error || 'refresh failed');
      await this.setLatest({
        runId,
        status: 'failed',
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        error: message,
      });
      throw error;
    }
  }

  async getRanking(query: DocsHeatRankingQueryDto) {
    const window = (query?.window || '1d') as HeatWindow;
    const docsHeatConfig = await this.appConfigService.getDocsHeatConfig();
    const topN = query?.topN || docsHeatConfig.topN;

    const cached = await this.redisService.get(this.getRankingKey(window));
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        return {
          window,
          topN,
          ranking: Array.isArray(parsed) ? parsed.slice(0, topN) : [],
          source: 'redis',
        };
      } catch {
        // ignore broken cache and fallback to facts recompute
      }
    }

    const facts = await this.fetchWindowFacts('7d');
    const ranking = this.calculateRankingFromFacts({
      facts,
      window,
      topN,
      config: docsHeatConfig,
    });
    await this.redisService.set(this.getRankingKey(window), JSON.stringify(ranking), this.rankingTtlSeconds);

    return {
      window,
      topN,
      ranking,
      source: 'mongo-recompute',
    };
  }

  async getLatest(): Promise<DocsHeatLatest | null> {
    const cached = await this.redisService.get(this.latestKey);
    if (!cached) {
      return null;
    }
    try {
      return JSON.parse(cached);
    } catch {
      return null;
    }
  }

  private async setLatest(value: DocsHeatLatest): Promise<void> {
    await this.redisService.set(this.latestKey, JSON.stringify(value));
  }

  private getRankingKey(window: HeatWindow): string {
    return `${this.rankingKeyPrefix}:${window}`;
  }

  private async cleanupOldFacts(): Promise<void> {
    const cutoff = new Date(Date.now() - this.factRetentionDays * 24 * 60 * 60 * 1000);
    await this.factModel.deleteMany({ committedAt: { $lt: cutoff } }).exec();
  }

  private async fetchWindowFacts(window: HeatWindow): Promise<Array<{ docPath: string; committedAt: Date }>> {
    const cutoff = new Date(Date.now() - this.windowHours(window) * 60 * 60 * 1000);
    const rows = await this.factModel
      .find({ committedAt: { $gte: cutoff } })
      .select({ docPath: 1, committedAt: 1 })
      .lean()
      .exec();

    return rows.map((item: any) => ({
      docPath: String(item.docPath || ''),
      committedAt: new Date(item.committedAt),
    }));
  }

  private calculateRankingFromFacts(input: {
    facts: Array<{ docPath: string; committedAt: Date }>;
    window: HeatWindow;
    topN: number;
    config: {
      weights: Array<{ pattern: string; weight: number }>;
      excludes: string[];
      defaultWeight: number;
    };
  }): DocsHeatRow[] {
    const now = Date.now();
    const windowHours = this.windowHours(input.window);
    const cutoff = now - windowHours * 60 * 60 * 1000;
    const writeMap = new Map<string, { writeCount: number; lastWrittenAt: number }>();

    for (const fact of input.facts) {
      const ts = new Date(fact.committedAt).getTime();
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      const docPath = String(fact.docPath || '').trim();
      if (!docPath || this.isExcluded(docPath, input.config.excludes)) continue;

      const existing = writeMap.get(docPath);
      if (existing) {
        existing.writeCount += 1;
        existing.lastWrittenAt = Math.max(existing.lastWrittenAt, ts);
      } else {
        writeMap.set(docPath, { writeCount: 1, lastWrittenAt: ts });
      }
    }

    const rows = Array.from(writeMap.entries()).map(([docPath, value]) => {
      const writeFreq = value.writeCount / windowHours;
      const weight = this.resolveWeight(docPath, input.config.weights, input.config.defaultWeight);
      const hoursSinceLastWrite = Math.max(0, (now - value.lastWrittenAt) / (1000 * 60 * 60));
      const recencyDecay = Math.exp(-hoursSinceLastWrite / windowHours);
      const heatScore = writeFreq * weight * recencyDecay;
      return {
        path: docPath,
        writeCount: value.writeCount,
        writeFreq,
        lastWrittenAt: new Date(value.lastWrittenAt).toISOString(),
        heatScore,
        weight,
      };
    });

    const sorted = rows
      .sort((a, b) => {
        if (b.heatScore !== a.heatScore) return b.heatScore - a.heatScore;
        if (b.writeCount !== a.writeCount) return b.writeCount - a.writeCount;
        return b.lastWrittenAt.localeCompare(a.lastWrittenAt);
      })
      .slice(0, Math.max(1, Math.floor(input.topN)));

    return sorted.map((item, index) => ({
      rank: index + 1,
      path: item.path,
      writeCount: item.writeCount,
      writeFreq: Number(item.writeFreq.toFixed(6)),
      lastWrittenAt: item.lastWrittenAt,
      heatScore: Number(item.heatScore.toFixed(6)),
      weight: Number(item.weight.toFixed(3)),
    }));
  }

  private resolveWeight(docPath: string, weights: Array<{ pattern: string; weight: number }>, defaultWeight: number): number {
    for (const rule of weights) {
      if (this.matchGlob(docPath, rule.pattern)) {
        return Number.isFinite(rule.weight) && rule.weight > 0 ? rule.weight : defaultWeight;
      }
    }
    return defaultWeight;
  }

  private isExcluded(docPath: string, excludes: string[]): boolean {
    return excludes.some((pattern) => this.matchGlob(docPath, pattern));
  }

  private matchGlob(target: string, pattern: string): boolean {
    const source = String(target || '').trim();
    const glob = String(pattern || '').trim();
    if (!source || !glob) return false;

    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '::DOUBLE_STAR::')
      .replace(/\*/g, '[^/]*')
      .replace(/::DOUBLE_STAR::/g, '.*');
    const regex = new RegExp(`^${escaped}$`);
    return regex.test(source);
  }

  private windowHours(window: HeatWindow): number {
    if (window === '8h') return 8;
    if (window === '1d') return 24;
    return 24 * 7;
  }

  private resolveWorkspaceRoot(): string {
    const envRoot = process.env.EI_WORKSPACE_ROOT || process.env.WORKSPACE_ROOT;
    if (envRoot?.trim()) {
      return path.resolve(envRoot.trim());
    }
    const cwd = process.cwd();
    const candidates = [cwd, path.resolve(cwd, '..'), path.resolve(cwd, '..', '..')];
    for (const candidate of candidates) {
      if (existsSync(path.join(candidate, 'docs')) && existsSync(path.join(candidate, '.git'))) {
        return candidate;
      }
    }
    return cwd;
  }

  private async scanGitDocCommitFacts(): Promise<Array<{ commitSha: string; docPath: string; committedAt: Date; author: string }>> {
    const args = ['log', '--since=7 days ago', '--name-only', '--pretty=format:%H|%aI|%an', '--', 'docs'];
    const { stdout } = await execFileAsync('git', args, {
      cwd: this.workspaceRoot,
      maxBuffer: 10 * 1024 * 1024,
    });

    const lines = String(stdout || '').split(/\r?\n/);
    const rows: Array<{ commitSha: string; docPath: string; committedAt: Date; author: string }> = [];

    let currentSha = '';
    let currentDate: Date | null = null;
    let currentAuthor = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.includes('|')) {
        const [sha, isoTime, author] = trimmed.split('|');
        if (sha && isoTime) {
          currentSha = sha.trim();
          currentDate = new Date(isoTime.trim());
          currentAuthor = String(author || '').trim();
        }
        continue;
      }

      if (!currentSha || !currentDate || Number.isNaN(currentDate.getTime())) {
        continue;
      }

      if (!trimmed.startsWith('docs/') || !trimmed.endsWith('.md')) {
        continue;
      }

      rows.push({
        commitSha: currentSha,
        docPath: trimmed,
        committedAt: currentDate,
        author: currentAuthor,
      });
    }

    return rows;
  }
}

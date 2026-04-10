import {
  BadRequestException,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { Subject, Observable } from 'rxjs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';
import { mkdir, readdir, readFile, stat, access } from 'fs/promises';

const execFileAsync = promisify(execFile);
import { map } from 'rxjs/operators';
import {
  SkillMarketPlatform,
  SkillMarketPlatformDocument,
  SkillMarketPlatformStatus,
} from '@agent/schemas/skill-market-platform.schema';
import {
  SkillGithubRepo,
  SkillGithubRepoDocument,
  SkillGithubRepoStatus,
} from '@agent/schemas/skill-github-repo.schema';
import { Skill, SkillDocument } from '@agent/schemas/agent-skill.schema';

interface PlatformPayload {
  name: string;
  url: string;
  priority?: number;
  status?: SkillMarketPlatformStatus;
  description?: string;
}

interface PlatformUpdates {
  name?: string;
  priority?: number;
  status?: SkillMarketPlatformStatus;
  description?: string;
}

interface RepoFilters {
  platformId?: string;
  status?: SkillGithubRepoStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}

interface MarketSearchPayload {
  keyword: string;
  platformId?: string;
  page?: number;
  pageSize?: number;
}

interface GithubRepoSummary {
  fullName: string;
  url: string;
  description?: string;
  stars: number;
  language?: string;
  topics: string[];
  owner: string;
}

export interface IndexTaskState {
  taskId: string;
  platformId: string;
  platformName: string;
  status: 'running' | 'done' | 'error';
  total: number;
  scanned: number;
  indexed: number;
  failed: number;
  currentRepo?: string;
  crawlError?: string;
  message?: string;
  startedAt: string;
  finishedAt?: string;
}

interface IndexTaskEntry {
  state: IndexTaskState;
  subject: Subject<IndexTaskState>;
}

const INDEX_TASK_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class SkillMarketService {
  private readonly logger = new Logger(SkillMarketService.name);
  private readonly indexTasks = new Map<string, IndexTaskEntry>();

  constructor(
    @InjectModel(SkillMarketPlatform.name)
    private readonly platformModel: Model<SkillMarketPlatformDocument>,
    @InjectModel(SkillGithubRepo.name)
    private readonly repoModel: Model<SkillGithubRepoDocument>,
    @InjectModel(Skill.name)
    private readonly skillModel: Model<SkillDocument>,
  ) {}

  async createPlatform(payload: PlatformPayload): Promise<SkillMarketPlatform> {
    if (!payload?.name?.trim()) {
      throw new BadRequestException('Platform name is required');
    }
    const normalizedUrl = this.normalizeUrl(payload.url);
    const existed = await this.platformModel.findOne({ url: normalizedUrl }).exec();
    if (existed) {
      throw new BadRequestException(`Platform URL already exists: ${normalizedUrl}`);
    }
    return this.platformModel.create({
      id: uuidv4(),
      name: payload.name.trim(),
      url: normalizedUrl,
      priority: this.normalizePriority(payload.priority),
      status: payload.status || 'active',
      description: payload.description?.trim() || undefined,
      repoCount: 0,
    });
  }

  async updatePlatform(platformId: string, updates: PlatformUpdates): Promise<SkillMarketPlatform> {
    const payload: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
      const name = String(updates.name || '').trim();
      if (!name) throw new BadRequestException('Platform name cannot be empty');
      payload.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'priority')) {
      payload.priority = this.normalizePriority(updates.priority);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
      payload.status = updates.status;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'description')) {
      payload.description = String(updates.description || '').trim() || undefined;
    }

    const platform = await this.platformModel
      .findOneAndUpdate({ id: platformId }, payload, { new: true })
      .exec();
    if (!platform) {
      throw new NotFoundException(`Platform not found: ${platformId}`);
    }
    return platform;
  }

  async deletePlatform(platformId: string): Promise<{ deleted: boolean; deletedRepos: number }> {
    const platform = await this.platformModel.findOneAndDelete({ id: platformId }).exec();
    if (!platform) {
      throw new NotFoundException(`Platform not found: ${platformId}`);
    }
    const deletedRepos = await this.repoModel.deleteMany({ platformId }).exec();
    return {
      deleted: true,
      deletedRepos: Number(deletedRepos?.deletedCount || 0),
    };
  }

  async listPlatforms(): Promise<SkillMarketPlatform[]> {
    return this.platformModel.find({}).sort({ priority: 1, updatedAt: -1 }).exec();
  }

  async startIndexPlatform(platformId: string): Promise<{ taskId: string }> {
    const platform = await this.getPlatformOrThrow(platformId);

    const taskId = uuidv4();
    const subject = new Subject<IndexTaskState>();
    const state: IndexTaskState = {
      taskId,
      platformId: platform.id,
      platformName: platform.name,
      status: 'running',
      total: 0,
      scanned: 0,
      indexed: 0,
      failed: 0,
      message: '正在爬取平台页面...',
      startedAt: new Date().toISOString(),
    };
    this.indexTasks.set(taskId, { state, subject });

    this.runIndexTask(taskId, platform).catch((err) => {
      this.logger.error(`[indexTask] Unexpected error taskId=${taskId}: ${(err as Error).message}`);
    });

    return { taskId };
  }

  subscribeIndexTask(taskId: string): Observable<MessageEvent> {
    const entry = this.indexTasks.get(taskId);
    if (!entry) {
      throw new NotFoundException(`Index task not found: ${taskId}`);
    }
    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({
        data: JSON.stringify(entry.state),
        type: 'progress',
        id: `${taskId}-snapshot`,
      } as MessageEvent);

      const sub = entry.subject
        .pipe(map((s) => ({ data: JSON.stringify(s), type: s.status === 'done' || s.status === 'error' ? s.status : 'progress', id: `${taskId}-${s.scanned}` } as MessageEvent)))
        .subscribe({
          next: (event) => subscriber.next(event),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });

      const heartbeat = setInterval(() => {
        subscriber.next({ data: '', type: 'heartbeat', id: `${taskId}-hb` } as MessageEvent);
      }, 15000);

      return () => {
        clearInterval(heartbeat);
        sub.unsubscribe();
      };
    });
  }

  getIndexTaskState(taskId: string): IndexTaskState | null {
    return this.indexTasks.get(taskId)?.state || null;
  }

  private async runIndexTask(taskId: string, platform: SkillMarketPlatformDocument): Promise<void> {
    const entry = this.indexTasks.get(taskId);
    if (!entry) return;
    const { state, subject } = entry;

    let fullNames: string[] = [];
    try {
      fullNames = await this.extractRepoFullNamesFromPlatform(platform.url);
    } catch (error) {
      const status = (error as any)?.response?.status;
      const message = (error as Error).message || 'Unknown crawl error';
      state.crawlError = status ? `HTTP ${status}: ${message}` : message;
      state.message = `平台爬取失败: ${state.crawlError}`;
      this.logger.warn(`[indexTask] Crawl failed ${platform.url}: ${state.crawlError}`);
    }

    const maxBatch = Math.min(fullNames.length, 50);
    state.total = maxBatch;
    state.message = maxBatch > 0 ? `发现 ${fullNames.length} 个仓库，开始索引（上限 ${maxBatch}）...` : (state.crawlError ? state.message : '未从平台页面发现 GitHub 仓库链接');
    subject.next({ ...state });

    for (let i = 0; i < maxBatch; i++) {
      const fullName = fullNames[i];
      state.scanned = i + 1;
      state.currentRepo = fullName;
      state.message = `正在索引 ${fullName} (${i + 1}/${maxBatch})`;
      subject.next({ ...state });

      try {
        const summary = await this.fetchGithubRepoSummary(fullName);
        if (!summary) {
          state.failed += 1;
        } else {
          await this.upsertGithubRepo(platform.id, summary);
          state.indexed += 1;
        }
      } catch (error) {
        state.failed += 1;
        this.logger.warn(`[indexTask] Failed ${fullName}: ${(error as Error).message}`);
      }

      if (i > 0 && i % 5 === 0) {
        await this.delay(500);
      }
    }

    const repoCount = await this.repoModel.countDocuments({ platformId: platform.id }).exec();
    await this.platformModel
      .findOneAndUpdate(
        { id: platform.id },
        { lastIndexedAt: new Date(), repoCount },
        { new: true },
      )
      .exec();

    state.currentRepo = undefined;
    state.finishedAt = new Date().toISOString();
    if (state.crawlError && maxBatch === 0) {
      state.status = 'error';
      state.message = `索引失败: ${state.crawlError}`;
    } else {
      state.status = 'done';
      state.message = `索引完成: 扫描 ${state.scanned}，成功 ${state.indexed}，失败 ${state.failed}${state.crawlError ? `（爬取异常: ${state.crawlError}）` : ''}`;
    }

    subject.next({ ...state });
    subject.complete();

    setTimeout(() => this.indexTasks.delete(taskId), INDEX_TASK_TTL_MS);
  }

  async listRepos(filters?: RepoFilters): Promise<{
    items: SkillGithubRepo[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const query: Record<string, unknown> = {};
    if (filters?.platformId?.trim()) {
      query.platformId = filters.platformId.trim();
    }
    if (filters?.status) {
      query.status = filters.status;
    }
    const search = String(filters?.search || '').trim();
    if (search) {
      const regex = new RegExp(this.escapeRegex(search), 'i');
      query.$or = [
        { fullName: regex },
        { description: regex },
        { language: regex },
        { owner: regex },
        { topics: regex },
      ];
    }

    const page = Math.max(1, Number(filters?.page || 1));
    const pageSize = Math.max(1, Math.min(50, Number(filters?.pageSize || 10)));
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.repoModel
        .find(query)
        .sort({ stars: -1, updatedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .exec(),
      this.repoModel.countDocuments(query).exec(),
    ]);

    return {
      items: items as unknown as SkillGithubRepo[],
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async addRepoManually(repoUrl: string, platformId?: string): Promise<SkillGithubRepo> {
    const url = String(repoUrl || '').trim();
    const match = url.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
    if (!match) {
      throw new BadRequestException('无效的 GitHub 仓库 URL，格式应为 https://github.com/owner/repo');
    }
    const fullName = this.normalizeGithubFullName(match[1]);
    if (!fullName) {
      throw new BadRequestException('无法解析仓库名称');
    }

    const existed = await this.repoModel.findOne({ fullName }).exec();
    if (existed) {
      return existed as unknown as SkillGithubRepo;
    }

    const resolvedPlatformId = await this.resolveFallbackPlatformId(platformId).catch(() => 'manual');

    const summary = await this.fetchGithubRepoSummary(fullName);
    if (!summary) {
      return this.repoModel.create({
        id: uuidv4(),
        platformId: resolvedPlatformId,
        fullName,
        url: `https://github.com/${fullName}`,
        owner: fullName.split('/')[0],
        indexedAt: new Date(),
        status: 'pending',
        skillIds: [],
      }) as unknown as SkillGithubRepo;
    }

    return this.upsertGithubRepo(resolvedPlatformId, summary);
  }

  async skipRepo(repoId: string): Promise<SkillGithubRepo> {
    const repo = await this.repoModel
      .findOneAndUpdate({ id: repoId }, { status: 'skipped' }, { new: true })
      .exec();
    if (!repo) {
      throw new NotFoundException(`Repo not found: ${repoId}`);
    }
    return repo;
  }

  async importRepo(repoId: string, options?: { force?: boolean }): Promise<{
    repo: SkillGithubRepo;
    skills: Array<{ id: string; name: string; path: string }>;
    created: number;
    skipped: number;
    localPath: string;
  }> {
    const repo = await this.repoModel.findOne({ id: repoId }).exec();
    if (!repo) {
      throw new NotFoundException(`Repo not found: ${repoId}`);
    }

    if (!options?.force) {
      const existingIds = [
        ...((repo as any).skillIds || []),
        ...((repo as any).skillId ? [(repo as any).skillId] : []),
      ].filter((id: string) => typeof id === 'string' && id.trim());

      if (existingIds.length > 0) {
        const existedSkills = await this.skillModel.find({ id: { $in: existingIds } }).exec();
        if (existedSkills.length > 0) {
          return {
            repo: repo as unknown as SkillGithubRepo,
            skills: existedSkills.map((s) => ({ id: s.id, name: s.name, path: (s.metadata as any)?.skillPath || '' })),
            created: 0,
            skipped: existedSkills.length,
            localPath: await this.getRepoLocalPath(repo.fullName),
          };
        }
      }
    }

    const localPath = await this.cloneOrUpdateRepo(repo.fullName, repo.url);
    const skillFiles = await this.scanLocalSkillMdFiles(localPath);

    if (skillFiles.length === 0) {
      throw new BadRequestException(`仓库 ${repo.fullName} 中未发现 SKILL.md 文件`);
    }

    const createdSkills: Array<{ id: string; name: string; path: string }> = [];
    const skillIds: string[] = [...(repo.skillIds || [])];
    let skipped = 0;

    for (const skillPath of skillFiles) {
      const existedByPath = await this.skillModel.findOne({
        repoId: repo.id,
        'metadata.skillPath': skillPath,
      }).exec();
      if (existedByPath) {
        if (!skillIds.includes(existedByPath.id)) {
          skillIds.push(existedByPath.id);
        }
        createdSkills.push({ id: existedByPath.id, name: existedByPath.name, path: skillPath });
        skipped += 1;
        continue;
      }

      let content = '';
      try {
        content = await readFile(resolve(localPath, skillPath), 'utf-8');
      } catch (error) {
        this.logger.warn(`Failed to read ${skillPath} from ${localPath}: ${(error as Error).message}`);
        continue;
      }

      const skillName = this.deriveSkillNameFromPath(repo.fullName, skillPath);
      const description = this.extractDescriptionFromContent(content) || repo.description?.trim() || `Skill from ${repo.fullName}`;

      const skill = await this.skillModel.create({
        id: uuidv4(),
        name: skillName,
        slug: await this.ensureUniqueSlug(this.normalizeSlug(skillName)),
        description,
        category: 'general',
        tags: this.uniqueStrings(repo.topics || []),
        sourceType: 'github',
        sourceUrl: `${repo.url}/blob/main/${skillPath}`,
        repoId: repo.id,
        provider: 'github',
        version: '1.0.0',
        status: 'experimental',
        confidenceScore: 60,
        usageCount: 0,
        discoveredBy: 'SkillMarketService',
        content,
        contentType: 'text/markdown',
        contentSize: content.length,
        contentUpdatedAt: new Date(),
        metadata: {
          fullName: repo.fullName,
          owner: repo.owner,
          stars: Number(repo.stars || 0),
          language: repo.language || '',
          skillPath,
        },
        metadataUpdatedAt: new Date(),
        lastVerifiedAt: new Date(),
      });

      skillIds.push(skill.id);
      createdSkills.push({ id: skill.id, name: skill.name, path: skillPath });
    }

    const updatedRepo = await this.repoModel
      .findOneAndUpdate(
        { id: repo.id },
        { status: 'imported', skillIds },
        { new: true },
      )
      .exec();

    return {
      repo: (updatedRepo || repo) as unknown as SkillGithubRepo,
      skills: createdSkills,
      created: createdSkills.length - skipped,
      skipped,
      localPath,
    };
  }

  async searchMarket(payload: MarketSearchPayload): Promise<{
    items: SkillGithubRepo[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    remoteFetched: number;
  }> {
    const keyword = String(payload?.keyword || '').trim();
    if (!keyword) {
      throw new BadRequestException('keyword is required');
    }
    const page = Math.max(1, Number(payload?.page || 1));
    const pageSize = Math.max(1, Math.min(20, Number(payload?.pageSize || 10)));

    const localResult = await this.listRepos({
      platformId: payload.platformId,
      search: keyword,
      page,
      pageSize,
    });

    if (localResult.items.length >= pageSize) {
      return {
        ...localResult,
        remoteFetched: 0,
      };
    }

    const remoteNeeded = pageSize - localResult.items.length;
    const remoteResults = await this.searchGithubRepositories(keyword, remoteNeeded);
    const fallbackPlatformId = await this.resolveFallbackPlatformId(payload.platformId);
    const merged = [...localResult.items];
    const localNameSet = new Set(localResult.items.map((item) => item.fullName));
    let remoteFetched = 0;

    for (const remote of remoteResults) {
      const repo = await this.upsertGithubRepo(fallbackPlatformId, remote);
      remoteFetched += 1;
      if (!localNameSet.has(repo.fullName)) {
        merged.push(repo);
        localNameSet.add(repo.fullName);
      }
    }

    return {
      items: merged.slice(0, pageSize),
      total: merged.length,
      page,
      pageSize,
      totalPages: 1,
      remoteFetched,
    };
  }

  private async getPlatformOrThrow(platformId: string): Promise<SkillMarketPlatformDocument> {
    const platform = await this.platformModel.findOne({ id: platformId }).exec();
    if (!platform) {
      throw new NotFoundException(`Platform not found: ${platformId}`);
    }
    return platform;
  }

  private normalizeUrl(url: string): string {
    const value = String(url || '').trim();
    if (!value) {
      throw new BadRequestException('Platform url is required');
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException(`Invalid platform url: ${value}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('Platform url must be http or https');
    }
    const pathname = parsed.pathname.endsWith('/')
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
    parsed.pathname = pathname || '/';
    return parsed.toString().replace(/\/$/, '');
  }

  private normalizePriority(priority?: number): number {
    const value = Number(priority);
    if (!Number.isFinite(value)) return 100;
    return Math.max(0, Math.floor(value));
  }

  private async extractRepoFullNamesFromPlatform(platformUrl: string): Promise<string[]> {
    const { data } = await axios.get(platformUrl, {
      timeout: 20000,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
        'Cache-Control': 'no-cache',
      },
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const html = String(data || '');
    const fullNames = new Set<string>();
    const regex = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g;
    let match: RegExpExecArray | null = regex.exec(html);
    while (match) {
      const normalized = this.normalizeGithubFullName(match[1]);
      if (normalized) {
        fullNames.add(normalized);
      }
      match = regex.exec(html);
    }

    return Array.from(fullNames);
  }

  private normalizeGithubFullName(value: string): string | null {
    const candidate = String(value || '').trim().replace(/^\/+/, '');
    if (!candidate) return null;
    const [owner, repo] = candidate.split('/');
    if (!owner || !repo) return null;
    if (repo.includes(' ')) return null;
    const cleanRepo = repo
      .replace(/\.git$/i, '')
      .replace(/\/.+$/, '')
      .trim();
    if (!cleanRepo) return null;
    return `${owner}/${cleanRepo}`;
  }

  private githubHeaders() {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'HarbinSkillMarketIndexer/1.0',
    };
    const token = String(process.env.GITHUB_TOKEN || '').trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  private async fetchGithubRepoSummary(fullName: string): Promise<GithubRepoSummary | null> {
    try {
      const { data } = await axios.get(`https://api.github.com/repos/${fullName}`, {
        timeout: 15000,
        headers: this.githubHeaders(),
      });
      return {
        fullName,
        url: String(data?.html_url || `https://github.com/${fullName}`),
        description: data?.description ? String(data.description) : undefined,
        stars: Number(data?.stargazers_count || 0),
        language: data?.language ? String(data.language) : undefined,
        topics: this.uniqueStrings(Array.isArray(data?.topics) ? data.topics : []),
        owner: String(data?.owner?.login || fullName.split('/')[0] || ''),
      };
    } catch (error) {
      this.logger.warn(
        `GitHub repo detail fetch failed for ${fullName}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async searchGithubRepositories(keyword: string, limit: number): Promise<GithubRepoSummary[]> {
    if (limit <= 0) return [];
    try {
      const query = `${keyword} in:name,description`;
      const { data } = await axios.get('https://api.github.com/search/repositories', {
        timeout: 15000,
        headers: this.githubHeaders(),
        params: {
          q: query,
          sort: 'stars',
          order: 'desc',
          per_page: Math.min(20, Math.max(1, limit)),
          page: 1,
        },
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      return items
        .map((item: any) => {
          const fullName = this.normalizeGithubFullName(String(item?.full_name || ''));
          if (!fullName) return null;
          return {
            fullName,
            url: String(item?.html_url || `https://github.com/${fullName}`),
            description: item?.description ? String(item.description) : undefined,
            stars: Number(item?.stargazers_count || 0),
            language: item?.language ? String(item.language) : undefined,
            topics: this.uniqueStrings(Array.isArray(item?.topics) ? item.topics : []),
            owner: String(item?.owner?.login || fullName.split('/')[0] || ''),
          } as GithubRepoSummary;
        })
        .filter((item): item is GithubRepoSummary => Boolean(item));
    } catch (error) {
      this.logger.warn(`GitHub search failed: ${(error as Error).message}`);
      return [];
    }
  }

  private async upsertGithubRepo(
    platformId: string,
    summary: GithubRepoSummary,
  ): Promise<SkillGithubRepo> {
    const existed = await this.repoModel.findOne({ fullName: summary.fullName }).exec();
    const nextStatus = existed?.status || 'pending';
    const payload = {
      platformId,
      fullName: summary.fullName,
      url: summary.url,
      description: summary.description,
      stars: summary.stars,
      language: summary.language,
      topics: this.uniqueStrings(summary.topics || []),
      owner: summary.owner,
      indexedAt: new Date(),
      status: nextStatus,
      skillIds: existed?.skillIds?.length ? existed.skillIds : [],
    };

    if (existed) {
      const updated = await this.repoModel
        .findOneAndUpdate({ id: existed.id }, payload, { new: true })
        .exec();
      if (!updated) {
        throw new NotFoundException(`Repo not found: ${existed.id}`);
      }
      return updated as unknown as SkillGithubRepo;
    }

    const created = await this.repoModel.create({ id: uuidv4(), ...payload });
    return created as unknown as SkillGithubRepo;
  }

  private async resolveFallbackPlatformId(platformId?: string): Promise<string> {
    if (platformId?.trim()) {
      return platformId.trim();
    }
    const active = await this.platformModel
      .findOne({ status: 'active' })
      .sort({ priority: 1, updatedAt: -1 })
      .exec();
    if (active?.id) {
      return active.id;
    }
    const fallback = await this.platformModel
      .findOne({})
      .sort({ priority: 1, updatedAt: -1 })
      .exec();
    if (!fallback?.id) {
      throw new BadRequestException('No skill market platform configured');
    }
    return fallback.id;
  }

  private async resolveWorkspaceRoot(): Promise<string> {
    const envRoot = process.env.AGENT_WORKSPACE_ROOT;
    if (envRoot) {
      try {
        await access(resolve(envRoot, 'README.md'));
        return envRoot;
      } catch { /* fallback */ }
    }

    const candidates = [
      process.cwd(),
      resolve(process.cwd(), '..'),
      resolve(process.cwd(), '../..'),
    ];

    for (const candidate of candidates) {
      try {
        await Promise.all([
          access(resolve(candidate, 'README.md')),
          access(resolve(candidate, 'docs')),
        ]);
        return candidate;
      } catch { /* next */ }
    }

    return process.cwd();
  }

  private async getReposRoot(): Promise<string> {
    const workspaceRoot = await this.resolveWorkspaceRoot();
    return resolve(workspaceRoot, 'data', 'repos');
  }

  private async getRepoLocalPath(fullName: string): Promise<string> {
    const dirName = fullName.replace('/', '-');
    const reposRoot = await this.getReposRoot();
    return resolve(reposRoot, dirName);
  }

  private async cloneOrUpdateRepo(fullName: string, repoUrl: string): Promise<string> {
    const reposRoot = await this.getReposRoot();
    await mkdir(reposRoot, { recursive: true });

    const localPath = await this.getRepoLocalPath(fullName);
    const timeoutMs = Math.max(5_000, Number(process.env.REPO_WRITER_TIMEOUT_MS || 120_000));
    const cloneUrl = repoUrl.endsWith('.git') ? repoUrl : `${repoUrl}.git`;

    let localExists = false;
    try {
      await access(localPath);
      localExists = true;
    } catch {
      localExists = false;
    }

    if (localExists) {
      try {
        await execFileAsync('git', ['-C', localPath, 'fetch', '--depth', '1', 'origin', 'HEAD'], {
          timeout: timeoutMs,
          maxBuffer: 5 * 1024 * 1024,
        });
        await execFileAsync('git', ['-C', localPath, 'reset', '--hard', 'FETCH_HEAD'], {
          timeout: timeoutMs,
          maxBuffer: 5 * 1024 * 1024,
        });
        this.logger.log(`[importRepo] Updated repo ${fullName} at ${localPath}`);
      } catch (error) {
        this.logger.warn(`[importRepo] Failed to update ${fullName}, re-cloning: ${(error as Error).message}`);
        const { rm } = await import('fs/promises');
        await rm(localPath, { recursive: true, force: true });
        await execFileAsync('git', ['clone', '--depth', '1', cloneUrl, localPath], {
          timeout: timeoutMs,
          maxBuffer: 5 * 1024 * 1024,
        });
      }
    } else {
      this.logger.log(`[importRepo] Cloning ${fullName} to ${localPath}`);
      await execFileAsync('git', ['clone', '--depth', '1', cloneUrl, localPath], {
        timeout: timeoutMs,
        maxBuffer: 5 * 1024 * 1024,
      });
    }

    return localPath;
  }

  private async scanLocalSkillMdFiles(localPath: string, subDir = ''): Promise<string[]> {
    const results: string[] = [];
    const currentDir = subDir ? resolve(localPath, subDir) : localPath;

    let entries: import('fs').Dirent[];
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const relativePath = subDir ? `${subDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        const nested = await this.scanLocalSkillMdFiles(localPath, relativePath);
        results.push(...nested);
      } else if (entry.isFile() && /^SKILL\.md$/i.test(entry.name)) {
        results.push(relativePath);
      }
    }

    return results;
  }

  private async discoverSkillMdFiles(fullName: string): Promise<Array<{ path: string; sha: string }>> {
    try {
      const { data } = await axios.get(`https://api.github.com/repos/${fullName}/git/trees/HEAD?recursive=1`, {
        timeout: 20000,
        headers: this.githubHeaders(),
      });
      const tree = Array.isArray(data?.tree) ? data.tree : [];
      return tree
        .filter((item: any) =>
          item.type === 'blob' &&
          typeof item.path === 'string' &&
          /SKILL\.md$/i.test(item.path),
        )
        .map((item: any) => ({ path: String(item.path), sha: String(item.sha) }));
    } catch (error) {
      this.logger.warn(`Failed to fetch repo tree ${fullName}: ${(error as Error).message}`);
      return [];
    }
  }

  private async fetchFileContent(fullName: string, sha: string): Promise<string> {
    const { data } = await axios.get(`https://api.github.com/repos/${fullName}/git/blobs/${sha}`, {
      timeout: 15000,
      headers: this.githubHeaders(),
    });
    if (data?.encoding === 'base64' && data?.content) {
      return Buffer.from(String(data.content), 'base64').toString('utf-8');
    }
    return String(data?.content || '');
  }

  private deriveSkillNameFromPath(fullName: string, skillPath: string): string {
    const parts = skillPath.split('/');
    if (parts.length >= 2) {
      const parentDir = parts[parts.length - 2];
      if (parentDir && parentDir.toLowerCase() !== 'skills' && parentDir.toLowerCase() !== '.claude') {
        return parentDir;
      }
    }
    const repoName = fullName.split('/')[1] || fullName;
    return parts.length > 1 ? `${repoName}-${parts.slice(0, -1).join('-')}` : repoName;
  }

  private extractDescriptionFromContent(content: string): string | undefined {
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (trimmed.length >= 10 && trimmed.length <= 500) {
        return trimmed;
      }
    }
    return undefined;
  }

  private deriveSkillName(fullName: string): string {
    const parts = fullName.split('/').map((item) => item.trim()).filter(Boolean);
    return parts[1] || parts[0] || 'github-skill';
  }

  private normalizeSlug(value: string): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'skill';
  }

  private async ensureUniqueSlug(baseSlug: string): Promise<string> {
    let next = baseSlug;
    for (let cursor = 1; cursor <= 10000; cursor += 1) {
      const existed = await this.skillModel
        .findOne({ slug: next, provider: 'github', version: '1.0.0' })
        .exec();
      if (!existed) return next;
      next = `${baseSlug}-${cursor}`;
    }
    throw new BadRequestException('Failed to allocate unique slug for imported repository');
  }

  private uniqueStrings(values: unknown[]): string[] {
    return Array.from(
      new Set(
        (values || [])
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    );
  }

  private escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

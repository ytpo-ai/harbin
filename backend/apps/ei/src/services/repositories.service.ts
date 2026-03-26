import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateEngineeringRepositoryDto, UpdateEngineeringRepositoryDto } from '../dto';
import { EngineeringRepository, EngineeringRepositoryDocument } from '../schemas/engineering-repository.schema';
import { EiGithubClientService } from './ei-github-client.service';

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

export type DocTreeNode = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: DocTreeNode[];
};

@Injectable()
export class EiRepositoriesService {
  private readonly maxFilesPerSummary = 20;
  private readonly maxCharsPerFile = 12000;

  constructor(
    @InjectModel(EngineeringRepository.name)
    private readonly repositoryModel: Model<EngineeringRepositoryDocument>,
    private readonly githubClient: EiGithubClientService,
  ) {}

  private isDocFilePath(targetPath: string): boolean {
    const lower = targetPath.toLowerCase();
    if (lower.startsWith('docs/')) return true;
    if (/^readme(\.|$)/i.test(lower)) return true;
    if (/contributing/i.test(lower)) return true;
    if (/architecture/i.test(lower)) return true;
    if (/adr/i.test(lower)) return true;
    return false;
  }

  private async listDirectoryRecursive(owner: string, repo: string, targetPath: string, ref: string): Promise<GitHubContentItem[]> {
    const encodedPath = targetPath ? `/${targetPath}` : '';
    const items = await this.githubClient.githubRequest<GitHubContentItem[]>(
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

    const parts = raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return parts[0] || raw;
  }

  private async getDocPathSuggestions(owner: string, repo: string, preferredBranch: string, requestedPath: string) {
    const { data: docsFiles } = await this.githubClient.runWithBranchFallback(owner, repo, preferredBranch, (branch) =>
      this.listDirectoryRecursive(owner, repo, 'docs', branch),
    );

    const markdownPaths = docsFiles
      .filter((item) => item.type === 'file' && /\.(md|mdx)$/i.test(item.name))
      .map((item) => item.path);

    return this.buildDocPathSuggestions(markdownPaths, requestedPath);
  }

  private async collectDocFiles(owner: string, repo: string, branch: string): Promise<GitHubContentItem[]> {
    const rootItems = await this.githubClient.githubRequest<GitHubContentItem[]>(
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

  private async getContentItem(owner: string, repo: string, targetPath: string, branch: string): Promise<GitHubContentItem> {
    const encodedPath = targetPath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return this.githubClient.githubRequest<GitHubContentItem>(
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

  private summarizeSingleDoc(targetPath: string, content: string): {
    path: string;
    title: string;
    summary: string;
    evidence: string[];
  } {
    const normalized = content.replace(/\r\n/g, '\n').slice(0, this.maxCharsPerFile);
    const lines = normalized.split('\n').map((line) => line.trim());
    const heading = lines.find((line) => /^#{1,6}\s+/.test(line));
    const title = heading ? heading.replace(/^#{1,6}\s+/, '') : targetPath;

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
      path: targetPath,
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

  async createRepository(payload: CreateEngineeringRepositoryDto) {
    const { owner, repo } = this.githubClient.parseGithubUrl(payload.repositoryUrl);

    const repoInfo = await this.githubClient.githubRequest<{ default_branch: string }>(`/repos/${owner}/${repo}`);
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

  listRepositories() {
    return this.repositoryModel.find({}).sort({ updatedAt: -1 }).exec();
  }

  async updateRepository(id: string, payload: UpdateEngineeringRepositoryDto) {
    const updated = await this.repositoryModel
      .findOneAndUpdate({ _id: new Types.ObjectId(id) }, { $set: payload }, { new: true })
      .exec();

    if (!updated) {
      throw new NotFoundException('Repository config not found');
    }

    return updated;
  }

  async deleteRepository(id: string) {
    const result = await this.repositoryModel.deleteOne({ _id: new Types.ObjectId(id) }).exec();
    return { success: result.deletedCount > 0 };
  }

  async summarizeRepository(id: string) {
    const repoConfig = await this.repositoryModel.findOne({ _id: new Types.ObjectId(id) }).exec();

    if (!repoConfig) {
      throw new NotFoundException('Repository config not found');
    }

    try {
      const { data: files, branch: branchUsed } = await this.githubClient.runWithBranchFallback(
        repoConfig.owner,
        repoConfig.repo,
        repoConfig.branch || 'main',
        (branch) => this.collectDocFiles(repoConfig.owner, repoConfig.repo, branch),
      );
      const docSummaries: Array<{ path: string; title: string; summary: string; evidence: string[] }> = [];

      for (const file of files) {
        if (!file.download_url) continue;
        const content = await this.githubClient.githubTextRequest(file.download_url);
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
    const repoConfig = await this.repositoryModel.findOne({ _id: new Types.ObjectId(id) }).exec();

    if (!repoConfig) {
      throw new NotFoundException('Repository config not found');
    }

    const { data: docsFiles, branch: branchUsed } = await this.githubClient
      .runWithBranchFallback(repoConfig.owner, repoConfig.repo, repoConfig.branch || 'main', (branch) =>
        this.listDirectoryRecursive(repoConfig.owner, repoConfig.repo, 'docs', branch),
      )
      .catch(() => ({ data: [] as GitHubContentItem[], branch: repoConfig.branch || 'main' }));

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

    const repoConfig = await this.repositoryModel.findOne({ _id: new Types.ObjectId(id) }).exec();

    if (!repoConfig) {
      throw new NotFoundException('Repository config not found');
    }

    let file: GitHubContentItem;
    let branchUsed = repoConfig.branch || 'main';

    try {
      const contentResult = await this.githubClient.runWithBranchFallback(
        repoConfig.owner,
        repoConfig.repo,
        repoConfig.branch || 'main',
        (branch) => this.getContentItem(repoConfig.owner, repoConfig.repo, normalizedDocPath, branch),
      );
      file = contentResult.data;
      branchUsed = contentResult.branch;
    } catch (error) {
      if (!this.githubClient.isGitHub404(error)) {
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
      content = await this.githubClient.githubTextRequest(file.download_url);
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
    const repoConfig = await this.repositoryModel.findOne({ _id: new Types.ObjectId(id) }).exec();

    if (!repoConfig) {
      throw new NotFoundException('Repository config not found');
    }

    const { data: commits, branch: branchUsed } = await this.githubClient.runWithBranchFallback(
      repoConfig.owner,
      repoConfig.repo,
      repoConfig.branch || 'main',
      (branch) =>
        this.githubClient.githubRequest<GitHubCommitItem[]>(
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

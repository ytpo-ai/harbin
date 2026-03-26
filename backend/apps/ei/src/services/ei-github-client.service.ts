import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class EiGithubClientService {
  private readonly githubApiBase = 'https://api.github.com';

  parseGithubUrl(repositoryUrl: string): { owner: string; repo: string } {
    const normalized = repositoryUrl.trim().replace(/\.git$/i, '');
    const match = normalized.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/i);
    if (!match) {
      throw new BadRequestException('Invalid GitHub repository URL');
    }

    return { owner: match[1], repo: match[2] };
  }

  getGitHubToken(): string {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new BadRequestException('GITHUB_TOKEN is not configured');
    }
    return token;
  }

  async githubRequest<T>(apiPath: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.githubApiBase}${apiPath}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.getGitHubToken()}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.headers || {}),
      },
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new BadRequestException(`GitHub API error (${response.status}): ${bodyText}`);
    }

    return (await response.json()) as T;
  }

  isGitHub404(error: unknown): boolean {
    const message = (error as any)?.message || '';
    return String(message).includes('GitHub API error (404)') || String(message).includes('content: 404');
  }

  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const repoInfo = await this.githubRequest<{ default_branch: string }>(`/repos/${owner}/${repo}`);
    return repoInfo.default_branch || 'main';
  }

  async runWithBranchFallback<T>(
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

  async githubTextRequest(url: string): Promise<string> {
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
}

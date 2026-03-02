import api from './api';

export interface EngineeringRepository {
  _id: string;
  repositoryUrl: string;
  branch: string;
  lastError?: string;
}

export interface EngineeringDocTreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: EngineeringDocTreeNode[];
}

export interface EngineeringDocTreeResult {
  root: string;
  totalFiles: number;
  tree: EngineeringDocTreeNode[];
}

export interface EngineeringDocContentResult {
  document: {
    path: string;
    content: string;
    size: number;
    htmlUrl?: string;
  };
}

export interface EngineeringDocHistoryResult {
  totalCommits: number;
  uniqueContributors: number;
  lastUpdatedAt: string | null;
  commits: Array<{
    sha: string;
    shortSha: string;
    message: string;
    author: string;
    committedAt?: string;
    htmlUrl: string;
  }>;
}

export const engineeringIntelligenceService = {
  async listRepositories(): Promise<EngineeringRepository[]> {
    const response = await api.get('/engineering-intelligence/repositories');
    return response.data;
  },

  async createRepository(payload: { repositoryUrl: string; branch?: string }): Promise<EngineeringRepository> {
    const response = await api.post('/engineering-intelligence/repositories', payload);
    return response.data;
  },

  async deleteRepository(id: string): Promise<{ success: boolean }> {
    const response = await api.delete(`/engineering-intelligence/repositories/${id}`);
    return response.data;
  },

  async getDocsTree(id: string): Promise<EngineeringDocTreeResult> {
    const response = await api.get(`/engineering-intelligence/repositories/${id}/docs/tree`);
    return response.data;
  },

  async getDocContent(id: string, path: string): Promise<EngineeringDocContentResult> {
    const response = await api.get(`/engineering-intelligence/repositories/${id}/docs/content`, {
      params: { path },
    });
    return response.data;
  },

  async getDocHistory(id: string, path: string, limit = 20): Promise<EngineeringDocHistoryResult> {
    const response = await api.get(`/engineering-intelligence/repositories/${id}/docs/history`, {
      params: { path, limit },
    });
    return response.data;
  },
};

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

export interface EngineeringStatisticsProjectRow {
  projectId: string;
  projectName: string;
  source: 'workspace' | 'ei_project';
  metricType: 'docs' | 'frontend' | 'backend';
  rootPath: string;
  fileCount: number;
  bytes: number;
  lines: number;
  tokens?: number;
  tsCount?: number;
  tsxCount?: number;
  testFileCount?: number;
  error?: string;
}

export interface EngineeringStatisticsSummary {
  totalDocsBytes: number;
  totalDocsTokens: number;
  totalFrontendBytes: number;
  totalBackendBytes: number;
  grandTotalBytes: number;
  projectCount: number;
  successCount: number;
  failureCount: number;
}

export interface EngineeringStatisticsSnapshot {
  snapshotId: string;
  status: 'running' | 'success' | 'failed';
  scope: 'all' | 'docs' | 'frontend' | 'backend';
  tokenMode: 'estimate' | 'exact';
  requestedProjectIds: string[];
  triggeredBy?: string;
  startedAt: string;
  completedAt?: string;
  projects: EngineeringStatisticsProjectRow[];
  summary: EngineeringStatisticsSummary;
  errors: string[];
  createdAt?: string;
  updatedAt?: string;
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

  async createStatisticsSnapshot(payload?: {
    scope?: 'all' | 'docs' | 'frontend' | 'backend';
    tokenMode?: 'estimate' | 'exact';
    projectIds?: string[];
    triggeredBy?: string;
    receiverId?: string;
  }): Promise<EngineeringStatisticsSnapshot> {
    const response = await api.post('/engineering-intelligence/statistics/snapshots', payload || {});
    return response.data;
  },

  async getLatestStatisticsSnapshot(): Promise<EngineeringStatisticsSnapshot | null> {
    const response = await api.get('/engineering-intelligence/statistics/snapshots/latest');
    return response.data;
  },

  async getStatisticsSnapshotById(snapshotId: string): Promise<EngineeringStatisticsSnapshot> {
    const response = await api.get(`/engineering-intelligence/statistics/snapshots/${snapshotId}`);
    return response.data;
  },

  async listStatisticsSnapshots(limit = 20): Promise<EngineeringStatisticsSnapshot[]> {
    const response = await api.get('/engineering-intelligence/statistics/snapshots', {
      params: { limit },
    });
    return response.data;
  },
};

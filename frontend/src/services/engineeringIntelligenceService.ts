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

export type RequirementStatus = 'todo' | 'assigned' | 'in_progress' | 'review' | 'done' | 'blocked';
export type RequirementPriority = 'low' | 'medium' | 'high' | 'critical';
export type RequirementActorType = 'human' | 'agent' | 'system';

export interface RequirementComment {
  commentId: string;
  content: string;
  authorId?: string;
  authorName?: string;
  authorType: RequirementActorType;
  createdAt: string;
}

export interface RequirementAssignment {
  assignmentId: string;
  toAgentId: string;
  toAgentName?: string;
  assignedById?: string;
  assignedByName?: string;
  reason?: string;
  assignedAt: string;
}

export interface RequirementStatusEvent {
  eventId: string;
  fromStatus: RequirementStatus;
  toStatus: RequirementStatus;
  changedById?: string;
  changedByName?: string;
  changedByType: RequirementActorType;
  note?: string;
  changedAt: string;
}

export interface RequirementGithubLink {
  owner: string;
  repo: string;
  issueNumber: number;
  issueId: number;
  issueUrl: string;
  issueState: 'open' | 'closed';
  syncedAt: string;
  lastError?: string;
}

export interface RequirementItem {
  requirementId: string;
  title: string;
  description: string;
  status: RequirementStatus;
  priority: RequirementPriority;
  labels: string[];
  currentAssigneeAgentId?: string;
  currentAssigneeAgentName?: string;
  createdById?: string;
  createdByName?: string;
  createdByType: RequirementActorType;
  localProjectId?: string;
  comments: RequirementComment[];
  assignments: RequirementAssignment[];
  statusHistory: RequirementStatusEvent[];
  githubLink?: RequirementGithubLink;
  lastBoardEventAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RequirementBoardResult {
  updatedAt: string;
  total: number;
  columns: Record<RequirementStatus, RequirementItem[]>;
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

  async createRequirement(payload: {
    title: string;
    description?: string;
    priority?: RequirementPriority;
    labels?: string[];
    createdById?: string;
    createdByName?: string;
    createdByType?: RequirementActorType;
    localProjectId?: string;
  }): Promise<RequirementItem> {
    const response = await api.post('/engineering-intelligence/requirements', payload);
    return response.data;
  },

  async listRequirements(params?: {
    status?: RequirementStatus;
    assigneeAgentId?: string;
    search?: string;
    limit?: number;
    localProjectId?: string;
  }): Promise<RequirementItem[]> {
    const response = await api.get('/engineering-intelligence/requirements', { params });
    return response.data;
  },

  async getRequirementById(requirementId: string): Promise<RequirementItem> {
    const response = await api.get(`/engineering-intelligence/requirements/${requirementId}`);
    return response.data;
  },

  async deleteRequirement(requirementId: string): Promise<{ success: boolean; requirementId: string }> {
    const response = await api.delete(`/engineering-intelligence/requirements/${requirementId}`);
    return response.data;
  },

  async addRequirementComment(
    requirementId: string,
    payload: { content: string; authorId?: string; authorName?: string; authorType?: RequirementActorType },
  ): Promise<RequirementItem> {
    const response = await api.post(`/engineering-intelligence/requirements/${requirementId}/comments`, payload);
    return response.data;
  },

  async assignRequirement(
    requirementId: string,
    payload: {
      toAgentId: string;
      toAgentName?: string;
      assignedById?: string;
      assignedByName?: string;
      reason?: string;
    },
  ): Promise<RequirementItem> {
    const response = await api.post(`/engineering-intelligence/requirements/${requirementId}/assign`, payload);
    return response.data;
  },

  async updateRequirementStatus(
    requirementId: string,
    payload: {
      status: RequirementStatus;
      changedById?: string;
      changedByName?: string;
      changedByType?: RequirementActorType;
      note?: string;
    },
  ): Promise<RequirementItem> {
    const response = await api.post(`/engineering-intelligence/requirements/${requirementId}/status`, payload);
    return response.data;
  },

  async getRequirementBoard(): Promise<RequirementBoardResult> {
    const response = await api.get('/engineering-intelligence/requirements/board');
    return response.data;
  },

  async syncRequirementToGithub(
    requirementId: string,
    payload: { owner?: string; repo?: string; labels?: string[]; metadata?: Record<string, unknown> },
  ): Promise<{ success: boolean; requirementId: string; githubLink?: RequirementGithubLink }> {
    const response = await api.post(`/engineering-intelligence/requirements/${requirementId}/github/sync`, payload);
    return response.data;
  },
};

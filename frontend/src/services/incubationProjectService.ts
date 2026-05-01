import api from './api';

// ========== Types ==========

export type IncubationProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface IncubationProject {
  _id: string;
  name: string;
  description: string;
  goal?: string;
  status: IncubationProjectStatus;
  isTemplateInitialized?: boolean;
  createdBy?: string;
  startDate?: string;
  endDate?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIncubationProjectDto {
  name: string;
  description?: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
  metadata?: Record<string, any>;
}

export interface UpdateIncubationProjectDto {
  name?: string;
  description?: string;
  goal?: string;
  status?: IncubationProjectStatus;
  startDate?: string;
  endDate?: string;
  metadata?: Record<string, any>;
}

export interface IncubationProjectStats {
  agents: number;
  plans: { total: number; byStatus: Record<string, number> };
  runs: { total: number; byStatus: Record<string, number> };
  tasks: { total: number; byStatus: Record<string, number> };
  requirements: { total: number; byStatus: Record<string, number> };
  schedules: { total: number; enabled: number };
  meetings: { total: number; byStatus: Record<string, number> };
  discussions: { total: number; byCategory: Record<string, number> };
}

export interface IncubationProjectDiscussionSpace {
  id: string;
  _id?: string;
  title: string;
  category?: 'general' | 'industry_observation' | 'product_discussion' | 'technical_design';
  status: 'active' | 'paused' | 'archived';
  tags?: string[];
  statistics?: {
    totalMessages?: number;
    totalKnowledgeEntries?: number;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface InitializeTemplateResult {
  projectId: string;
  isTemplateInitialized: boolean;
  localProjectId: string;
  localPath: string;
  copiedFiles: number;
  skippedExistingFiles: number;
  createdDirectories: number;
}

// ========== Service ==========

export const incubationProjectService = {
  toList(payload: any): IncubationProject[] {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (Array.isArray(payload?.list)) {
      return payload.list;
    }

    if (Array.isArray(payload?.data)) {
      return payload.data;
    }

    if (Array.isArray(payload?.items)) {
      return payload.items;
    }

    return [];
  },

  // CRUD

  async list(params?: { status?: IncubationProjectStatus }): Promise<IncubationProject[]> {
    const response = await api.get('/ei/incubation-projects', { params });
    return this.toList(response.data);
  },

  async getById(id: string): Promise<IncubationProject> {
    const response = await api.get(`/ei/incubation-projects/${id}`);
    return response.data;
  },

  async create(data: CreateIncubationProjectDto): Promise<IncubationProject> {
    const response = await api.post('/ei/incubation-projects', data);
    return response.data;
  },

  async update(id: string, data: UpdateIncubationProjectDto): Promise<IncubationProject> {
    const response = await api.put(`/ei/incubation-projects/${id}`, data);
    return response.data;
  },

  async delete(id: string): Promise<{ success: boolean }> {
    const response = await api.delete(`/ei/incubation-projects/${id}`);
    return response.data;
  },

  async initializeTemplate(id: string): Promise<InitializeTemplateResult> {
    const response = await api.post(`/ei/incubation-projects/${id}/initialize-template`);
    return response.data;
  },

  // Aggregation queries

  async getProjectAgents(id: string): Promise<any[]> {
    const response = await api.get(`/ei/incubation-projects/${id}/agents`);
    return response.data;
  },

  async getProjectPlans(id: string): Promise<any[]> {
    const response = await api.get(`/ei/incubation-projects/${id}/plans`);
    return response.data;
  },

  async getProjectRequirements(id: string): Promise<any[]> {
    const response = await api.get(`/ei/incubation-projects/${id}/requirements`);
    return response.data;
  },

  async getProjectSchedules(id: string): Promise<any[]> {
    const response = await api.get(`/ei/incubation-projects/${id}/schedules`);
    return response.data;
  },

  async getProjectMeetings(id: string): Promise<any[]> {
    const response = await api.get(`/ei/incubation-projects/${id}/meetings`);
    return response.data;
  },

  async getProjectDiscussions(id: string): Promise<IncubationProjectDiscussionSpace[]> {
    const response = await api.get(`/ei/incubation-projects/${id}/discussions`);
    const payload = response.data;
    const normalize = (item: any): IncubationProjectDiscussionSpace => ({
      ...item,
      id: item?.id || item?._id || '',
    });
    if (Array.isArray(payload)) {
      return payload.map(normalize);
    }
    if (Array.isArray(payload?.data)) {
      return payload.data.map(normalize);
    }
    if (Array.isArray(payload?.items)) {
      return payload.items.map(normalize);
    }
    return [];
  },

  async getProjectStats(id: string): Promise<IncubationProjectStats> {
    const response = await api.get(`/ei/incubation-projects/${id}/stats`);
    return response.data;
  },
};

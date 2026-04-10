import api from './api';
import { SkillGithubRepo, SkillMarketPlatform } from '../types';

export interface SkillMarketRepoPagedResponse {
  items: SkillGithubRepo[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SkillMarketSearchResponse extends SkillMarketRepoPagedResponse {
  remoteFetched: number;
}

export const skillMarketService = {
  async listPlatforms(): Promise<SkillMarketPlatform[]> {
    const response = await api.get('/skills/market/platforms');
    return response.data;
  },

  async createPlatform(payload: {
    name: string;
    url: string;
    priority?: number;
    status?: 'active' | 'disabled';
    description?: string;
  }): Promise<SkillMarketPlatform> {
    const response = await api.post('/skills/market/platforms', payload);
    return response.data;
  },

  async updatePlatform(
    platformId: string,
    payload: {
      name?: string;
      priority?: number;
      status?: 'active' | 'disabled';
      description?: string;
    },
  ): Promise<SkillMarketPlatform> {
    const response = await api.put(`/skills/market/platforms/${platformId}`, payload);
    return response.data;
  },

  async deletePlatform(platformId: string): Promise<{ deleted: boolean; deletedRepos: number }> {
    const response = await api.delete(`/skills/market/platforms/${platformId}`);
    return response.data;
  },

  async indexPlatform(platformId: string): Promise<{
    scanned: number;
    indexed: number;
    failed: number;
  }> {
    const response = await api.post(`/skills/market/platforms/${platformId}/index`);
    return response.data;
  },

  async listRepos(filters?: {
    platformId?: string;
    status?: 'pending' | 'imported' | 'skipped';
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<SkillMarketRepoPagedResponse> {
    const response = await api.get('/skills/market/repos', { params: filters });
    return response.data;
  },

  async skipRepo(repoId: string): Promise<SkillGithubRepo> {
    const response = await api.put(`/skills/market/repos/${repoId}/skip`);
    return response.data;
  },

  async importRepo(repoId: string): Promise<{
    repo: SkillGithubRepo;
    skill: { id: string; name: string };
    created: boolean;
  }> {
    const response = await api.post(`/skills/market/repos/${repoId}/import`);
    return response.data;
  },

  async searchMarket(payload: {
    keyword: string;
    platformId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<SkillMarketSearchResponse> {
    const response = await api.post('/skills/market/search', payload);
    return response.data;
  },
};

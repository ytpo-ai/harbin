import api from './api';
import { SkillMarketPlatform } from '../types';

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

  async deletePlatform(platformId: string): Promise<{ deleted: boolean }> {
    const response = await api.delete(`/skills/market/platforms/${platformId}`);
    return response.data;
  },
};

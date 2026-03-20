import api from './api';
import { Skill } from '../types';

export interface SkillPagedResponse {
  items: Skill[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const skillService = {
  async getSkills(filters?: { status?: string; category?: string; search?: string }): Promise<Skill[]> {
    const response = await api.get('/skills', { params: filters });
    return response.data;
  },

  async getSkillsPaged(filters?: {
    status?: string;
    category?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<SkillPagedResponse> {
    const response = await api.get('/skills', { params: filters });
    return response.data;
  },

  async createSkill(payload: Partial<Skill> & { name: string; description: string }): Promise<Skill> {
    const response = await api.post('/skills', payload);
    return response.data;
  },

  async updateSkill(skillId: string, payload: Partial<Skill>): Promise<Skill> {
    const response = await api.put(`/skills/${skillId}`, payload);
    return response.data;
  },

  async getSkillById(skillId: string, options?: { includeContent?: boolean; includeMetadata?: boolean }): Promise<Skill> {
    const response = await api.get(`/skills/${skillId}`, {
      params: {
        includeContent: options?.includeContent ? 'true' : undefined,
        includeMetadata: options?.includeMetadata ? 'true' : undefined,
      },
    });
    return response.data;
  },

  async deleteSkill(skillId: string): Promise<boolean> {
    await api.delete(`/skills/${skillId}`);
    return true;
  },

  async assignSkillToAgent(payload: {
    agentId: string;
    skillId: string;
    enabled?: boolean;
  }): Promise<{ agentId: string; skillId: string; enabled: boolean; skills: string[] }> {
    const response = await api.post('/skills/assign', payload);
    return response.data;
  },

  async getAgentSkills(agentId: string): Promise<Array<{ skillId: string; skill: Skill | null }>> {
    const response = await api.get(`/skills/agents/${agentId}`);
    return response.data;
  },

  async getSkillAgents(skillId: string): Promise<Array<{ id: string; name: string }>> {
    const response = await api.get(`/skills/skills/${skillId}/agents`);
    return response.data;
  },

  async getAllSkillAgents(): Promise<Record<string, Array<{ agentId: string; agentName: string }>>> {
    const response = await api.get('/skills/all-skill-agents');
    return response.data;
  },

  async discoverSkills(payload: {
    query: string;
    maxResults?: number;
    sourceType?: 'manual' | 'github' | 'web' | 'internal';
    dryRun?: boolean;
  }): Promise<{ query: string; totalFound: number; added: number; updated: number; skills: Skill[] }> {
    const response = await api.post('/skills/manager/discover', payload);
    return response.data;
  },

  async syncDocs(): Promise<{ scanned: number; inserted: number; updated: number; skipped: number; failed: number }> {
    const response = await api.post('/skills/docs/sync');
    return response.data;
  },
};

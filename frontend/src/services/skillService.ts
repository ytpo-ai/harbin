import api from './api';
import { AgentSkill, Skill, SkillSuggestion } from '../types';

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

  async deleteSkill(skillId: string): Promise<boolean> {
    await api.delete(`/skills/${skillId}`);
    return true;
  },

  async assignSkillToAgent(payload: {
    agentId: string;
    skillId: string;
    proficiencyLevel?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
    assignedBy?: string;
    enabled?: boolean;
    note?: string;
  }): Promise<AgentSkill> {
    const response = await api.post('/skills/assign', payload);
    return response.data;
  },

  async getAgentSkills(agentId: string): Promise<Array<{ assignment: AgentSkill; skill: Skill | null }>> {
    const response = await api.get(`/skills/agents/${agentId}`);
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

  async suggestSkillsForAgent(payload: {
    agentId: string;
    contextTags?: string[];
    topK?: number;
    persist?: boolean;
  }): Promise<Array<{ skill: Skill; score: number; reason: string; priority: 'low' | 'medium' | 'high' | 'critical' }>> {
    const response = await api.post(`/skills/manager/suggest/${payload.agentId}`, {
      contextTags: payload.contextTags || [],
      topK: payload.topK,
      persist: payload.persist,
    });
    return response.data;
  },

  async getSuggestionsForAgent(agentId: string, status?: SkillSuggestion['status']): Promise<SkillSuggestion[]> {
    const response = await api.get(`/skills/suggestions/agents/${agentId}`, { params: { status } });
    return response.data;
  },

  async reviewSuggestion(suggestionId: string, payload: { status: SkillSuggestion['status']; note?: string }): Promise<SkillSuggestion> {
    const response = await api.put(`/skills/suggestions/${suggestionId}`, payload);
    return response.data;
  },

  async rebuildDocs(): Promise<{ skills: number; suggestions: number }> {
    const response = await api.post('/skills/docs/rebuild');
    return response.data;
  },
};

import api from './api';

export interface HRAgentRole {
  id: string;
  code: string;
  name: string;
  tier: 'leadership' | 'operations' | 'temporary';
  description?: string;
  capabilities: string[];
  tools: string[];
  promptTemplate?: string;
  status: 'active' | 'inactive';
  createdAt?: string;
  updatedAt?: string;
}

export const hrService = {
  // 生成绩效报告
  async generatePerformanceReport(agentId: string): Promise<any> {
    const response = await api.get(`/hr/performance/${agentId}`);
    return response.data;
  },

  // 识别低绩效员工
  async identifyLowPerformers(): Promise<any[]> {
    const response = await api.get('/hr/low-performers');
    return response.data;
  },

  // 获取招聘建议
  async recommendHiring(): Promise<any[]> {
    const response = await api.get('/hr/hiring-recommendations');
    return response.data;
  },

  // 计算团队健康度
  async calculateTeamHealth(): Promise<any> {
    const response = await api.get('/hr/team-health');
    return response.data;
  },

  // 批量评估
  async batchEvaluation(agentIds: string[]): Promise<any> {
    const response = await api.post('/hr/batch-evaluation', { agentIds });
    return response.data;
  },

  async getRoles(status?: 'active' | 'inactive'): Promise<HRAgentRole[]> {
    const query = status ? `?status=${status}` : '';
    const response = await api.get(`/agents/roles${query}`);
    return response.data;
  },

  async createRole(payload: {
    code: string;
    name: string;
    description?: string;
    capabilities?: string[];
    tools?: string[];
    promptTemplate?: string;
    status?: 'active' | 'inactive';
    tier?: 'leadership' | 'operations' | 'temporary';
  }): Promise<HRAgentRole> {
    const response = await api.post('/agents/roles', payload);
    return response.data;
  },

  async updateRole(
    roleId: string,
    payload: {
      code?: string;
      name?: string;
      description?: string;
      capabilities?: string[];
      tools?: string[];
      promptTemplate?: string;
      status?: 'active' | 'inactive';
      tier?: 'leadership' | 'operations' | 'temporary';
    },
  ): Promise<HRAgentRole> {
    const response = await api.put(`/agents/roles/${encodeURIComponent(roleId)}`, payload);
    return response.data;
  },

  async deleteRole(roleId: string): Promise<{ deleted: boolean }> {
    const response = await api.delete(`/agents/roles/${encodeURIComponent(roleId)}`);
    return response.data;
  },

};

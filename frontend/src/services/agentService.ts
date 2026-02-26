import api from './api';
import { Agent, AIModel } from '../types';

export interface AgentTestResult {
  success: boolean;
  agent?: string;
  model?: string;
  response?: string;
  responseLength?: number;
  duration?: string;
  error?: string;
  note?: string;
  keySource?: 'custom' | 'system';
  timestamp: string;
}

export const agentService = {
  // 获取所有agent
  async getAgents(): Promise<Agent[]> {
    const response = await api.get('/agents');
    return response.data;
  },

  // 获取单个agent
  async getAgent(id: string): Promise<Agent> {
    const response = await api.get(`/agents/${id}`);
    return response.data;
  },

  // 创建agent
  async createAgent(agentData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>): Promise<Agent> {
    const response = await api.post('/agents', agentData);
    return response.data;
  },

  // 更新agent
  async updateAgent(id: string, updates: Partial<Agent>): Promise<Agent> {
    const response = await api.put(`/agents/${id}`, updates);
    return response.data;
  },

  // 删除agent
  async deleteAgent(id: string): Promise<boolean> {
    await api.delete(`/agents/${id}`);
    return true;
  },

  // 获取agent能力
  async getAgentCapabilities(id: string): Promise<string[]> {
    const response = await api.get(`/agents/${id}/capabilities`);
    return response.data;
  },

  // 检查agent是否可用
  async isAgentAvailable(id: string): Promise<boolean> {
    const response = await api.get(`/agents/${id}/available`);
    return response.data;
  },

  // 执行任务
  async executeTask(id: string, task: any, context?: any): Promise<{ response: string }> {
    const response = await api.post(`/agents/${id}/execute`, { task, context });
    return response.data;
  },

  // 测试Agent模型连接
  async testAgent(id: string, payload?: { model?: AIModel; apiKeyId?: string }): Promise<AgentTestResult> {
    const response = await api.post(`/agents/${id}/test`, payload || {});
    return response.data;
  }
};

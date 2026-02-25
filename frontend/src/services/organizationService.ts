import api from './api';
import { Organization, AgentEmployee } from '../types';

export const organizationService = {
  // 初始化组织
  async initializeOrganization(): Promise<Organization> {
    const response = await api.post('/organization/initialize');
    return response.data;
  },

  // 获取组织信息
  async getOrganization(): Promise<Organization | null> {
    const response = await api.get('/organization');
    return response.data;
  },

  // 更新组织信息
  async updateOrganization(id: string, updates: Partial<Organization>): Promise<Organization> {
    const response = await api.put(`/organization/${id}`, updates);
    return response.data;
  },

  // 雇佣Agent
  async hireAgent(agentId: string, roleId: string, proposerId: string): Promise<any> {
    const response = await api.post('/organization/hire', {
      agentId,
      roleId,
      proposerId
    });
    return response.data;
  },

  // 解雇Agent
  async fireAgent(agentId: string, reason: string): Promise<any> {
    const response = await api.post('/organization/fire', {
      agentId,
      reason
    });
    return response.data;
  },

  // 评估Agent绩效
  async evaluateAgent(agentId: string, evaluation: any): Promise<any> {
    const response = await api.post('/organization/evaluate', {
      agentId,
      evaluation
    });
    return response.data;
  },

  // 获取组织统计
  async getOrganizationStats(): Promise<any> {
    const response = await api.get('/organization/stats');
    return response.data;
  }
};
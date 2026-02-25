import api from './api';
import { Tool, ToolExecution } from '../types';

export const toolService = {
  // 获取所有工具
  async getTools(): Promise<Tool[]> {
    const response = await api.get('/tools');
    return response.data;
  },

  // 获取单个工具
  async getTool(id: string): Promise<Tool> {
    const response = await api.get(`/tools/${id}`);
    return response.data;
  },

  // 创建工具
  async createTool(toolData: Omit<Tool, 'id' | 'createdAt' | 'updatedAt'>): Promise<Tool> {
    const response = await api.post('/tools', toolData);
    return response.data;
  },

  // 更新工具
  async updateTool(id: string, updates: Partial<Tool>): Promise<Tool> {
    const response = await api.put(`/tools/${id}`, updates);
    return response.data;
  },

  // 删除工具
  async deleteTool(id: string): Promise<boolean> {
    await api.delete(`/tools/${id}`);
    return true;
  },

  // 执行工具
  async executeTool(toolId: string, agentId: string, parameters: any, taskId?: string): Promise<ToolExecution> {
    const response = await api.post(`/tools/${toolId}/execute`, {
      agentId,
      parameters,
      taskId
    });
    return response.data;
  },

  // 获取工具执行历史
  async getToolExecutions(agentId?: string, toolId?: string): Promise<ToolExecution[]> {
    const params = new URLSearchParams();
    if (agentId) params.append('agentId', agentId);
    if (toolId) params.append('toolId', toolId);
    
    const response = await api.get(`/tools/executions/history?${params}`);
    return response.data;
  },

  // 获取工具执行统计
  async getToolExecutionStats(): Promise<any> {
    const response = await api.get('/tools/executions/stats');
    return response.data;
  }
};
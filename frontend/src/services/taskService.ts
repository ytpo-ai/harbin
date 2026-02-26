import api from './api';
import { Task, Agent, TeamSettings } from '../types';

export const taskService = {
  // 获取所有任务
  async getTasks(): Promise<Task[]> {
    const response = await api.get('/tasks');
    return response.data;
  },

  // 获取单个任务
  async getTask(id: string): Promise<Task> {
    const response = await api.get(`/tasks/${id}`);
    return response.data;
  },

  // 创建任务
  async createTask(taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
    const response = await api.post('/tasks', taskData);
    return response.data;
  },

  // 更新任务
  async updateTask(id: string, updates: Partial<Task>): Promise<Task> {
    const response = await api.put(`/tasks/${id}`, updates);
    return response.data;
  },

  // 删除任务
  async deleteTask(id: string): Promise<boolean> {
    await api.delete(`/tasks/${id}`);
    return true;
  },

  // 执行协作任务
  async executeWithCollaboration(payload: {
    taskId: string;
    agents: Agent[];
    teamSettings: TeamSettings;
  }): Promise<any> {
    const response = await api.post(`/tasks/${payload.taskId}/execute`, {
      agents: payload.agents,
      teamSettings: payload.teamSettings,
    });
    return response.data;
  }
};

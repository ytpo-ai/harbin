import api from './api';
import { AIModel } from '../types';

export const modelService = {
  // 获取可用模型
  async getAvailableModels(): Promise<AIModel[]> {
    const response = await api.get('/models');
    return response.data;
  },

  // 聊天
  async chat(modelId: string, messages: any[], options?: any): Promise<{ response: string }> {
    const response = await api.post(`/models/${modelId}/chat`, { messages, options });
    return response.data;
  },

  // 注册模型
  async registerModel(modelId: string, model: AIModel): Promise<any> {
    const response = await api.post(`/models/${modelId}/register`, model);
    return response.data;
  }
};
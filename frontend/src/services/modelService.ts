import api from './api';
import { AIModel } from '../types';

export const modelService = {
  // 获取所有可用模型
  async getAvailableModels(): Promise<AIModel[]> {
    const response = await api.get('/model-management/available');
    return response.data;
  },

  // 获取模型分类
  async getModelCategories(): Promise<Record<string, { name: string; color: string }>> {
    const response = await api.get('/model-management/categories');
    return response.data;
  },

  // 获取推荐模型
  async getRecommendedModels(): Promise<AIModel[]> {
    const response = await api.get('/model-management/recommended');
    return response.data;
  },

  // 按提供商获取模型
  async getModelsByProvider(provider: string): Promise<AIModel[]> {
    const response = await api.get(`/model-management/by-provider/${provider}`);
    return response.data;
  },

  // 创建新模型
  async createModel(modelData: Omit<AIModel, 'id'>): Promise<AIModel> {
    const response = await api.post('/model-management/models', modelData);
    return response.data;
  },

  // 更新模型
  async updateModel(modelId: string, updates: Partial<AIModel>): Promise<AIModel> {
    const response = await api.put(`/model-management/models/${modelId}`, updates);
    return response.data;
  },

  // 删除模型
  async deleteModel(modelId: string): Promise<boolean> {
    await api.delete(`/model-management/models/${modelId}`);
    return true;
  },

  // 获取模型设置
  async getModelSettings(): Promise<any> {
    const response = await api.get('/model-management/settings');
    return response.data;
  },

  // 更新模型设置
  async updateModelSettings(settings: any): Promise<any> {
    const response = await api.put('/model-management/settings', settings);
    return response.data;
  },

  // 为创始人选择模型
  async selectModelForFounder(founderType: 'ceo' | 'cto', modelId: string): Promise<any> {
    const response = await api.post(`/model-management/select-for-founder/${founderType}`, { modelId });
    return response.data;
  },

  // 获取创始人模型
  async getFounderModels(): Promise<{ ceo: AIModel | null; cto: AIModel | null }> {
    const response = await api.get('/model-management/founder-models');
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
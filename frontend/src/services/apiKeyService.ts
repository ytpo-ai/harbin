import api from '../lib/axios';

export interface ApiKey {
  _id: string;
  id: string;
  name: string;
  provider: string;
  keyMasked: string; // 脱敏显示的加密key
  description?: string;
  isActive: boolean;
  useCount: number;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ApiKeyStats {
  total: number;
  active: number;
  inactive: number;
  byProvider: Array<{
    _id: string;
    count: number;
    activeCount: number;
  }>;
}

export interface CreateApiKeyDto {
  name: string;
  provider: string;
  key: string; // 明文key，会被后端自动加密
  description?: string;
  isActive?: boolean;
  expiresAt?: string;
}

export interface UpdateApiKeyDto {
  name?: string;
  provider?: string;
  key?: string; // 明文key，如果提供会重新加密
  description?: string;
  isActive?: boolean;
  expiresAt?: string;
}

class ApiKeyService {
  async getAllApiKeys(): Promise<ApiKey[]> {
    const response = await api.get('/api-keys');
    return response.data;
  }

  async getApiKeyStats(): Promise<ApiKeyStats> {
    const response = await api.get('/api-keys/stats');
    return response.data;
  }

  async getApiKeyById(id: string): Promise<ApiKey> {
    const response = await api.get(`/api-keys/${id}`);
    return response.data;
  }

  async getApiKeysByProvider(provider: string): Promise<ApiKey[]> {
    const response = await api.get(`/api-keys/by-provider/${provider}`);
    return response.data;
  }

  async createApiKey(data: CreateApiKeyDto): Promise<ApiKey> {
    const response = await api.post('/api-keys', data);
    return response.data;
  }

  async updateApiKey(id: string, data: UpdateApiKeyDto): Promise<ApiKey> {
    const response = await api.put(`/api-keys/${id}`, data);
    return response.data;
  }

  async deleteApiKey(id: string): Promise<void> {
    await api.delete(`/api-keys/${id}`);
  }
}

export const apiKeyService = new ApiKeyService();
export default apiKeyService;

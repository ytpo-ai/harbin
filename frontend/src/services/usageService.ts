import api from './api';

export interface UsageOverview {
  totalCost: number;
  totalTokens: number;
  requestCount: number;
  activeModels: number;
  previousPeriod: {
    totalCost: number;
    totalTokens: number;
    requestCount: number;
    activeModels: number;
  };
  period: 'week' | 'month';
  from: string;
  to: string;
}

export interface UsageDailyTrendItem {
  date: string;
  cost: number;
  tokens: number;
  requests: number;
}

export interface UsageByAgentItem {
  agentId: string;
  agentName: string;
  cost: number;
  tokens: number;
  requests: number;
}

export interface UsageByModelItem {
  modelId: string;
  modelName: string;
  provider: string;
  cost: number;
  tokens: number;
  requests: number;
}

export interface PricingStatus {
  lastRefresh?: string;
  modelCount: number;
  overrideCount: number;
  source: string;
}

export interface PricingRefreshResult {
  success: boolean;
  modelCount: number;
  refreshedAt: string;
}

export const usageService = {
  async getOverview(period: 'week' | 'month'): Promise<UsageOverview> {
    const response = await api.get('/usage/overview', { params: { period } });
    return response.data;
  },

  async getDailyTrend(from?: string, to?: string): Promise<UsageDailyTrendItem[]> {
    const response = await api.get('/usage/daily-trend', { params: { from, to } });
    return response.data;
  },

  async getByAgent(from?: string, to?: string, limit = 10): Promise<UsageByAgentItem[]> {
    const response = await api.get('/usage/by-agent', { params: { from, to, limit } });
    return response.data;
  },

  async getByModel(from?: string, to?: string, limit = 10): Promise<UsageByModelItem[]> {
    const response = await api.get('/usage/by-model', { params: { from, to, limit } });
    return response.data;
  },

  async getPricingStatus(): Promise<PricingStatus> {
    const response = await api.get('/usage/pricing/status');
    return response.data;
  },

  async refreshPricing(): Promise<PricingRefreshResult> {
    const response = await api.post('/usage/pricing/refresh');
    return response.data;
  },
};

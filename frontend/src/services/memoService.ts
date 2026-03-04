import api from './api';
import { AgentMemo } from '../types';

export interface MemoPagedResponse {
  items: AgentMemo[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const memoService = {
  async getMemos(filters?: {
    agentId?: string;
    category?: string;
    memoKind?: AgentMemo['memoKind'];
    topic?: string;
    memoType?: AgentMemo['memoType'];
    todoStatus?: AgentMemo['todoStatus'];
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<MemoPagedResponse> {
    const response = await api.get('/memos', { params: filters });
    return response.data;
  },

  async createMemo(payload: Partial<AgentMemo> & { agentId: string; title: string; content: string }): Promise<AgentMemo> {
    const response = await api.post('/memos', payload);
    return response.data;
  },

  async updateMemo(memoId: string, payload: Partial<AgentMemo>): Promise<AgentMemo> {
    const response = await api.put(`/memos/${memoId}`, payload);
    return response.data;
  },

  async deleteMemo(memoId: string): Promise<boolean> {
    await api.delete(`/memos/${memoId}`);
    return true;
  },

  async getAggregationStatus(agentId?: string): Promise<{
    redisReady: boolean;
    queueKeys: number;
    queuedEvents: number;
    latestMemoUpdatedAt?: string;
    memoDocuments: number;
    agentId?: string;
  }> {
    const response = await api.get('/memos/aggregation/status', { params: { agentId } });
    return response.data;
  },

  async flushEvents(agentId?: string): Promise<{ agents: number; events: number; topics: number }> {
    const response = await api.post('/memos/events/flush', { agentId });
    return response.data;
  },

  async rebuildDocs(): Promise<{ memos: number }> {
    const response = await api.post('/memos/docs/rebuild');
    return response.data;
  },

  async aggregateIdentity(agentId: string): Promise<{ success: boolean; agentId: string; type: string }> {
    const response = await api.post('/memos/identity/aggregate', { agentId });
    return response.data;
  },

  async aggregateEvaluation(agentId: string): Promise<{ success: boolean; agentId: string; type: string }> {
    const response = await api.post('/memos/evaluation/aggregate', { agentId });
    return response.data;
  },
};

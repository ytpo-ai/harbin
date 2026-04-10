import api from './api';
import { SkillGithubRepo, SkillMarketPlatform } from '../types';

export interface SkillMarketRepoPagedResponse {
  items: SkillGithubRepo[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SkillMarketSearchResponse extends SkillMarketRepoPagedResponse {
  remoteFetched: number;
}

export interface IndexTaskState {
  taskId: string;
  platformId: string;
  platformName: string;
  status: 'running' | 'done' | 'error';
  total: number;
  scanned: number;
  indexed: number;
  failed: number;
  currentRepo?: string;
  crawlError?: string;
  message?: string;
  startedAt: string;
  finishedAt?: string;
}

export const skillMarketService = {
  async listPlatforms(): Promise<SkillMarketPlatform[]> {
    const response = await api.get('/skills/market/platforms');
    return response.data;
  },

  async createPlatform(payload: {
    name: string;
    url: string;
    priority?: number;
    status?: 'active' | 'disabled';
    description?: string;
  }): Promise<SkillMarketPlatform> {
    const response = await api.post('/skills/market/platforms', payload);
    return response.data;
  },

  async updatePlatform(
    platformId: string,
    payload: {
      name?: string;
      priority?: number;
      status?: 'active' | 'disabled';
      description?: string;
    },
  ): Promise<SkillMarketPlatform> {
    const response = await api.put(`/skills/market/platforms/${platformId}`, payload);
    return response.data;
  },

  async deletePlatform(platformId: string): Promise<{ deleted: boolean; deletedRepos: number }> {
    const response = await api.delete(`/skills/market/platforms/${platformId}`);
    return response.data;
  },

  async startIndexPlatform(platformId: string): Promise<{ taskId: string }> {
    const response = await api.post(`/skills/market/platforms/${platformId}/index`);
    return response.data;
  },

  subscribeIndexTask(
    taskId: string,
    callbacks: {
      onProgress: (state: IndexTaskState) => void;
      onDone: (state: IndexTaskState) => void;
      onError: (error: string) => void;
    },
  ): () => void {
    const baseUrl = api.defaults.baseURL || '';
    const url = `${baseUrl}/skills/market/index-tasks/${taskId}/events`;
    const eventSource = new EventSource(url);

    const handleEvent = (event: MessageEvent) => {
      try {
        const state: IndexTaskState = JSON.parse(event.data);
        callbacks.onProgress(state);
      } catch {
        // ignore parse errors
      }
    };

    eventSource.addEventListener('progress', handleEvent);

    eventSource.addEventListener('done', (event: MessageEvent) => {
      try {
        const state: IndexTaskState = JSON.parse(event.data);
        callbacks.onDone(state);
      } catch {
        callbacks.onDone({ taskId, status: 'done', message: '索引完成' } as IndexTaskState);
      }
      eventSource.close();
    });

    eventSource.addEventListener('error', (event: Event) => {
      const messageEvent = event as MessageEvent;
      if (messageEvent.data) {
        try {
          const state: IndexTaskState = JSON.parse(messageEvent.data);
          callbacks.onError(state.message || '索引失败');
        } catch {
          callbacks.onError('索引任务异常');
        }
      } else {
        // SSE connection error — check if task is terminal
        if (eventSource.readyState === EventSource.CLOSED) {
          callbacks.onError('SSE 连接已关闭');
        }
      }
      eventSource.close();
    });

    eventSource.addEventListener('heartbeat', () => {
      // keep alive, no action needed
    });

    return () => {
      eventSource.close();
    };
  },

  async listRepos(filters?: {
    platformId?: string;
    status?: 'pending' | 'imported' | 'skipped';
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<SkillMarketRepoPagedResponse> {
    const response = await api.get('/skills/market/repos', { params: filters });
    return response.data;
  },

  async skipRepo(repoId: string): Promise<SkillGithubRepo> {
    const response = await api.put(`/skills/market/repos/${repoId}/skip`);
    return response.data;
  },

  async importRepo(repoId: string): Promise<{
    repo: SkillGithubRepo;
    skill: { id: string; name: string };
    created: boolean;
  }> {
    const response = await api.post(`/skills/market/repos/${repoId}/import`);
    return response.data;
  },

  async searchMarket(payload: {
    keyword: string;
    platformId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<SkillMarketSearchResponse> {
    const response = await api.post('/skills/market/search', payload);
    return response.data;
  },
};

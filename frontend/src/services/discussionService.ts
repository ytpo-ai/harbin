import api from '../lib/axios';
import { Discussion, DiscussionMessage } from '../types';

type DiscussionResponse<T> = T | { data: T };

const unwrap = <T>(payload: DiscussionResponse<T>): T => {
  if (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)) {
    return (payload as { data: T }).data;
  }
  return payload as T;
};

export const discussionService = {
  async getAllDiscussions(): Promise<Discussion[]> {
    const response = await api.get('/discussions');
    return unwrap<Discussion[]>(response.data);
  },

  async getDiscussion(id: string): Promise<Discussion> {
    const response = await api.get(`/discussions/${id}`);
    return unwrap<Discussion>(response.data);
  },

  async createDiscussion(payload: {
    taskId: string;
    participantIds: string[];
    initialPrompt?: string;
  }): Promise<Discussion> {
    const response = await api.post('/discussions', payload);
    return unwrap<Discussion>(response.data);
  },

  async sendMessage(id: string, payload: {
    agentId: string;
    content: string;
    type?: DiscussionMessage['type'];
  }): Promise<DiscussionMessage> {
    const response = await api.post(`/discussions/${id}/messages`, payload);
    return unwrap<DiscussionMessage>(response.data);
  },

  async pauseDiscussion(id: string): Promise<void> {
    await api.post(`/discussions/${id}/pause`);
  },

  async resumeDiscussion(id: string): Promise<void> {
    await api.post(`/discussions/${id}/resume`);
  },

  async concludeDiscussion(id: string, summary?: string): Promise<void> {
    await api.post(`/discussions/${id}/conclude`, { summary });
  },
};

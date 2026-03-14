import api from './api';

export const MESSAGE_CENTER_UPDATED_EVENT = 'message-center:updated';

export interface MessageCenterUpdatedDetail {
  unreadCount?: number;
}

export type MessageType = 'engineering_statistics' | 'orchestration' | 'system_alert';

export interface MessageCenterItem {
  messageId: string;
  receiverId: string;
  type: MessageType;
  title: string;
  content: string;
  payload?: Record<string, any>;
  isRead: boolean;
  readAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageCenterListResponse {
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  items: MessageCenterItem[];
  fetchedAt: string;
}

class MessageCenterService {
  private emitUpdated(detail?: MessageCenterUpdatedDetail) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<MessageCenterUpdatedDetail>(MESSAGE_CENTER_UPDATED_EVENT, { detail }));
    }
  }

  private async emitUpdatedWithUnreadCount() {
    try {
      const unreadCount = await this.getUnreadCount();
      this.emitUpdated({ unreadCount });
    } catch {
      this.emitUpdated();
    }
  }

  async listMessages(params?: {
    page?: number;
    pageSize?: number;
    isRead?: boolean;
    type?: MessageType;
  }): Promise<MessageCenterListResponse> {
    const response = await api.get('/message-center/messages', { params: params || {} });
    return response.data.data;
  }

  async getUnreadCount(): Promise<number> {
    const response = await api.get('/message-center/unread-count');
    return Number(response.data?.data?.unreadCount || 0);
  }

  async markAsRead(messageId: string): Promise<void> {
    await api.patch(`/message-center/messages/${encodeURIComponent(messageId)}/read`);
    await this.emitUpdatedWithUnreadCount();
  }

  async markAllAsRead(): Promise<number> {
    const response = await api.patch('/message-center/messages/read-all');
    await this.emitUpdatedWithUnreadCount();
    return Number(response.data?.data?.updatedCount || 0);
  }
}

export const messageCenterService = new MessageCenterService();

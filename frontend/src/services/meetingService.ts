import api from '../lib/axios';

export enum MeetingType {
  WEEKLY = 'weekly',
  BOARD = 'board',
  DAILY = 'daily',
  DEPARTMENT = 'department',
  AD_HOC = 'ad_hoc',
  PROJECT = 'project',
  EMERGENCY = 'emergency',
}

export enum MeetingStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  PAUSED = 'paused',
  ENDED = 'ended',
}

export enum ParticipantRole {
  HOST = 'host',
  PARTICIPANT = 'participant',
  OBSERVER = 'observer',
}

export interface MeetingParticipant {
  agentId: string;
  role: ParticipantRole;
  isPresent: boolean;
  hasSpoken: boolean;
  messageCount: number;
  joinedAt?: string;
  leftAt?: string;
}

export interface MeetingMessage {
  id: string;
  agentId: string;
  content: string;
  type: 'opinion' | 'question' | 'agreement' | 'disagreement' | 'suggestion' | 'conclusion' | 'introduction' | 'action_item';
  timestamp: string;
  metadata?: {
    mentionedAgents?: string[];
    relatedMessageId?: string;
    sentiment?: 'positive' | 'neutral' | 'negative';
    confidence?: number;
  };
}

export interface Meeting {
  _id: string;
  id: string;
  title: string;
  description?: string;
  type: MeetingType;
  status: MeetingStatus;
  hostId: string;
  participants: MeetingParticipant[];
  messages: MeetingMessage[];
  agenda?: string;
  scheduledStartTime?: string;
  startedAt?: string;
  endedAt?: string;
  invitedAgentIds: string[];
  settings?: {
    maxParticipants?: number;
    allowAutoStart?: boolean;
    aiModeration?: boolean;
    recordTranscript?: boolean;
    autoEndOnSilence?: number;
    speakingOrder?: 'free' | 'sequential' | 'round_robin';
  };
  summary?: {
    content: string;
    actionItems: string[];
    decisions: string[];
    generatedAt: string;
  };
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMeetingDto {
  title: string;
  description?: string;
  type: MeetingType;
  hostId: string;
  participantIds?: string[];
  agenda?: string;
  scheduledStartTime?: string;
  settings?: Meeting['settings'];
}

export interface MeetingMessageDto {
  agentId: string;
  content: string;
  type?: MeetingMessage['type'];
  metadata?: MeetingMessage['metadata'];
}

export interface MeetingStats {
  total: number;
  byType: Array<{ _id: string; count: number }>;
  byStatus: Array<{ _id: string; count: number }>;
  totalMessages: number;
}

class MeetingService {
  async createMeeting(data: CreateMeetingDto): Promise<Meeting> {
    const response = await api.post('/meetings', data);
    return response.data.data;
  }

  async getAllMeetings(filters?: { type?: MeetingType; status?: MeetingStatus }): Promise<Meeting[]> {
    const params = new URLSearchParams();
    if (filters?.type) params.append('type', filters.type);
    if (filters?.status) params.append('status', filters.status);
    
    const response = await api.get(`/meetings?${params.toString()}`);
    return response.data.data;
  }

  async getMeeting(id: string): Promise<Meeting> {
    const response = await api.get(`/meetings/${id}`);
    return response.data.data;
  }

  async getMeetingsByAgent(agentId: string): Promise<Meeting[]> {
    const response = await api.get(`/meetings/by-agent/${agentId}`);
    return response.data.data;
  }

  async getMeetingStats(): Promise<MeetingStats> {
    const response = await api.get('/meetings/stats');
    return response.data.data;
  }

  async startMeeting(id: string, startedBy: string): Promise<Meeting> {
    const response = await api.post(`/meetings/${id}/start`, { startedBy });
    return response.data.data;
  }

  async endMeeting(id: string): Promise<Meeting> {
    const response = await api.post(`/meetings/${id}/end`);
    return response.data.data;
  }

  async joinMeeting(id: string, agentId: string): Promise<Meeting> {
    const response = await api.post(`/meetings/${id}/join`, { agentId });
    return response.data.data;
  }

  async leaveMeeting(id: string, agentId: string): Promise<Meeting> {
    const response = await api.post(`/meetings/${id}/leave`, { agentId });
    return response.data.data;
  }

  async sendMessage(id: string, data: MeetingMessageDto): Promise<MeetingMessage> {
    const response = await api.post(`/meetings/${id}/messages`, data);
    return response.data.data;
  }

  async inviteAgent(id: string, agentId: string, invitedBy: string): Promise<Meeting> {
    const response = await api.post(`/meetings/${id}/invite`, { agentId, invitedBy });
    return response.data.data;
  }
}

export const meetingService = new MeetingService();
export default meetingService;

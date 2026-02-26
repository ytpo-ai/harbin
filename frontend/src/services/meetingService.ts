import api from '../lib/axios';
import { ParticipantIdentity } from './employeeService';

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
  ARCHIVED = 'archived',
}

export enum ParticipantRole {
  HOST = 'host',
  PARTICIPANT = 'participant',
  OBSERVER = 'observer',
}

export interface MeetingParticipant {
  participantId: string;
  participantType: 'employee' | 'agent';
  role: ParticipantRole;
  isPresent: boolean;
  hasSpoken: boolean;
  messageCount: number;
  joinedAt?: string;
  leftAt?: string;
}

export interface MeetingMessage {
  id: string;
  senderId: string;
  senderType: 'employee' | 'agent' | 'system';
  content: string;
  type: 'opinion' | 'question' | 'agreement' | 'disagreement' | 'suggestion' | 'conclusion' | 'introduction' | 'action_item';
  timestamp: string;
  metadata?: {
    mentionedParticipants?: Array<{ id: string; type: 'employee' | 'agent' }>;
    relatedMessageId?: string;
    sentiment?: 'positive' | 'neutral' | 'negative';
    confidence?: number;
    isAIProxy?: boolean;
    proxyForEmployeeId?: string;
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
  hostType: 'employee' | 'agent';
  participants: MeetingParticipant[];
  messages: MeetingMessage[];
  agenda?: string;
  scheduledStartTime?: string;
  startedAt?: string;
  endedAt?: string;
  invitedParticipants: Array<{ participantId: string; participantType: 'employee' | 'agent' }>;
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
  hostType: 'employee' | 'agent';
  participantIds?: Array<{ id: string; type: 'employee' | 'agent' }>;
  agenda?: string;
  scheduledStartTime?: string;
  settings?: Meeting['settings'];
}

export interface MeetingMessageDto {
  senderId: string;
  senderType: 'employee' | 'agent';
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

  async getMeetingsByParticipant(participantId: string, type: 'employee' | 'agent' = 'employee'): Promise<Meeting[]> {
    const response = await api.get(`/meetings/by-participant/${participantId}?type=${type}`);
    return response.data.data;
  }

  async getMeetingStats(): Promise<MeetingStats> {
    const response = await api.get('/meetings/stats');
    return response.data.data;
  }

  async startMeeting(id: string, startedBy: ParticipantIdentity): Promise<Meeting> {
    const response = await api.post(`/meetings/${id}/start`, startedBy);
    return response.data.data;
  }

  async endMeeting(id: string): Promise<Meeting> {
    const response = await api.post(`/meetings/${id}/end`);
    return response.data.data;
  }

  async joinMeeting(id: string, participant: ParticipantIdentity): Promise<Meeting> {
    const response = await api.post(`/meetings/${id}/join`, participant);
    return response.data.data;
  }

  async leaveMeeting(id: string, participant: ParticipantIdentity): Promise<Meeting> {
    const response = await api.post(`/meetings/${id}/leave`, participant);
    return response.data.data;
  }

  async sendMessage(id: string, data: MeetingMessageDto): Promise<MeetingMessage> {
    const response = await api.post(`/meetings/${id}/messages`, data);
    return response.data.data;
  }

  async inviteParticipant(
    id: string, 
    participant: ParticipantIdentity, 
    invitedBy: ParticipantIdentity
  ): Promise<Meeting> {
    const response = await api.post(`/meetings/${id}/invite`, { participant, invitedBy });
    return response.data.data;
  }

  async archiveMeeting(id: string): Promise<Meeting> {
    const response = await api.post(`/meetings/${id}/archive`);
    return response.data.data;
  }

  async deleteMeeting(id: string): Promise<void> {
    await api.delete(`/meetings/${id}`);
  }

  async inviteAgent(id: string, agentId: string, invitedBy: string): Promise<Meeting> {
    const response = await api.post(`/meetings/${id}/invite`, { 
      participant: { id: agentId, type: 'agent', name: 'Agent', isHuman: false },
      invitedBy: { id: invitedBy, type: 'employee', name: 'Host', isHuman: true }
    });
    return response.data.data;
  }
}

export const meetingService = new MeetingService();
export default meetingService;

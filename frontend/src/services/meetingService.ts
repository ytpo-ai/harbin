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

export type MeetingSpeakingMode = 'free' | 'ordered';

export interface MeetingParticipant {
  participantId: string;
  agentId?: string;
  participantType: 'employee' | 'agent';
  role: ParticipantRole;
  isPresent: boolean;
  hasSpoken: boolean;
  messageCount: number;
  joinedAt?: string;
  leftAt?: string;
  isExclusiveAssistant?: boolean;
  assistantForEmployeeId?: string;
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
  invitedAgentIds?: string[];
  settings?: {
    maxParticipants?: number;
    allowAutoStart?: boolean;
    aiModeration?: boolean;
    recordTranscript?: boolean;
    autoEndOnSilence?: number;
    speakingOrder?: 'free' | 'ordered' | 'sequential' | 'round_robin';
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

export interface ManageMeetingParticipantDto {
  id: string;
  type: 'employee' | 'agent';
  name: string;
  isHuman: boolean;
}

export interface MeetingStats {
  total: number;
  byType: Array<{ _id: string; count: number }>;
  byStatus: Array<{ _id: string; count: number }>;
  totalMessages: number;
}

export interface MeetingAgentState {
  agentId: string;
  state: 'thinking' | 'idle';
  updatedAt: string;
  reason?: string;
}

interface OneToOneMeetingParams {
  employeeId: string;
  employeeName: string;
  agentId: string;
  agentName: string;
  agentCandidateIds?: string[];
}

class MeetingService {
  private isOneToOneMeeting(meeting: Meeting, employeeId: string, agentIds: string[]): boolean {
    const participants = meeting.participants || [];
    const normalizedKeys = participants.map((participant) => {
      if (participant.participantType === 'employee') {
        return `employee:${participant.participantId}`;
      }

      if (participant.isExclusiveAssistant && participant.assistantForEmployeeId) {
        return `employee:${participant.assistantForEmployeeId}`;
      }

      return `agent:${participant.participantId}`;
    });
    const uniqueParticipants = Array.from(new Set(normalizedKeys));

    if (uniqueParticipants.length !== 2) {
      return false;
    }

    const hasEmployee = uniqueParticipants.includes(`employee:${employeeId}`);
    const hasAgent = participants.some(
      (participant) =>
        participant.participantType === 'agent' &&
        agentIds.includes(participant.participantId) &&
        !(participant.isExclusiveAssistant && participant.assistantForEmployeeId === employeeId),
    );

    return (
      hasEmployee &&
      hasAgent
    );
  }

  private async ensureMeetingReadyForChat(
    meeting: Meeting,
    employeeId: string,
    employeeName: string,
  ): Promise<Meeting> {
    let latestMeeting = meeting;

    if (latestMeeting.status === MeetingStatus.PENDING) {
      latestMeeting = await this.startMeeting(latestMeeting.id, {
        id: employeeId,
        type: 'employee',
        name: employeeName,
        isHuman: true,
      });
    } else if (latestMeeting.status === MeetingStatus.PAUSED) {
      latestMeeting = await this.resumeMeeting(latestMeeting.id);
    }

    const employeeParticipant = (latestMeeting.participants || []).find(
      (participant) =>
        participant.participantType === 'employee' &&
        participant.participantId === employeeId &&
        participant.isPresent,
    );

    if (!employeeParticipant && latestMeeting.status !== MeetingStatus.ENDED && latestMeeting.status !== MeetingStatus.ARCHIVED) {
      latestMeeting = await this.joinMeeting(latestMeeting.id, {
        id: employeeId,
        type: 'employee',
        name: employeeName,
        isHuman: true,
      });
    }

    return latestMeeting;
  }

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

  async getMeetingAgentStates(id: string): Promise<MeetingAgentState[]> {
    const response = await api.get(`/meetings/${id}/agent-states`);
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

  async pauseMeeting(id: string): Promise<Meeting> {
    const response = await api.post(`/meetings/${id}/pause`);
    return response.data.data;
  }

  async resumeMeeting(id: string): Promise<Meeting> {
    const response = await api.post(`/meetings/${id}/resume`);
    return response.data.data;
  }

  async updateSpeakingMode(id: string, speakingOrder: MeetingSpeakingMode): Promise<Meeting> {
    const response = await api.put(`/meetings/${id}/speaking-mode`, { speakingOrder });
    return response.data.data;
  }

  async updateMeetingTitle(id: string, title: string): Promise<Meeting> {
    const response = await api.put(`/meetings/${id}/title`, { title });
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

  async addParticipant(id: string, participant: ManageMeetingParticipantDto): Promise<Meeting> {
    const response = await api.post(`/meetings/${id}/participants`, participant);
    return response.data.data;
  }

  async removeParticipant(id: string, participantId: string, participantType: 'employee' | 'agent'): Promise<Meeting> {
    const response = await api.delete(`/meetings/${id}/participants/${participantType}/${participantId}`);
    return response.data.data;
  }

  async getOrCreateOneToOneMeeting(params: OneToOneMeetingParams): Promise<Meeting> {
    const { employeeId, employeeName, agentId, agentName, agentCandidateIds = [] } = params;
    const normalizedAgentIds = Array.from(new Set([agentId, ...agentCandidateIds].filter(Boolean)));
    const participantMeetings = await this.getMeetingsByParticipant(employeeId, 'employee');

    const reusableStatuses = new Set<MeetingStatus>([
      MeetingStatus.ACTIVE,
      MeetingStatus.PAUSED,
      MeetingStatus.PENDING,
    ]);

    const existingMeeting = participantMeetings.find(
      (meeting) =>
        reusableStatuses.has(meeting.status) &&
        this.isOneToOneMeeting(meeting, employeeId, normalizedAgentIds),
    );

    if (existingMeeting) {
      return this.ensureMeetingReadyForChat(existingMeeting, employeeId, employeeName);
    }

    const createdMeeting = await this.createMeeting({
      title: `与 ${agentName} 的1对1聊天`,
      description: `与 Agent ${agentName} 的直接会话`,
      type: MeetingType.DAILY,
      hostId: employeeId,
      hostType: 'employee',
      participantIds: [{ id: agentId, type: 'agent' }],
      settings: {
        maxParticipants: 2,
        speakingOrder: 'free',
        allowAutoStart: true,
        aiModeration: false,
        recordTranscript: true,
      },
    });

    return this.ensureMeetingReadyForChat(createdMeeting, employeeId, employeeName);
  }
}

export const meetingService = new MeetingService();
export default meetingService;

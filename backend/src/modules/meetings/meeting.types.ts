import { Meeting, MeetingDocument, MeetingMessage, MeetingType, ParticipantRole } from '../../shared/schemas/meeting.schema';

export interface MeetingEvent {
  type: 'message' | 'participant_joined' | 'participant_left' | 'status_changed' | 'typing' | 'summary_generated' | 'settings_changed' | 'agent_state_changed';
  meetingId: string;
  data: any;
  timestamp: Date;
}

export type MeetingAgentState = 'thinking' | 'idle';

export interface MeetingAgentStatePayload {
  agentId: string;
  state: MeetingAgentState;
  updatedAt: string;
  reason?: string;
  token?: string;
}

export type MeetingSpeakingMode = 'free' | 'ordered';

export interface ParticipantIdentity {
  id: string;
  type: 'employee' | 'agent';
  name: string;
  isHuman: boolean;
  employeeId?: string;
  agentId?: string;
}

export type MeetingParticipantRecord = MeetingDocument['participants'][number];

export interface ParticipantContextProfile {
  id: string;
  type: 'employee' | 'agent';
  name: string;
  role: ParticipantRole;
  isPresent: boolean;
  /** @deprecated Legacy compatibility field, no longer populated in new flow. */
  isExclusiveAssistant?: boolean;
  /** @deprecated Legacy compatibility field, no longer populated in new flow. */
  assistantForEmployeeId?: string;
}

export interface CreateMeetingDto {
  title: string;
  description?: string;
  type: MeetingType;
  hostId: string;
  hostType: 'employee' | 'agent';
  participantIds?: Array<{ id: string; type: 'employee' | 'agent' }>;
  agenda?: string;
  scheduledStartTime?: Date;
  settings?: Meeting['settings'];
  projectId?: string; // 所属孵化项目ID
}

export interface MeetingMessageDto {
  senderId: string;
  senderType: 'employee' | 'agent' | 'system';
  content: string;
  type?: MeetingMessage['type'];
  metadata?: MeetingMessage['metadata'];
}

export interface ControlMeetingMessageDto {
  employeeId: string;
}

export interface SaveMeetingSummaryDto {
  summary: string;
  actionItems?: string[];
  decisions?: string[];
  overwrite?: boolean;
  generatedByAgentId?: string;
}

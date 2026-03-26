import React from 'react';
import { Agent } from '../../types';
import { Employee } from '../../services/employeeService';
import { CreateMeetingDto, Meeting, MeetingMessage, MeetingSpeakingMode, MeetingStatus, MeetingType } from '../../services/meetingService';

export interface MeetingRealtimeEvent {
  type:
    | 'message'
    | 'participant_joined'
    | 'participant_left'
    | 'status_changed'
    | 'typing'
    | 'summary_generated'
    | 'settings_changed'
    | 'agent_state_changed';
  meetingId: string;
  data: any;
  timestamp: string;
}

export interface MentionCandidate {
  id: string;
  type: 'employee' | 'agent';
  name: string;
}

export interface PhraseSuggestion {
  key: 'model_list' | 'model_search' | 'memo_record' | 'operation_log' | 'agent_list';
  label: string;
  command: string;
}

export interface MeetingTypeInfo {
  id: MeetingType;
  name: string;
  color: string;
  icon: string;
}

export interface ManagementCandidate {
  key: string;
  id: string;
  type: 'employee' | 'agent';
  name: string;
}

export interface MeetingMutations {
  createMeeting: (data: CreateMeetingDto) => void;
  isCreatingMeeting: boolean;
  startMeeting: (payload: { id: string; startedById: string; startedByType: 'employee' | 'agent'; startedByName: string }) => void;
  isStartingMeeting: boolean;
  pauseMeeting: (meetingId: string) => void;
  isPausingMeeting: boolean;
  resumeMeeting: (meetingId: string) => void;
  isResumingMeeting: boolean;
  endMeeting: (meetingId: string) => void;
  isEndingMeeting: boolean;
  archiveMeeting: (meetingId: string) => void;
  isArchivingMeeting: boolean;
  deleteMeeting: (meetingId: string) => void;
  isDeletingMeeting: boolean;
  stopAndDeleteMeeting: (meetingId: string) => Promise<void>;
  openMeetingInNewTab: (meetingId: string) => void;
  updateSpeakingMode: (payload: { id: string; speakingOrder: MeetingSpeakingMode }) => void;
  isUpdatingSpeakingMode: boolean;
  updateMeetingTitle: (payload: { id: string; title: string }) => void;
  isUpdatingMeetingTitle: boolean;
  addParticipant: (payload: { id: string; candidateKey: string }) => void;
  isAddingParticipant: boolean;
  removeParticipant: (payload: { id: string; participantId: string; participantType: 'employee' | 'agent' }) => void;
  isRemovingParticipant: boolean;
  sendMessage: (payload: { id: string; content: string }) => void;
  isSendingMessage: boolean;
  pauseMessageResponse: (payload: { id: string; messageId: string; employeeId: string }) => void;
  isPausingMessageResponse: boolean;
  revokePausedMessage: (payload: { id: string; messageId: string; employeeId: string }) => void;
  isRevokingPausedMessage: boolean;
  inviteAgent: (payload: { id: string; agentId: string; invitedBy: string }) => void;
}

export interface MeetingListSidebarProps {
  meetings: Meeting[];
  stats?: {
    total: number;
    byStatus: Array<{ _id: string; count: number }>;
    totalMessages: number;
  };
  selectedMeetingId?: string;
  hasExclusiveAssistant: boolean;
  currentEmployee: Employee | null;
  onCreateClick: () => void;
  onSelectMeeting: (meeting: Meeting) => void;
  getMeetingTypeInfo: (type: MeetingType) => MeetingTypeInfo;
  getStatusBadge: (status: MeetingStatus) => React.ReactNode;
}

export interface MeetingHeaderProps {
  meeting: Meeting;
  speakingModeLabel: string;
  onSpeakingModeChange: (speakingOrder: MeetingSpeakingMode) => void;
  isUpdatingSpeakingMode: boolean;
}

export interface MeetingStatusActionsProps {
  meeting: Meeting;
  currentUser: any;
  showOperationMenu: string | null;
  setShowOperationMenu: (value: string | null) => void;
  mutations: MeetingMutations;
}

export interface ParticipantAvatarRowProps {
  meeting: Meeting;
  thinkingAgentIds: string[];
  agents: Agent[];
  getParticipantDisplayName: (
    participantId: string,
    participantType: 'employee' | 'agent',
    participant?: Meeting['participants'][number],
  ) => string;
  onInviteAgent: (agentId: string) => void;
}

export interface MessageListProps {
  meeting: Meeting;
  currentUser: any;
  currentEmployee: Employee | null;
  repliedMessageIds: Set<string>;
  getParticipantDisplayName: (participantId: string, participantType: 'employee' | 'agent') => string;
  onPauseMessageResponse: (messageId: string) => void;
  onRevokePausedMessage: (messageId: string) => void;
  isPausingMessageResponse: boolean;
  isRevokingPausedMessage: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

export interface MentionAutocompleteHook {
  mentionStart: number | null;
  mentionActiveIndex: number;
  filteredMentionCandidates: MentionCandidate[];
  setMentionActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  resetMention: () => void;
  updateMentionState: (value: string, caretPosition: number | null) => void;
  applyMentionCandidate: (
    candidate: MentionCandidate,
    value: string,
    inputRef: React.RefObject<HTMLTextAreaElement>,
    setValue: React.Dispatch<React.SetStateAction<string>>,
  ) => void;
}

export interface PhraseAutocompleteHook {
  phraseStart: number | null;
  phraseActiveIndex: number;
  filteredPhraseSuggestions: PhraseSuggestion[];
  setPhraseActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  resetPhrase: () => void;
  updatePhraseState: (value: string, caretPosition: number | null) => void;
  applyPhraseSuggestion: (
    suggestion: PhraseSuggestion,
    value: string,
    inputRef: React.RefObject<HTMLTextAreaElement>,
    setValue: React.Dispatch<React.SetStateAction<string>>,
  ) => void;
}

export interface MessageHistoryHook {
  sentMessageHistory: string[];
  messageHistoryIndex: number | null;
  resetHistoryState: () => void;
  navigateUp: (currentDraft: string) => string;
  navigateDown: () => string;
}

export interface ChatInputProps {
  meeting: Meeting;
  newMessage: string;
  setNewMessage: React.Dispatch<React.SetStateAction<string>>;
  isComposing: boolean;
  setIsComposing: React.Dispatch<React.SetStateAction<boolean>>;
  hasExclusiveAssistant: boolean;
  currentEmployee: Employee | null;
  mentionHook: MentionAutocompleteHook;
  phraseHook: PhraseAutocompleteHook;
  historyHook: MessageHistoryHook;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  isSendingMessage: boolean;
  onSendMessage: (content: string) => void;
}

export interface MeetingSummaryPanelProps {
  summary: Meeting['summary'];
}

export interface OperationsSidebarProps {
  meeting: Meeting;
  isCollapsed: boolean;
  titleDraft: string;
  setTitleDraft: React.Dispatch<React.SetStateAction<string>>;
  managementCandidates: ManagementCandidate[];
  selectedCandidateKey: string;
  setSelectedCandidateKey: React.Dispatch<React.SetStateAction<string>>;
  getParticipantDisplayName: (
    participantId: string,
    participantType: 'employee' | 'agent',
    participant?: Meeting['participants'][number],
  ) => string;
  onSaveTitle: () => void;
  onAddParticipant: () => void;
  onRemoveParticipant: (participantId: string, participantType: 'employee' | 'agent') => void;
  isUpdatingTitle: boolean;
  isAddingParticipant: boolean;
  isRemovingParticipant: boolean;
}

export interface CreateMeetingModalProps {
  agents: Agent[];
  currentUser: any;
  hasExclusiveAssistant: boolean;
  exclusiveAssistantName: string;
  onClose: () => void;
  onCreate: (data: CreateMeetingDto) => void;
  isLoading: boolean;
}

export interface MeetingMutationPayloads {
  selectedMeeting: Meeting | null;
  setSelectedMeeting: React.Dispatch<React.SetStateAction<Meeting | null>>;
  setIsCreateModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  currentUser: any;
  participantDisplayMap: Map<string, string>;
  setNewMessage: React.Dispatch<React.SetStateAction<string>>;
  resetMessageHistoryState: () => void;
}

export type MeetingMessageRecord = Meeting['messages'][number] | MeetingMessage;

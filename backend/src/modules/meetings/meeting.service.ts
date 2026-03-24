import { Injectable, OnModuleInit } from '@nestjs/common';
import { MeetingDocument, MeetingMessage, MeetingStatus, MeetingType } from '../../shared/schemas/meeting.schema';
import {
  ControlMeetingMessageDto,
  CreateMeetingDto,
  MeetingAgentStatePayload,
  MeetingEvent,
  MeetingMessageDto,
  MeetingSpeakingMode,
  ParticipantIdentity,
  SaveMeetingSummaryDto,
} from './meeting.types';
import { MeetingEventService } from './services/meeting-event.service';
import { MeetingAgentStateService } from './services/meeting-agent-state.service';
import { MeetingLifecycleService } from './services/meeting-lifecycle.service';
import { MeetingParticipantService } from './services/meeting-participant.service';
import { MeetingMessageService } from './services/meeting-message.service';
import { MeetingOrchestrationService } from './services/meeting-orchestration.service';
import { MeetingSummaryService } from './services/meeting-summary.service';

@Injectable()
export class MeetingService implements OnModuleInit {
  constructor(
    private readonly eventService: MeetingEventService,
    private readonly agentStateService: MeetingAgentStateService,
    private readonly lifecycleService: MeetingLifecycleService,
    private readonly participantService: MeetingParticipantService,
    private readonly messageService: MeetingMessageService,
    private readonly orchestrationService: MeetingOrchestrationService,
    private readonly summaryService: MeetingSummaryService,
  ) {}

  onModuleInit(): void {
    this.messageService.setOnHumanMessageSentHook((meetingId, message) =>
      this.orchestrationService.triggerAgentResponses(meetingId, message),
    );

    this.participantService.setOnAddSystemMessageHook((meetingId, content) =>
      this.messageService.addSystemMessage(meetingId, content),
    );
    this.participantService.setOnAgentJoinedActiveHook((meetingId, participant) =>
      this.orchestrationService.catchUpAgent(meetingId, participant),
    );

    this.lifecycleService.setOnAddSystemMessageHook((meetingId, content) =>
      this.messageService.addSystemMessage(meetingId, content),
    );
    this.lifecycleService.setOnAppendParticipantContextHook((meeting, action) =>
      this.participantService.appendParticipantContextSystemMessage(meeting, action),
    );
    this.lifecycleService.setOnPublishMeetingEndedSummaryEventHook((meeting) =>
      this.summaryService.publishMeetingEndedSummaryEvent(meeting),
    );
  }

  createMeeting(dto: CreateMeetingDto) {
    return this.lifecycleService.createMeeting(dto);
  }

  startMeeting(meetingId: string, startedBy: ParticipantIdentity) {
    return this.lifecycleService.startMeeting(meetingId, startedBy);
  }

  endMeeting(meetingId: string) {
    return this.lifecycleService.endMeeting(meetingId);
  }

  pauseMeeting(meetingId: string) {
    return this.lifecycleService.pauseMeeting(meetingId);
  }

  resumeMeeting(meetingId: string) {
    return this.lifecycleService.resumeMeeting(meetingId);
  }

  updateSpeakingMode(meetingId: string, speakingOrder: MeetingSpeakingMode) {
    return this.lifecycleService.updateSpeakingMode(meetingId, speakingOrder);
  }

  updateMeetingTitle(meetingId: string, title: string) {
    return this.lifecycleService.updateMeetingTitle(meetingId, title);
  }

  archiveMeeting(meetingId: string) {
    return this.lifecycleService.archiveMeeting(meetingId);
  }

  deleteMeeting(meetingId: string) {
    return this.lifecycleService.deleteMeeting(meetingId);
  }

  joinMeeting(meetingId: string, participant: ParticipantIdentity) {
    return this.participantService.joinMeeting(meetingId, participant);
  }

  leaveMeeting(meetingId: string, participant: ParticipantIdentity) {
    return this.participantService.leaveMeeting(meetingId, participant);
  }

  inviteParticipant(meetingId: string, participant: ParticipantIdentity, invitedBy: ParticipantIdentity) {
    return this.participantService.inviteParticipant(meetingId, participant, invitedBy);
  }

  addParticipant(meetingId: string, participant: ParticipantIdentity) {
    return this.participantService.addParticipant(meetingId, participant);
  }

  removeParticipant(meetingId: string, participantId: string, participantType: 'employee' | 'agent') {
    return this.participantService.removeParticipant(meetingId, participantId, participantType);
  }

  sendMessage(meetingId: string, dto: MeetingMessageDto) {
    return this.messageService.sendMessage(meetingId, dto);
  }

  pauseMessageResponse(meetingId: string, messageId: string, employeeId: string) {
    return this.messageService.pauseMessageResponse(meetingId, messageId, employeeId);
  }

  revokePausedMessage(meetingId: string, messageId: string, employeeId: string) {
    return this.messageService.revokePausedMessage(meetingId, messageId, employeeId);
  }

  getMeeting(meetingId: string) {
    return this.lifecycleService.getMeeting(meetingId);
  }

  getMeetingDetail(meetingId: string) {
    return this.lifecycleService.getMeetingDetail(meetingId);
  }

  getMeetingAgentStates(meetingId: string) {
    return this.agentStateService.getMeetingAgentStates(meetingId);
  }

  getAllMeetings(filters?: { type?: MeetingType; status?: MeetingStatus }) {
    return this.lifecycleService.getAllMeetings(filters);
  }

  getMeetingsByParticipant(participantId: string, participantType: 'employee' | 'agent') {
    return this.lifecycleService.getMeetingsByParticipant(participantId, participantType);
  }

  getMeetingStats() {
    return this.lifecycleService.getMeetingStats();
  }

  generateMeetingSummary(meetingId: string, payload: SaveMeetingSummaryDto) {
    return this.summaryService.generateMeetingSummary(meetingId, payload);
  }

  subscribeToEvents(meetingId: string, callback: (event: MeetingEvent) => void): void {
    this.eventService.subscribeToEvents(meetingId, callback);
  }

  unsubscribeFromEvents(meetingId: string, callback: (event: MeetingEvent) => void): void {
    this.eventService.unsubscribeFromEvents(meetingId, callback);
  }
}

export {
  ControlMeetingMessageDto,
  CreateMeetingDto,
  MeetingAgentStatePayload,
  MeetingEvent,
  MeetingMessageDto,
  MeetingSpeakingMode,
  ParticipantIdentity,
  SaveMeetingSummaryDto,
};

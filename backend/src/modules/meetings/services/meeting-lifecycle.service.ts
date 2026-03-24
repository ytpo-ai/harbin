import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AgentClientService } from '../../agents-client/agent-client.service';
import { EmployeeService } from '../../employees/employee.service';
import { EmployeeType } from '../../../shared/schemas/employee.schema';
import { Meeting, MeetingDocument, MeetingStatus, MeetingType, ParticipantRole } from '../../../shared/schemas/meeting.schema';
import { MessagesService } from '../../messages/messages.service';
import { CreateMeetingDto, MeetingSpeakingMode, MeetingEvent, MeetingParticipantRecord, ParticipantIdentity } from '../meeting.types';
import { MeetingEventService } from './meeting-event.service';
import { MeetingAgentStateService } from './meeting-agent-state.service';

@Injectable()
export class MeetingLifecycleService {
  private readonly logger = new Logger(MeetingLifecycleService.name);
  private onAddSystemMessageHook?: (meetingId: string, content: string) => Promise<void>;
  private onAppendParticipantContextHook?: (meeting: MeetingDocument, action: 'initialized' | 'updated') => Promise<void>;
  private onPublishMeetingEndedSummaryEventHook?: (meeting: MeetingDocument) => Promise<void>;

  constructor(
    @InjectModel(Meeting.name) private readonly meetingModel: Model<MeetingDocument>,
    private readonly agentClientService: AgentClientService,
    private readonly employeeService: EmployeeService,
    private readonly messagesService: MessagesService,
    private readonly eventService: MeetingEventService,
    private readonly agentStateService: MeetingAgentStateService,
  ) {}

  setOnAddSystemMessageHook(hook: (meetingId: string, content: string) => Promise<void>): void {
    this.onAddSystemMessageHook = hook;
  }

  setOnAppendParticipantContextHook(hook: (meeting: MeetingDocument, action: 'initialized' | 'updated') => Promise<void>): void {
    this.onAppendParticipantContextHook = hook;
  }

  setOnPublishMeetingEndedSummaryEventHook(hook: (meeting: MeetingDocument) => Promise<void>): void {
    this.onPublishMeetingEndedSummaryEventHook = hook;
  }

  private async addSystemMessage(meetingId: string, content: string): Promise<void> {
    if (!this.onAddSystemMessageHook) return;
    await this.onAddSystemMessageHook(meetingId, content);
  }

  private async appendParticipantContextSystemMessage(
    meeting: MeetingDocument,
    action: 'initialized' | 'updated',
  ): Promise<void> {
    if (!this.onAppendParticipantContextHook) return;
    await this.onAppendParticipantContextHook(meeting, action);
  }

  private async publishMeetingEndedSummaryEvent(meeting: MeetingDocument): Promise<void> {
    if (!this.onPublishMeetingEndedSummaryEventHook) return;
    await this.onPublishMeetingEndedSummaryEventHook(meeting);
  }

  private normalizeSpeakingMode(mode?: string): MeetingSpeakingMode {
    if (mode === 'ordered' || mode === 'sequential' || mode === 'round_robin') {
      return 'ordered';
    }
    return 'free';
  }


  private async getEmployeeOrThrow(employeeId: string) {
    const employee = await this.employeeService.getEmployee(employeeId);
    if (!employee) {
      throw new NotFoundException(`Employee not found: ${employeeId}`);
    }
    return employee;
  }


  private async getRequiredExclusiveAssistantAgentId(employeeId: string): Promise<string> {
    const employee = await this.getEmployeeOrThrow(employeeId);

    if (employee.type !== EmployeeType.HUMAN) {
      throw new ConflictException('Only human accounts can initiate or join meetings in employee mode');
    }

    const assistantAgentId = employee.exclusiveAssistantAgentId || employee.aiProxyAgentId;
    if (!assistantAgentId) {
      throw new ConflictException('Human account must bind an exclusive assistant before initiating or joining meetings');
    }

    return assistantAgentId;
  }


  private upsertExclusiveAssistantParticipant(
    meeting: MeetingDocument,
    ownerEmployeeId: string,
    assistantAgentId: string,
    isPresent: boolean,
  ): void {
    const now = new Date();
    const existing = meeting.participants.find(
      (p) => p.participantId === assistantAgentId && p.participantType === 'agent',
    ) as MeetingParticipantRecord | undefined;

    if (existing) {
      existing.isExclusiveAssistant = true;
      existing.assistantForEmployeeId = ownerEmployeeId;
      if (isPresent) {
        existing.isPresent = true;
        existing.joinedAt = existing.joinedAt || now;
      }
      return;
    }

    meeting.participants.push({
      participantId: assistantAgentId,
      participantType: 'agent',
      role: ParticipantRole.PARTICIPANT,
      isPresent,
      hasSpoken: false,
      messageCount: 0,
      joinedAt: isPresent ? now : undefined,
      isExclusiveAssistant: true,
      assistantForEmployeeId: ownerEmployeeId,
    });
  }


  ensureMeetingCompatibility(meeting: MeetingDocument): void {
    if (!meeting.hostType) {
      const hostParticipant = meeting.participants?.find(
        p => p.role === ParticipantRole.HOST,
      ) || meeting.participants?.find(
        p => p.participantId === meeting.hostId,
      );
      meeting.hostType = (hostParticipant?.participantType || 'employee') as 'employee' | 'agent';
    }

    if (!meeting.participants) meeting.participants = [];
    if (!meeting.messages) meeting.messages = [];
    if (!meeting.invitedParticipants) meeting.invitedParticipants = [];
    if (!meeting.settings) meeting.settings = {};
    meeting.settings.speakingOrder = this.normalizeSpeakingMode(meeting.settings.speakingOrder as string | undefined);
  }

  /**
   * 创建新会议
   */

  async createMeeting(dto: CreateMeetingDto): Promise<Meeting> {
    let effectiveHostId = dto.hostId;
    let effectiveHostType: 'employee' | 'agent' = dto.hostType;
    const participants = [...(dto.participantIds || [])];

    if (dto.hostType === 'employee') {
      const assistantAgentId = await this.getRequiredExclusiveAssistantAgentId(dto.hostId);
      effectiveHostId = assistantAgentId;
      effectiveHostType = 'agent';
    }

    const dedupedParticipants = Array.from(
      new Map(
        participants.map((participant) => [`${participant.type}:${participant.id}`, participant] as const),
      ).values(),
    );

    const uniqueHumanParticipantIds = Array.from(
      new Set(
        dedupedParticipants
          .filter((p) => p.type === 'employee')
          .map((p) => p.id),
      ),
    );

    for (const employeeId of uniqueHumanParticipantIds) {
      await this.getRequiredExclusiveAssistantAgentId(employeeId);
    }
    
    // 过滤掉主持人自己
    const filteredParticipants = dedupedParticipants.filter(
      (p) => !(p.id === effectiveHostId && p.type === effectiveHostType),
    );

    const meeting = new this.meetingModel({
      id: uuidv4(),
      title: dto.title,
      description: dto.description,
      type: dto.type,
      status: MeetingStatus.PENDING,
      hostId: effectiveHostId,
      hostType: effectiveHostType,
      participants: [
        {
          participantId: effectiveHostId,
          participantType: effectiveHostType,
          role: ParticipantRole.HOST,
          isPresent: false,
          hasSpoken: false,
          messageCount: 0,
        },
        ...filteredParticipants.map(p => ({
          participantId: p.id,
          participantType: p.type,
          role: ParticipantRole.PARTICIPANT,
          isPresent: false,
          hasSpoken: false,
          messageCount: 0,
        })),
      ],
      agenda: dto.agenda,
      scheduledStartTime: dto.scheduledStartTime,
      settings: {
        maxParticipants: 20,
        allowAutoStart: true,
        aiModeration: false,
        recordTranscript: true,
        autoEndOnSilence: 30,
        ...dto.settings,
        speakingOrder: this.normalizeSpeakingMode(dto.settings?.speakingOrder as string | undefined),
      },
      messages: [],
      invitedParticipants: [],
      messageCount: 0,
    });

    const employeeIdsRequiringAssistant = new Set<string>();
    if (dto.hostType === 'employee') {
      employeeIdsRequiringAssistant.add(dto.hostId);
    }

    for (const participant of filteredParticipants) {
      if (participant.type === 'employee') {
        employeeIdsRequiringAssistant.add(participant.id);
      }
    }

    for (const employeeId of employeeIdsRequiringAssistant) {
      const assistantAgentId = await this.getRequiredExclusiveAssistantAgentId(employeeId);
      this.upsertExclusiveAssistantParticipant(meeting, employeeId, assistantAgentId, false);
    }

    const saved = await meeting.save();
    this.logger.log(`Created ${dto.type} meeting: ${saved.title} (${saved.id})`);
    
    return saved;
  }

  /**
   * 开始会议
   */

  async startMeeting(meetingId: string, startedBy: ParticipantIdentity): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.ensureMeetingCompatibility(meeting);

    if (meeting.status === MeetingStatus.ACTIVE) {
      throw new ConflictException('Meeting is already active');
    }

    if (meeting.status === MeetingStatus.ENDED || meeting.status === MeetingStatus.ARCHIVED) {
      throw new ConflictException('Meeting has already ended');
    }

    if (meeting.hostType === 'employee') {
      await this.getRequiredExclusiveAssistantAgentId(meeting.hostId);
    }

    meeting.status = MeetingStatus.ACTIVE;
    meeting.startedAt = new Date();
    const startTime = new Date();
    
    // 主持人自动标记为在场
    const hostParticipant = meeting.participants.find(
      p => p.participantId === meeting.hostId && p.participantType === meeting.hostType
    );
    if (hostParticipant) {
      hostParticipant.isPresent = true;
      hostParticipant.joinedAt = startTime;
    }

    // Agent participants auto-join when meeting starts so they can respond immediately.
    meeting.participants.forEach((participant) => {
      if (participant.participantType === 'agent' && !participant.isPresent) {
        participant.isPresent = true;
        participant.joinedAt = startTime;
      }
    });

    await meeting.save();

    await this.addSystemMessage(meetingId, `会议 "${meeting.title}" 已开始。`);
    await this.appendParticipantContextSystemMessage(meeting, 'initialized');

    this.eventService.emitEvent(meetingId, {
      type: 'status_changed',
      meetingId,
      data: { status: MeetingStatus.ACTIVE, startedBy },
      timestamp: new Date(),
    });

    this.logger.log(`Meeting ${meetingId} started by ${startedBy.name}`);

    return meeting;
  }

  /**
   * 结束会议
   */

  async endMeeting(meetingId: string): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.ensureMeetingCompatibility(meeting);

    if (meeting.status === MeetingStatus.ARCHIVED) {
      throw new ConflictException('Archived meeting cannot be ended again');
    }

    if (meeting.status === MeetingStatus.ENDED) {
      this.logger.warn(`Meeting ${meetingId} is already ended, skip duplicate end flow`);
      return meeting;
    }

    meeting.status = MeetingStatus.ENDED;
    meeting.endedAt = new Date();
    
    meeting.participants.forEach(p => {
      if (p.isPresent) {
        p.isPresent = false;
        p.leftAt = new Date();
      }
    });

    await meeting.save();
    await this.agentStateService.clearAllMeetingAgentThinking(meetingId, 'meeting_ended');
    await this.addSystemMessage(meetingId, `会议 "${meeting.title}" 已结束。`);
    await this.publishMeetingEndedSummaryEvent(meeting);

    this.eventService.emitEvent(meetingId, {
      type: 'status_changed',
      meetingId,
      data: { status: MeetingStatus.ENDED },
      timestamp: new Date(),
    });

    this.logger.log(`Meeting ${meetingId} ended`);
    return meeting;
  }


  async pauseMeeting(meetingId: string): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.ensureMeetingCompatibility(meeting);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new ConflictException('Only active meetings can be paused');
    }

    meeting.status = MeetingStatus.PAUSED;
    await meeting.save();
    await this.agentStateService.clearAllMeetingAgentThinking(meetingId, 'meeting_paused');

    this.eventService.emitEvent(meetingId, {
      type: 'status_changed',
      meetingId,
      data: { status: MeetingStatus.PAUSED },
      timestamp: new Date(),
    });

    return meeting;
  }


  async resumeMeeting(meetingId: string): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.ensureMeetingCompatibility(meeting);

    if (meeting.status !== MeetingStatus.PAUSED) {
      throw new ConflictException('Only paused meetings can be resumed');
    }

    meeting.status = MeetingStatus.ACTIVE;
    await meeting.save();

    this.eventService.emitEvent(meetingId, {
      type: 'status_changed',
      meetingId,
      data: { status: MeetingStatus.ACTIVE },
      timestamp: new Date(),
    });

    return meeting;
  }


  async updateSpeakingMode(meetingId: string, speakingOrder: MeetingSpeakingMode): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.ensureMeetingCompatibility(meeting);

    if (meeting.status === MeetingStatus.ENDED || meeting.status === MeetingStatus.ARCHIVED) {
      throw new ConflictException('Cannot update speaking mode for ended meeting');
    }

    meeting.settings = {
      ...meeting.settings,
      speakingOrder: this.normalizeSpeakingMode(speakingOrder),
    };
    await meeting.save();

    this.eventService.emitEvent(meetingId, {
      type: 'settings_changed',
      meetingId,
      data: { speakingOrder: meeting.settings.speakingOrder },
      timestamp: new Date(),
    });

    return meeting;
  }


  async updateMeetingTitle(meetingId: string, title: string): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    const nextTitle = String(title || '').trim();
    if (!nextTitle) {
      throw new BadRequestException('Meeting title is required');
    }

    if (meeting.title === nextTitle) {
      return meeting;
    }

    meeting.title = nextTitle;
    await meeting.save();

    this.eventService.emitEvent(meetingId, {
      type: 'settings_changed',
      meetingId,
      data: { title: nextTitle },
      timestamp: new Date(),
    });

    return meeting;
  }

  /**
   * 归档会议
   */

  async archiveMeeting(meetingId: string): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.ensureMeetingCompatibility(meeting);

    if (meeting.status !== MeetingStatus.ENDED) {
      throw new ConflictException('Only ended meetings can be archived');
    }

    meeting.status = MeetingStatus.ARCHIVED;
    await meeting.save();
    await this.agentStateService.clearAllMeetingAgentThinking(meetingId, 'meeting_archived');

    this.logger.log(`Meeting ${meetingId} archived`);
    return meeting;
  }

  /**
   * 删除会议
   */

  async deleteMeeting(meetingId: string): Promise<void> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    if (
      meeting.status !== MeetingStatus.PENDING &&
      meeting.status !== MeetingStatus.ENDED &&
      meeting.status !== MeetingStatus.ARCHIVED
    ) {
      throw new ConflictException('Only pending, ended, or archived meetings can be deleted');
    }

    await this.agentStateService.clearAllMeetingAgentThinking(meetingId, 'meeting_deleted');
    await this.messagesService.deleteMessagesByScene('meeting', meetingId);
    await this.meetingModel.deleteOne({ id: meetingId }).exec();
    this.logger.log(`Meeting ${meetingId} deleted`);
  }

  /**
   * 加入会议
   */

  async getMeeting(meetingId: string): Promise<Meeting | null> {
    return this.meetingModel.findOne({ id: meetingId }).exec();
  }


  async getMeetingDetail(meetingId: string): Promise<Meeting | null> {
    return this.getMeeting(meetingId);
  }


  async getAllMeetings(filters?: { type?: MeetingType; status?: MeetingStatus }): Promise<Meeting[]> {
    const query: any = {};
    if (filters?.type) query.type = filters.type;
    if (filters?.status) query.status = filters.status;
    return this.meetingModel.find(query).sort({ createdAt: -1 }).exec();
  }

  /**
   * 获取参与者参与的会议
   */

  async getMeetingsByParticipant(participantId: string, participantType: 'employee' | 'agent'): Promise<Meeting[]> {
    return this.meetingModel.find({
      $or: [
        { hostId: participantId, hostType: participantType },
        { 'participants.participantId': participantId, 'participants.participantType': participantType },
        { 'invitedParticipants.participantId': participantId, 'invitedParticipants.participantType': participantType },
      ],
    }).sort({ createdAt: -1 }).exec();
  }

  /**
   * 获取会议统计
   */

  async getMeetingStats(): Promise<any> {
    const total = await this.meetingModel.countDocuments();
    const byType = await this.meetingModel.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]);
    const byStatus = await this.meetingModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    const totalMessages = await this.meetingModel.aggregate([{ $group: { _id: null, total: { $sum: '$messageCount' } } }]);

    return {
      total,
      byType,
      byStatus,
      totalMessages: totalMessages[0]?.total || 0,
    };
  }

  /**
   * 触发Agent响应
   */
}

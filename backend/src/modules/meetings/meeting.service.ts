import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Meeting, MeetingDocument, MeetingType, MeetingStatus, ParticipantRole, MeetingMessage } from '../../shared/schemas/meeting.schema';
import { AgentClientService } from '../agents-client/agent-client.service';
import { EmployeeService } from '../employees/employee.service';
import { EmployeeType } from '../../shared/schemas/employee.schema';
import { Agent, ChatMessage } from '../../shared/types';
import { RedisService } from '@libs/infra';
import { v4 as uuidv4 } from 'uuid';

export interface MeetingEvent {
  type: 'message' | 'participant_joined' | 'participant_left' | 'status_changed' | 'typing' | 'summary_generated' | 'settings_changed';
  meetingId: string;
  data: any;
  timestamp: Date;
}

export type MeetingSpeakingMode = 'free' | 'ordered';

// 参与者标识
export interface ParticipantIdentity {
  id: string;
  type: 'employee' | 'agent';
  name: string;
  isHuman: boolean;
  employeeId?: string;
  agentId?: string;
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
}

export interface MeetingMessageDto {
  senderId: string;
  senderType: 'employee' | 'agent';
  content: string;
  type?: MeetingMessage['type'];
  metadata?: MeetingMessage['metadata'];
}

@Injectable()
export class MeetingService {
  private readonly logger = new Logger(MeetingService.name);
  private eventListeners = new Map<string, ((event: MeetingEvent) => void)[]>();
  private readonly modelManagementAgentName = 'model management agent';
  private readonly modelManagementAgentRole = 'model-management-specialist';

  constructor(
    @InjectModel(Meeting.name) private meetingModel: Model<MeetingDocument>,
    private readonly agentClientService: AgentClientService,
    private readonly employeeService: EmployeeService,
    private readonly redisService: RedisService,
  ) {}

  private normalizeSpeakingMode(mode?: string): MeetingSpeakingMode {
    if (mode === 'ordered' || mode === 'sequential' || mode === 'round_robin') {
      return 'ordered';
    }
    return 'free';
  }

  private extractMentionTokens(content: string): string[] {
    if (!content || !content.includes('@')) {
      return [];
    }

    const matches = content.matchAll(/@([^\s@，。,.!?！？:：;；]+)/g);
    const tokens = new Set<string>();

    for (const match of matches) {
      const raw = (match[1] || '').trim();
      const normalized = raw
        .replace(/^@+/, '')
        .replace(/[，。,.!?！？:：;；]+$/g, '')
        .toLowerCase();

      if (normalized) {
        tokens.add(normalized);
      }
    }

    return Array.from(tokens);
  }

  private buildMentionAliases(agentId: string, agentName?: string): Set<string> {
    const aliases = new Set<string>();
    aliases.add(agentId.toLowerCase());

    if (!agentName) {
      return aliases;
    }

    const normalizedName = agentName.toLowerCase().trim();
    if (normalizedName) {
      aliases.add(normalizedName);
      aliases.add(normalizedName.replace(/\s+/g, ''));
      normalizedName
        .split(/\s+/)
        .filter(Boolean)
        .forEach((part) => aliases.add(part));
    }

    return aliases;
  }

  private async resolveMentionedAgentIds(meeting: MeetingDocument, content: string): Promise<string[]> {
    const tokens = this.extractMentionTokens(content);
    if (tokens.length === 0) {
      return [];
    }

    const presentAgentIds = meeting.participants
      .filter((p) => p.isPresent && p.participantType === 'agent')
      .map((p) => p.participantId);

    if (presentAgentIds.length === 0) {
      return [];
    }

    const mentioned = new Set<string>();
    const uniqueAgentIds = Array.from(new Set(presentAgentIds));

    for (const agentId of uniqueAgentIds) {
      const agent = await this.agentClientService.getAgent(agentId);
      const aliases = this.buildMentionAliases(agentId, agent?.name);

      for (const token of tokens) {
        if (
          aliases.has(token) ||
          Array.from(aliases).some((alias) => token.length >= 2 && alias.startsWith(token))
        ) {
          mentioned.add(agentId);
        }
      }
    }

    return Array.from(mentioned);
  }

  private isLatestModelSearchIntent(content: string): boolean {
    const text = String(content || '').toLowerCase().trim();
    if (!text) return false;

    const hasSearch =
      text.includes('搜索') ||
      text.includes('查一下') ||
      text.includes('查询') ||
      text.includes('search') ||
      text.includes('find');
    const hasLatest = text.includes('最新') || text.includes('latest') || text.includes('newest');
    const hasModel = text.includes('模型') || text.includes('model');
    const hasOpenAI = text.includes('openai') || text.includes('gpt');

    return hasSearch && hasLatest && hasModel && hasOpenAI;
  }

  private isModelListIntent(content: string): boolean {
    const text = String(content || '').toLowerCase().trim();
    if (!text) return false;

    const hasModel = text.includes('模型') || text.includes('model');
    const asksList =
      text.includes('有哪些') ||
      text.includes('列表') ||
      text.includes('清单') ||
      text.includes('当前') ||
      text.includes('现在') ||
      text.includes('what models') ||
      text.includes('which models') ||
      text.includes('list models') ||
      text.includes('available models');

    return hasModel && asksList;
  }

  private isModelManagementIntent(content: string): boolean {
    return this.isLatestModelSearchIntent(content) || this.isModelListIntent(content);
  }

  private isHiddenAgentForMeeting(agent: Agent | null): boolean {
    if (!agent) {
      return false;
    }

    const normalizedName = String(agent.name || '').toLowerCase().trim();
    const normalizedType = String(agent.type || '').toLowerCase().trim();
    const normalizedRole = String(agent.role || '').toLowerCase().trim();

    if (normalizedName === this.modelManagementAgentName || normalizedRole === this.modelManagementAgentRole) {
      return true;
    }

    return (
      normalizedType === 'ai-system-builtin' &&
      normalizedName === this.modelManagementAgentName
    );
  }

  private getExpandedMeetingTitle(originalTitle: string): string {
    const normalized = String(originalTitle || '').trim();
    const replaced = normalized
      .replace(' 的1对1聊天', ' 等的讨论')
      .replace('的1对1聊天', '等的讨论')
      .replace('1对1聊天', '多人讨论');
    return replaced || '多人讨论';
  }

  private async maybeRenameExpandedOneToOneMeeting(
    meeting: MeetingDocument,
    addedParticipant: ParticipantIdentity,
  ): Promise<boolean> {
    const currentTitle = String(meeting.title || '').trim();
    if (!currentTitle.includes('1对1聊天')) {
      return false;
    }

    if (!addedParticipant || addedParticipant.type !== 'agent') {
      return false;
    }

    const addedAgent = await this.agentClientService.getAgent(addedParticipant.id);
    if (this.isHiddenAgentForMeeting(addedAgent)) {
      return false;
    }

    const participantCount = new Set(
      (meeting.participants || []).map((participant) => `${participant.participantType}:${participant.participantId}`),
    ).size;
    if (participantCount <= 2) {
      return false;
    }

    const nextTitle = this.getExpandedMeetingTitle(currentTitle);
    if (!nextTitle || nextTitle === currentTitle) {
      return false;
    }

    meeting.title = nextTitle;
    await meeting.save();

    this.emitEvent(meeting.id, {
      type: 'settings_changed',
      meetingId: meeting.id,
      data: { title: nextTitle },
      timestamp: new Date(),
    });

    this.logger.log(`Meeting ${meeting.id} title updated after participant expansion: ${nextTitle}`);
    return true;
  }

  private async pickModelManagementResponder(
    presentAgents: MeetingDocument['participants'],
  ): Promise<string | null> {
    for (const participant of presentAgents) {
      const agent = await this.agentClientService.getAgent(participant.participantId);
      if (!agent) continue;

      const normalizedName = String(agent.name || '').toLowerCase().trim();
      const normalizedRole = String(agent.role || '').toLowerCase().trim();

      if (normalizedName === this.modelManagementAgentName || normalizedRole === this.modelManagementAgentRole) {
        return participant.participantId;
      }
    }

    return null;
  }

  private ensureMeetingCompatibility(meeting: MeetingDocument): void {
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
    const participants = dto.participantIds || [];
    
    // 过滤掉主持人自己
    const filteredParticipants = participants.filter(
      p => !(p.id === dto.hostId && p.type === dto.hostType)
    );

    const meeting = new this.meetingModel({
      id: uuidv4(),
      title: dto.title,
      description: dto.description,
      type: dto.type,
      status: MeetingStatus.PENDING,
      hostId: dto.hostId,
      hostType: dto.hostType,
      participants: [
        {
          participantId: dto.hostId,
          participantType: dto.hostType,
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

    this.emitEvent(meetingId, {
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

    meeting.status = MeetingStatus.ENDED;
    meeting.endedAt = new Date();
    
    meeting.participants.forEach(p => {
      if (p.isPresent) {
        p.isPresent = false;
        p.leftAt = new Date();
      }
    });

    await meeting.save();
    await this.addSystemMessage(meetingId, `会议 "${meeting.title}" 已结束。`);
    await this.generateMeetingSummary(meetingId);

    this.emitEvent(meetingId, {
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

    this.emitEvent(meetingId, {
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

    this.emitEvent(meetingId, {
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

    this.emitEvent(meetingId, {
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

    this.emitEvent(meetingId, {
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

    await this.meetingModel.deleteOne({ id: meetingId }).exec();
    this.logger.log(`Meeting ${meetingId} deleted`);
  }

  /**
   * 加入会议
   */
  async joinMeeting(meetingId: string, participant: ParticipantIdentity): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.ensureMeetingCompatibility(meeting);

    if (meeting.status === MeetingStatus.ENDED || meeting.status === MeetingStatus.ARCHIVED) {
      throw new ConflictException('Meeting has already ended');
    }

    let existingParticipant = meeting.participants.find(
      p => p.participantId === participant.id && p.participantType === participant.type
    );
    
    if (!existingParticipant) {
      existingParticipant = {
        participantId: participant.id,
        participantType: participant.type,
        role: ParticipantRole.PARTICIPANT,
        isPresent: true,
        hasSpoken: false,
        messageCount: 0,
        joinedAt: new Date(),
      };
      meeting.participants.push(existingParticipant);
    } else {
      existingParticipant.isPresent = true;
      existingParticipant.joinedAt = new Date();
    }

    meeting.invitedParticipants = meeting.invitedParticipants.filter(
      ip => !(ip.participantId === participant.id && ip.participantType === participant.type)
    );

    await meeting.save();
    await this.addSystemMessage(meetingId, `${participant.name} 加入了会议。`);

    this.emitEvent(meetingId, {
      type: 'participant_joined',
      meetingId,
      data: participant,
      timestamp: new Date(),
    });

    this.logger.log(`${participant.name} joined meeting ${meetingId}`);

    if (meeting.status === MeetingStatus.ACTIVE && participant.type === 'agent') {
      setTimeout(() => this.catchUpAgent(meetingId, participant), 1000);
    }

    return meeting;
  }

  /**
   * 离开会议
   */
  async leaveMeeting(meetingId: string, participant: ParticipantIdentity): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.ensureMeetingCompatibility(meeting);

    const p = meeting.participants.find(
      p => p.participantId === participant.id && p.participantType === participant.type
    );
    
    if (p) {
      p.isPresent = false;
      p.leftAt = new Date();
      await meeting.save();
      await this.addSystemMessage(meetingId, `${participant.name} 离开了会议。`);

      this.emitEvent(meetingId, {
        type: 'participant_left',
        meetingId,
        data: participant,
        timestamp: new Date(),
      });

      this.logger.log(`${participant.name} left meeting ${meetingId}`);
    }

    return meeting;
  }

  /**
   * 发送消息
   */
  async sendMessage(meetingId: string, dto: MeetingMessageDto): Promise<MeetingMessage> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.ensureMeetingCompatibility(meeting);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new ConflictException('Meeting is not active');
    }

    // Check if sender is host
    const isHost = meeting.hostId === dto.senderId;
    
    // Find participant in the meeting
    const participant = meeting.participants.find(
      p => p.participantId === dto.senderId && p.isPresent
    );
    
    if (!participant && !isHost) {
      throw new ConflictException('Participant is not in the meeting or not present');
    }

    const message: MeetingMessage = {
      id: uuidv4(),
      senderId: dto.senderId,
      senderType: dto.senderType,
      content: dto.content,
      type: dto.type || 'opinion',
      timestamp: new Date(),
      metadata: dto.metadata,
    };

    meeting.messages.push(message);
    meeting.messageCount += 1;
    
    // Update participant stats
    if (participant) {
      participant.messageCount += 1;
      participant.hasSpoken = true;
    }
    
    await meeting.save();

    this.emitEvent(meetingId, {
      type: 'message',
      meetingId,
      data: message,
      timestamp: new Date(),
    });

    // 触发Agent响应（仅在人类发言后触发，避免Agent之间无限互相触发）
    if (dto.senderType === 'employee') {
      await this.triggerAgentResponses(meetingId, message);
    }

    return message;
  }

  /**
   * 邀请参与者
   */
  async inviteParticipant(
    meetingId: string, 
    participant: ParticipantIdentity, 
    invitedBy: ParticipantIdentity
  ): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.ensureMeetingCompatibility(meeting);

    const isAlreadyParticipant = meeting.participants.some(
      p => p.participantId === participant.id && p.participantType === participant.type
    );
    if (isAlreadyParticipant) {
      throw new ConflictException('Already a participant');
    }

    // Add agent directly to participants (for AI agents)
    if (participant.type === 'agent') {
      meeting.participants.push({
        participantId: participant.id,
        participantType: participant.type,
        role: ParticipantRole.PARTICIPANT,
        isPresent: true, // Agents are auto-present
        hasSpoken: false,
        messageCount: 0,
        joinedAt: new Date(),
      });
      await meeting.save();
      await this.maybeRenameExpandedOneToOneMeeting(meeting, participant);
      await this.addSystemMessage(meetingId, `${invitedBy.name} 邀请了 ${participant.name}。`);
      
      // Trigger catch-up for the newly joined agent
      setTimeout(() => this.catchUpAgent(meetingId, participant), 1000);
      
      this.logger.log(`${participant.name} joined meeting ${meetingId} by invitation`);
      return meeting;
    }

    // For employees, add to invited list (they need to join manually)
    const isAlreadyInvited = meeting.invitedParticipants.some(
      ip => ip.participantId === participant.id && ip.participantType === participant.type
    );
    if (isAlreadyInvited) {
      throw new ConflictException('Already invited');
    }

    meeting.invitedParticipants.push({
      participantId: participant.id,
      participantType: participant.type,
    });
    
    await meeting.save();
    await this.addSystemMessage(meetingId, `${invitedBy.name} 邀请了 ${participant.name}。`);

    this.logger.log(`${participant.name} invited to meeting ${meetingId} by ${invitedBy.name}`);
    return meeting;
  }

  async addParticipant(meetingId: string, participant: ParticipantIdentity): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.ensureMeetingCompatibility(meeting);

    if (!participant?.id || !participant?.type) {
      throw new BadRequestException('Participant identity is required');
    }

    const existingParticipant = meeting.participants.find(
      (p) => p.participantId === participant.id && p.participantType === participant.type,
    );

    if (existingParticipant) {
      throw new ConflictException('Already a participant');
    }

    const isAgent = participant.type === 'agent';
    const isPresent = isAgent && meeting.status === MeetingStatus.ACTIVE;

    meeting.participants.push({
      participantId: participant.id,
      participantType: participant.type,
      role: ParticipantRole.PARTICIPANT,
      isPresent,
      hasSpoken: false,
      messageCount: 0,
      joinedAt: isPresent ? new Date() : undefined,
    });

    meeting.invitedParticipants = (meeting.invitedParticipants || []).filter(
      (p) => !(p.participantId === participant.id && p.participantType === participant.type),
    );

    await meeting.save();
    await this.addSystemMessage(meetingId, `${participant.name || participant.id} 被添加为参会人。`);
    await this.maybeRenameExpandedOneToOneMeeting(meeting, participant);

    if (isAgent && isPresent) {
      setTimeout(() => this.catchUpAgent(meetingId, participant), 1000);
    }

    return meeting;
  }

  async removeParticipant(
    meetingId: string,
    participantId: string,
    participantType: 'employee' | 'agent',
  ): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.ensureMeetingCompatibility(meeting);

    if (meeting.hostId === participantId && meeting.hostType === participantType) {
      throw new ConflictException('Cannot remove host from participants');
    }

    const beforeCount = meeting.participants.length;
    meeting.participants = meeting.participants.filter(
      (p) => !(p.participantId === participantId && p.participantType === participantType),
    );

    meeting.invitedParticipants = (meeting.invitedParticipants || []).filter(
      (p) => !(p.participantId === participantId && p.participantType === participantType),
    );

    if (beforeCount === meeting.participants.length) {
      throw new NotFoundException('Participant not found in this meeting');
    }

    await meeting.save();
    await this.addSystemMessage(meetingId, `${participantId} 已从参会人员中移除。`);

    return meeting;
  }

  /**
   * 获取会议
   */
  async getMeeting(meetingId: string): Promise<Meeting | null> {
    return this.meetingModel.findOne({ id: meetingId }).exec();
  }

  /**
   * 获取所有会议
   */
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
  private async triggerAgentResponses(meetingId: string, triggerMessage: MeetingMessage): Promise<void> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting || meeting.status !== MeetingStatus.ACTIVE) return;

    this.ensureMeetingCompatibility(meeting);
    // 获取在场的Agent参与者
    let presentAgents = meeting.participants.filter(
      p => p.isPresent && 
           p.participantType === 'agent' && 
           p.participantId !== triggerMessage.senderId
    );

    // Backward compatibility: auto-join configured agent participants in old active meetings
    if (presentAgents.length === 0) {
      const standbyAgents = meeting.participants.filter(
        p => !p.isPresent && p.participantType === 'agent' && p.participantId !== triggerMessage.senderId,
      );

      if (standbyAgents.length > 0) {
        const now = new Date();
        standbyAgents.forEach((p) => {
          p.isPresent = true;
          p.joinedAt = now;
        });
        await meeting.save();
        presentAgents = standbyAgents;
      }
    }

    if (presentAgents.length === 0) return;

    const routeToModelManagementAgent = this.isModelManagementIntent(triggerMessage.content || '');
    if (routeToModelManagementAgent) {
      const modelAgentId = await this.pickModelManagementResponder(presentAgents);
      if (modelAgentId) {
        presentAgents = presentAgents.filter((participant) => participant.participantId === modelAgentId);
      }
    }

    const mentionTokens = this.extractMentionTokens(triggerMessage.content || '');
    if (mentionTokens.length > 0) {
      const mentionedAgentIds = await this.resolveMentionedAgentIds(meeting, triggerMessage.content || '');

      if (mentionedAgentIds.length === 0) {
        await this.addSystemMessage(meetingId, '未匹配到被 @ 的在场 Agent，请检查名称后重试。');
        return;
      }

      presentAgents = presentAgents.filter((p) => mentionedAgentIds.includes(p.participantId));
      if (presentAgents.length === 0) {
        return;
      }
    }

    // 每次人类发言后，所有在场Agent都响应
    const responders = [...presentAgents].sort(() => 0.5 - Math.random());

    for (let i = 0; i < responders.length; i += 1) {
      const p = responders[i];
      const delay = 800 + i * 700 + Math.random() * 500;
      setTimeout(async () => {
        await this.generateAgentResponse(meetingId, p.participantId, triggerMessage);
      }, delay);
    }
  }

  /**
   * 生成Agent响应
   */
  private async generateAgentResponse(
    meetingId: string, 
    agentId: string, 
    triggerMessage: MeetingMessage
  ): Promise<void> {
    try {
      const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
      if (!meeting || meeting.status !== MeetingStatus.ACTIVE) return;

      const agent = await this.agentClientService.getAgent(agentId);
      if (!agent) return;

      this.logger.log(`Generating response for agent ${agent.name} in meeting ${meetingId}`);

      const contextMessages = this.buildDiscussionContext(meeting, agentId, triggerMessage);
      
      const task = {
        title: `参与会议讨论: ${meeting.title}`,
        description: '请对会议中的发言做出回应',
        type: 'discussion',
        priority: 'medium',
        status: 'in_progress',
        assignedAgents: [agentId],
        teamId: meetingId,
        messages: contextMessages,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const response = await this.agentClientService.executeTask(agentId, task as any, {
        teamContext: {
          meetingType: meeting.type,
          meetingTitle: meeting.title,
          agenda: meeting.agenda,
          participants: meeting.participants.map(p => p.participantId),
        },
      });

      const messageType = this.analyzeMessageType(response);

      await this.sendMessage(meetingId, {
        senderId: agentId,
        senderType: 'agent',
        content: response,
        type: messageType,
        metadata: {
          confidence: 0.85,
          relatedMessageId: triggerMessage.id,
        },
      });

    } catch (error) {
      this.logger.error(`Failed to generate response for agent ${agentId}: ${error.message}`);
    }
  }

  /**
   * 构建讨论上下文
   */
  private buildDiscussionContext(
    meeting: Meeting, 
    agentId: string, 
    triggerMessage: MeetingMessage
  ): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const agentParticipant = meeting.participants.find(
      p => p.participantId === agentId && p.participantType === 'agent'
    );

    messages.push({
      role: 'system',
      content: `你正在参加一个会议，会议标题是"${meeting.title}"。
${meeting.agenda ? `会议议程：${meeting.agenda}` : ''}
参与者：${meeting.participants.filter(p => p.isPresent).length}人在场
你的角色：${agentParticipant?.role === ParticipantRole.HOST ? '主持人' : '参与者'}

请根据会议上下文自然地参与讨论。保持专业、建设性的态度，发言要简洁明了。`,
      timestamp: new Date(),
    });

    const recentMessages = meeting.messages.slice(-10);
    for (const msg of recentMessages) {
      messages.push({
        role: msg.senderType === 'agent' ? 'assistant' : 'user',
        content: `${msg.senderId}: ${msg.content}`,
        timestamp: msg.timestamp,
      });
    }

    messages.push({
      role: 'user',
      content: `[新消息] ${triggerMessage.senderId}: ${triggerMessage.content}\n\n请对此做出回应。`,
      timestamp: new Date(),
    });

    const isLatestSearch = this.isLatestModelSearchIntent(triggerMessage.content || '');
    const isModelList = this.isModelListIntent(triggerMessage.content || '');

    if (isLatestSearch) {
      messages.push({
        role: 'system',
        content:
          '当前用户意图是“搜索最新 OpenAI 模型”。请优先联网搜索并返回候选模型与来源，并在结尾明确询问“是否需要添加到系统？”；未收到明确确认前不要执行模型入库。',
        timestamp: new Date(),
      });
    }

    if (isModelList) {
      messages.push({
        role: 'system',
        content:
          '当前用户意图是“查询系统模型列表”。请先调用模型列表工具获取实时数据，再按 name/provider/model/maxTokens 结构回答，不要返回 Agent 列表。',
        timestamp: new Date(),
      });
    }

    return messages;
  }

  /**
   * Agent加入时catch up
   */
  private async catchUpAgent(meetingId: string, participant: ParticipantIdentity): Promise<void> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) return;

    const agent = await this.agentClientService.getAgent(participant.id);
    if (!agent) return;

    const recentMessages = meeting.messages.slice(-5);
    if (recentMessages.length === 0) return;

    const summary = recentMessages.map(m => `${m.senderId}: ${m.content}`).join('\n');

    const prompt = `你刚加入会议。会议目前的讨论如下：\n\n${summary}\n\n请发表一个简短的入场发言（1-2句话）。`;

    const task = {
      title: '加入会议',
      description: prompt,
      type: 'discussion',
      priority: 'low',
      status: 'in_progress',
      assignedAgents: [participant.id],
      teamId: meetingId,
      messages: [{
        role: 'user',
        content: prompt,
        timestamp: new Date(),
      }],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      const response = await this.agentClientService.executeTask(participant.id, task as any);
      await this.sendMessage(meetingId, {
        senderId: participant.id,
        senderType: 'agent',
        content: response,
        type: 'introduction',
      });
    } catch (error) {
      this.logger.error(`Failed to generate catch-up for agent: ${error.message}`);
    }
  }

  /**
   * 添加系统消息
   */
  private async addSystemMessage(meetingId: string, content: string): Promise<void> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) return;

    this.ensureMeetingCompatibility(meeting);

    const message: MeetingMessage = {
      id: uuidv4(),
      senderId: 'system',
      senderType: 'system',
      content,
      type: 'conclusion',
      timestamp: new Date(),
    };

    meeting.messages.push(message);
    meeting.messageCount += 1;
    await meeting.save();

    this.emitEvent(meetingId, {
      type: 'message',
      meetingId,
      data: message,
      timestamp: new Date(),
    });
  }

  /**
   * 生成会议总结
   */
  private async generateMeetingSummary(meetingId: string): Promise<void> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting || meeting.messages.length === 0) return;

    this.ensureMeetingCompatibility(meeting);

    const discussionContent = meeting.messages
      .filter(m => m.senderType !== 'system')
      .map(m => `${m.senderId}: ${m.content}`)
      .join('\n');

    const prompt = `请根据以下会议讨论内容生成一个简洁的会议总结：\n\n会议标题：${meeting.title}\n\n讨论内容：\n${discussionContent}\n\n请提供：\n1. 会议摘要（2-3句话）\n2. 行动项（如果有的话）\n3. 达成的决定（如果有的话）`;

    try {
      // 找到主持人（可能是employee或agent）
      const hostParticipant = meeting.participants.find(
        p => p.participantId === meeting.hostId && p.participantType === meeting.hostType
      );
      
      let summary = '';
      
      if (meeting.hostType === 'agent') {
        const task = {
          title: '生成会议总结',
          description: prompt,
          type: 'analysis',
          priority: 'medium',
          status: 'in_progress',
          assignedAgents: [meeting.hostId],
          teamId: meetingId,
          messages: [{
            role: 'user',
            content: prompt,
            timestamp: new Date(),
          }],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        summary = await this.agentClientService.executeTask(meeting.hostId, task as any);
      } else {
        // 如果是人类主持人，可以提供一个默认总结模板
        summary = `会议 "${meeting.title}" 已结束。\n\n讨论内容涉及多个议题，参与者积极交流。具体行动项和决策请参考会议记录。`;
      }
      
      meeting.summary = {
        content: summary,
        actionItems: [],
        decisions: [],
        generatedAt: new Date(),
      };

      await meeting.save();

      this.emitEvent(meetingId, {
        type: 'summary_generated',
        meetingId,
        data: { summary },
        timestamp: new Date(),
      });

      this.logger.log(`Generated summary for meeting ${meetingId}`);
    } catch (error) {
      this.logger.error(`Failed to generate summary for meeting ${meetingId}: ${error.message}`);
    }
  }

  /**
   * 分析消息类型
   */
  private analyzeMessageType(response: string): MeetingMessage['type'] {
    const lowerResponse = response.toLowerCase();
    
    if (lowerResponse.includes('?') || lowerResponse.includes('？')) {
      return 'question';
    } else if (lowerResponse.includes('同意') || lowerResponse.includes('赞成') || lowerResponse.includes('agree')) {
      return 'agreement';
    } else if (lowerResponse.includes('不同意') || lowerResponse.includes('反对') || lowerResponse.includes('disagree')) {
      return 'disagreement';
    } else if (lowerResponse.includes('建议') || lowerResponse.includes('propose')) {
      return 'suggestion';
    } else if (lowerResponse.includes('总结') || lowerResponse.includes('conclusion')) {
      return 'conclusion';
    }
    
    return 'opinion';
  }

  /**
   * 订阅事件
   */
  subscribeToEvents(meetingId: string, callback: (event: MeetingEvent) => void): void {
    if (!this.eventListeners.has(meetingId)) {
      this.eventListeners.set(meetingId, []);
    }
    this.eventListeners.get(meetingId)!.push(callback);
  }

  unsubscribeFromEvents(meetingId: string, callback: (event: MeetingEvent) => void): void {
    const listeners = this.eventListeners.get(meetingId);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) listeners.splice(index, 1);
    }
  }

  private emitEvent(meetingId: string, event: MeetingEvent): void {
    void this.redisService.publish(`meeting:${meetingId}`, event).catch(() => {
      // ignore redis publish errors
    });

    const listeners = this.eventListeners.get(meetingId);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(event);
        } catch (error) {
          this.logger.error(`Error in event listener: ${error.message}`);
        }
      });
    }
  }
}

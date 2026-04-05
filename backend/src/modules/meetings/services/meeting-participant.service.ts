import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentClientService } from '../../agents-client/agent-client.service';
import { EmployeeService } from '../../employees/employee.service';
import { Agent } from '../../../shared/types';
import { Meeting, MeetingDocument, MeetingStatus, ParticipantRole } from '../../../shared/schemas/meeting.schema';
import { ParticipantContextProfile, ParticipantIdentity } from '../meeting.types';
import { MeetingEventService } from './meeting-event.service';
import { MeetingLifecycleService } from './meeting-lifecycle.service';

@Injectable()
export class MeetingParticipantService {
  private readonly logger = new Logger(MeetingParticipantService.name);
  private readonly modelManagementAgentName = 'model management agent';
  private onAddSystemMessageHook?: (meetingId: string, content: string) => Promise<void>;
  private onAgentJoinedActiveHook?: (meetingId: string, participant: ParticipantIdentity) => Promise<void>;

  constructor(
    @InjectModel(Meeting.name) private readonly meetingModel: Model<MeetingDocument>,
    private readonly agentClientService: AgentClientService,
    private readonly employeeService: EmployeeService,
    private readonly eventService: MeetingEventService,
    private readonly lifecycleService: MeetingLifecycleService,
  ) {}

  setOnAddSystemMessageHook(hook: (meetingId: string, content: string) => Promise<void>): void {
    this.onAddSystemMessageHook = hook;
  }

  setOnAgentJoinedActiveHook(hook: (meetingId: string, participant: ParticipantIdentity) => Promise<void>): void {
    this.onAgentJoinedActiveHook = hook;
  }

  private async addSystemMessage(meetingId: string, content: string): Promise<void> {
    if (!this.onAddSystemMessageHook) return;
    await this.onAddSystemMessageHook(meetingId, content);
  }

  private async catchUpAgent(meetingId: string, participant: ParticipantIdentity): Promise<void> {
    if (!this.onAgentJoinedActiveHook) return;
    await this.onAgentJoinedActiveHook(meetingId, participant);
  }

  async buildParticipantContextProfiles(meeting: Meeting): Promise<ParticipantContextProfile[]> {
    const participants = meeting.participants || [];

    const employeeIds = Array.from(
      new Set(
        participants
          .filter((p) => p.participantType === 'employee' && p.participantId)
          .map((p) => p.participantId),
      ),
    );
    const agentIds = Array.from(
      new Set(
        participants
          .filter((p) => p.participantType === 'agent' && p.participantId)
          .map((p) => p.participantId),
      ),
    );
    const employeeLookup = new Map<string, string>();
    const agentLookup = new Map<string, string>();

    await Promise.all(
      employeeIds.map(async (employeeId) => {
        try {
          const employee = await this.employeeService.getEmployee(employeeId);
          const displayName = employee?.name || employee?.email || employeeId;
          employeeLookup.set(employeeId, displayName);
        } catch {
          employeeLookup.set(employeeId, employeeId);
        }
      }),
    );

    await Promise.all(
      agentIds.map(async (agentId) => {
        try {
          const agent = await this.agentClientService.getAgent(agentId);
          agentLookup.set(agentId, agent?.name || agentId);
        } catch {
          agentLookup.set(agentId, agentId);
        }
      }),
    );

    const uniqueProfiles = new Map<string, ParticipantContextProfile>();
    for (const participant of participants) {
      if (!participant?.participantId || !participant?.participantType) {
        continue;
      }

      const key = `${participant.participantType}:${participant.participantId}`;
      if (uniqueProfiles.has(key)) {
        continue;
      }

      const baseName =
        participant.participantType === 'employee'
          ? employeeLookup.get(participant.participantId) || '参会员工'
          : agentLookup.get(participant.participantId) || '参会Agent';

      uniqueProfiles.set(key, {
        id: participant.participantId,
        type: participant.participantType,
        name: baseName,
        role: participant.role,
        isPresent: Boolean(participant.isPresent),
      });
    }

    return Array.from(uniqueProfiles.values());
  }


  formatParticipantContextSummary(profiles: ParticipantContextProfile[]): string {
    if (profiles.length === 0) {
      return '暂无参会人。';
    }

    return profiles
      .map((profile) => {
        const roleLabel = profile.role === ParticipantRole.HOST ? '主持人' : '参与者';
        const presenceLabel = profile.isPresent ? '在场' : '未在场';
        return `${profile.name}（${roleLabel}，${presenceLabel}）`;
      })
      .join('；');
  }


  buildParticipantDisplayNameMap(profiles: ParticipantContextProfile[]): Map<string, string> {
    const lookup = new Map<string, string>();
    for (const profile of profiles) {
      lookup.set(`${profile.type}:${profile.id}`, profile.name);
    }
    return lookup;
  }


  resolveMessageSenderDisplayName(
    message: { senderId: string; senderType: string },
    nameLookup: Map<string, string>,
  ): string {
    if (message.senderType === 'system') {
      return '系统';
    }

    const key = `${message.senderType}:${message.senderId}`;
    return nameLookup.get(key) || (message.senderType === 'agent' ? '参会Agent' : '参会成员');
  }


  async resolveParticipantDisplayName(
    participantId: string,
    participantType: 'employee' | 'agent',
  ): Promise<string> {
    if (participantType === 'employee') {
      try {
        const employee = await this.employeeService.getEmployee(participantId);
        return employee?.name || employee?.email || '参会员工';
      } catch {
        return '参会员工';
      }
    }

    try {
      const agent = await this.agentClientService.getAgent(participantId);
      return agent?.name || '参会Agent';
    } catch {
      return '参会Agent';
    }
  }


  async appendParticipantContextSystemMessage(
    meeting: MeetingDocument,
    action: 'initialized' | 'updated',
  ): Promise<void> {
    const profiles = await this.buildParticipantContextProfiles(meeting);

    if (action === 'updated') {
      const presentCount = profiles.filter((profile) => profile.isPresent).length;
      await this.addSystemMessage(meeting.id, `参会人上下文已更新：当前参会${presentCount}人`);
      return;
    }

    const summary = this.formatParticipantContextSummary(profiles);
    const actionText = action === 'initialized' ? '已初始化' : '已更新';
    await this.addSystemMessage(meeting.id, `参会人上下文${actionText}：${summary}`);
  }


  private isHiddenAgentForMeeting(agent: Agent | null): boolean {
    if (!agent) {
      return false;
    }

    const normalizedName = String(agent.name || '').toLowerCase().trim();
    if (normalizedName === this.modelManagementAgentName) {
      return true;
    }

    return false;
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

    this.eventService.emitEvent(meeting.id, {
      type: 'settings_changed',
      meetingId: meeting.id,
      data: { title: nextTitle },
      timestamp: new Date(),
    });

    this.logger.log(`Meeting ${meeting.id} title updated after participant expansion: ${nextTitle}`);
    return true;
  }


  async joinMeeting(meetingId: string, participant: ParticipantIdentity): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.lifecycleService.ensureMeetingCompatibility(meeting);

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

    this.eventService.emitEvent(meetingId, {
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

  async leaveMeeting(meetingId: string, participant: ParticipantIdentity): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.lifecycleService.ensureMeetingCompatibility(meeting);

    const p = meeting.participants.find(
      p => p.participantId === participant.id && p.participantType === participant.type
    );
    
    if (p) {
      p.isPresent = false;
      p.leftAt = new Date();
      await meeting.save();
      await this.addSystemMessage(meetingId, `${participant.name} 离开了会议。`);

      this.eventService.emitEvent(meetingId, {
        type: 'participant_left',
        meetingId,
        data: participant,
        timestamp: new Date(),
      });

      this.logger.log(`${participant.name} left meeting ${meetingId}`);
    }

    return meeting;
  }

  async inviteParticipant(
    meetingId: string, 
    participant: ParticipantIdentity, 
    invitedBy: ParticipantIdentity
  ): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.lifecycleService.ensureMeetingCompatibility(meeting);

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

    this.lifecycleService.ensureMeetingCompatibility(meeting);

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
    const addedParticipantName = await this.resolveParticipantDisplayName(participant.id, participant.type);
    await this.addSystemMessage(meetingId, `${addedParticipantName} 被添加为参会人。`);
    await this.appendParticipantContextSystemMessage(meeting, 'updated');
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

    this.lifecycleService.ensureMeetingCompatibility(meeting);

    if (meeting.hostId === participantId && meeting.hostType === participantType) {
      throw new ConflictException('Cannot remove host from participants');
    }

    const participantToRemove = meeting.participants.find(
      (p) => p.participantId === participantId && p.participantType === participantType,
    );
    const removedParticipantName = participantToRemove
      ? await this.resolveParticipantDisplayName(participantId, participantType)
      : participantType === 'agent'
        ? '参会Agent'
        : '参会成员';

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
    await this.addSystemMessage(meetingId, `${removedParticipantName} 已从参会人员中移除。`);
    await this.appendParticipantContextSystemMessage(meeting, 'updated');

    return meeting;
  }
}

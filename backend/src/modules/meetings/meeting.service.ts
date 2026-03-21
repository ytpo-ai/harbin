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
import { MessagesService } from '../messages/messages.service';
import { MEETING_ENDED_EVENT_TYPE } from './meeting-inner-message.constants';

export interface MeetingEvent {
  type: 'message' | 'participant_joined' | 'participant_left' | 'status_changed' | 'typing' | 'summary_generated' | 'settings_changed' | 'agent_state_changed';
  meetingId: string;
  data: any;
  timestamp: Date;
}

type MeetingAgentState = 'thinking' | 'idle';

export interface MeetingAgentStatePayload {
  agentId: string;
  state: MeetingAgentState;
  updatedAt: string;
  reason?: string;
  token?: string;
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

type MeetingParticipantRecord = MeetingDocument['participants'][number];

interface ParticipantContextProfile {
  id: string;
  type: 'employee' | 'agent';
  name: string;
  role: ParticipantRole;
  isPresent: boolean;
  isExclusiveAssistant?: boolean;
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

@Injectable()
export class MeetingService {
  private readonly logger = new Logger(MeetingService.name);
  private eventListeners = new Map<string, ((event: MeetingEvent) => void)[]>();
  private readonly modelManagementAgentName = 'model management agent';
  private readonly meetingAgentStateKeyPrefix = 'meeting:agent-state';
  private readonly meetingAgentStateTtlSeconds = 90;
  private readonly responseDedupWindowMs = 15000;
  private readonly recentResponseKeys = new Map<string, number>();
  private readonly latestModelSearchPhrases = ['搜索最新openai模型', 'search latest openai models'];
  private readonly modelListPhrases = ['当前有哪些模型', 'list models'];
  private readonly memoRecordPhrases = ['记录到备忘录', 'append to memo'];
  private readonly operationLogPhrases = ['查看操作日志', 'operation log'];
  private readonly agentListPhrases = ['查看agent列表', 'list agents'];
  private readonly meetingSummaryEventSenderAgentId = 'meeting-system';

  constructor(
    @InjectModel(Meeting.name) private meetingModel: Model<MeetingDocument>,
    private readonly agentClientService: AgentClientService,
    private readonly employeeService: EmployeeService,
    private readonly redisService: RedisService,
    private readonly messagesService: MessagesService,
  ) {}

  private normalizeSpeakingMode(mode?: string): MeetingSpeakingMode {
    if (mode === 'ordered' || mode === 'sequential' || mode === 'round_robin') {
      return 'ordered';
    }
    return 'free';
  }

  private buildMeetingAgentStateKey(meetingId: string, agentId: string): string {
    return `${this.meetingAgentStateKeyPrefix}:${meetingId}:${agentId}`;
  }

  private buildMeetingAgentStatePattern(meetingId: string): string {
    return `${this.meetingAgentStateKeyPrefix}:${meetingId}:*`;
  }

  private async setAgentState(
    meetingId: string,
    agentId: string,
    state: MeetingAgentState,
    options?: { reason?: string; token?: string },
  ): Promise<void> {
    const updatedAt = new Date().toISOString();
    const payload: MeetingAgentStatePayload = {
      agentId,
      state,
      updatedAt,
      reason: options?.reason,
      token: options?.token,
    };
    const key = this.buildMeetingAgentStateKey(meetingId, agentId);

    if (state === 'thinking') {
      await this.redisService.set(key, JSON.stringify(payload), this.meetingAgentStateTtlSeconds);
    } else {
      await this.redisService.del(key);
    }

    this.emitEvent(meetingId, {
      type: 'agent_state_changed',
      meetingId,
      data: payload,
      timestamp: new Date(),
    });
  }

  private async clearAgentThinking(
    meetingId: string,
    agentId: string,
    options?: { reason?: string; token?: string },
  ): Promise<void> {
    const key = this.buildMeetingAgentStateKey(meetingId, agentId);
    if (options?.token) {
      const raw = await this.redisService.get(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as MeetingAgentStatePayload;
          if (parsed.token && parsed.token !== options.token) {
            return;
          }
        } catch {
          // ignore parse failures and continue clearing stale key
        }
      }
    }

    await this.setAgentState(meetingId, agentId, 'idle', { reason: options?.reason });
  }

  private async clearAllMeetingAgentThinking(meetingId: string, reason: string): Promise<void> {
    const states = await this.getMeetingAgentStates(meetingId);
    await Promise.all(states.map((item) => this.setAgentState(meetingId, item.agentId, 'idle', { reason })));
  }

  private buildResponseDedupKey(meetingId: string, agentId: string, triggerMessage: MeetingMessage): string {
    const triggerId = String(triggerMessage.id || '').trim();
    if (triggerId) {
      return `${meetingId}:${agentId}:${triggerId}`;
    }

    const fallback = [triggerMessage.senderId || '', triggerMessage.timestamp?.toISOString?.() || '', triggerMessage.content || '']
      .join('|')
      .slice(0, 300);
    return `${meetingId}:${agentId}:${fallback}`;
  }

  private shouldProcessResponse(dedupKey: string): boolean {
    const now = Date.now();
    for (const [key, timestamp] of this.recentResponseKeys.entries()) {
      if (now - timestamp > this.responseDedupWindowMs) {
        this.recentResponseKeys.delete(key);
      }
    }

    const existing = this.recentResponseKeys.get(dedupKey);
    if (existing && now - existing <= this.responseDedupWindowMs) {
      return false;
    }

    this.recentResponseKeys.set(dedupKey, now);
    return true;
  }

  private buildMeetingResponseTaskDescription(triggerMessage: MeetingMessage): string {
    const latestMessage = String(triggerMessage.content || '').replace(/\s+/g, ' ').trim();
    if (!latestMessage) {
      return '请对会议中的发言做出回应';
    }

    const maxLen = 180;
    const excerpt = latestMessage.length > maxLen ? `${latestMessage.slice(0, maxLen)}...` : latestMessage;
    return `请对会议中的发言做出回应。最新发言：${excerpt}`;
  }

  private buildMeetingTeamContext(
    meeting: MeetingDocument,
    triggerMessage: MeetingMessage,
    participantProfiles: ParticipantContextProfile[],
  ) {
    return {
      meetingId: meeting.id,
      initiatorId: triggerMessage.senderId,
      meetingType: meeting.type,
      collaborationMode: 'meeting',
      meetingTitle: meeting.title,
      meetingDescription: meeting.description,
      agenda: meeting.agenda,
      participants: meeting.participants.map((p) => p.participantId),
      participantProfiles,
    };
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

  private async buildParticipantContextProfiles(meeting: Meeting): Promise<ParticipantContextProfile[]> {
    const participants = (meeting.participants || []) as MeetingParticipantRecord[];

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
    const assistantOwnerIds = Array.from(
      new Set(
        participants
          .map((p) => (p as MeetingParticipantRecord).assistantForEmployeeId)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const employeeLookup = new Map<string, string>();
    const agentLookup = new Map<string, string>();

    await Promise.all(
      Array.from(new Set([...employeeIds, ...assistantOwnerIds])).map(async (employeeId) => {
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

      const record = participant as MeetingParticipantRecord;
      const baseName =
        participant.participantType === 'employee'
          ? employeeLookup.get(participant.participantId) || '参会员工'
          : agentLookup.get(participant.participantId) || '参会Agent';

      let displayName = baseName;
      if (record.isExclusiveAssistant && record.assistantForEmployeeId) {
        const ownerName = employeeLookup.get(record.assistantForEmployeeId) || record.assistantForEmployeeId;
        displayName = `${ownerName}的专属助理(${baseName})`;
      }

      uniqueProfiles.set(key, {
        id: participant.participantId,
        type: participant.participantType,
        name: displayName,
        role: participant.role,
        isPresent: Boolean(participant.isPresent),
        isExclusiveAssistant: Boolean(record.isExclusiveAssistant),
        assistantForEmployeeId: record.assistantForEmployeeId,
      });
    }

    return Array.from(uniqueProfiles.values());
  }

  private formatParticipantContextSummary(profiles: ParticipantContextProfile[]): string {
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

  private buildParticipantDisplayNameMap(profiles: ParticipantContextProfile[]): Map<string, string> {
    const lookup = new Map<string, string>();
    for (const profile of profiles) {
      lookup.set(`${profile.type}:${profile.id}`, profile.name);
    }
    return lookup;
  }

  private resolveMessageSenderDisplayName(
    message: { senderId: string; senderType: string },
    nameLookup: Map<string, string>,
  ): string {
    if (message.senderType === 'system') {
      return '系统';
    }

    const key = `${message.senderType}:${message.senderId}`;
    return nameLookup.get(key) || (message.senderType === 'agent' ? '参会Agent' : '参会成员');
  }

  private async resolveParticipantDisplayName(
    participantId: string,
    participantType: 'employee' | 'agent',
    meeting?: MeetingDocument,
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
      const agentName = agent?.name || '参会Agent';

      const participant = meeting?.participants.find(
        (p) => p.participantId === participantId && p.participantType === 'agent',
      ) as MeetingParticipantRecord | undefined;

      if (participant?.isExclusiveAssistant && participant.assistantForEmployeeId) {
        const owner = await this.employeeService.getEmployee(participant.assistantForEmployeeId);
        const ownerName = owner?.name || owner?.email || '绑定员工';
        return `${ownerName}的专属助理(${agentName})`;
      }

      return agentName;
    } catch {
      return '参会Agent';
    }
  }

  private async appendParticipantContextSystemMessage(
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

  private async resolveMentionedAgentIds(meeting: MeetingDocument, content: string): Promise<string[]> {
    const tokens = this.extractMentionTokens(content);
    if (tokens.length === 0) {
      return [];
    }

    const presentAgentParticipants = meeting.participants.filter(
      (p) => p.isPresent && p.participantType === 'agent',
    ) as MeetingParticipantRecord[];

    if (presentAgentParticipants.length === 0) {
      return [];
    }

    const mentioned = new Set<string>();
    const uniqueAgentIds = Array.from(new Set(presentAgentParticipants.map((p) => p.participantId)));

    for (const agentId of uniqueAgentIds) {
      const agent = await this.agentClientService.getAgent(agentId);
      const aliases = this.buildMentionAliases(agentId, agent?.name);

      const assistantParticipant = presentAgentParticipants.find(
        (participant) => participant.participantId === agentId && participant.isExclusiveAssistant,
      );

      if (assistantParticipant?.assistantForEmployeeId) {
        const ownerEmployee = await this.employeeService.getEmployee(assistantParticipant.assistantForEmployeeId);
        const ownerName = ownerEmployee?.name || ownerEmployee?.email || assistantParticipant.assistantForEmployeeId;
        const assistantAlias = `${ownerName}的专属助理`.toLowerCase();
        aliases.add(assistantAlias);
        aliases.add(assistantAlias.replace(/\s+/g, ''));
      }

      for (const token of tokens) {
        if (aliases.has(token)) {
          mentioned.add(agentId);
        }
      }
    }

    return Array.from(mentioned);
  }

  private isLatestModelSearchIntent(content: string): boolean {
    return this.hasBracketPhraseIntent(content, this.latestModelSearchPhrases);
  }

  private isModelListIntent(content: string): boolean {
    return this.hasBracketPhraseIntent(content, this.modelListPhrases);
  }

  private isMemoRecordIntent(content: string): boolean {
    return this.hasBracketPhraseIntent(content, this.memoRecordPhrases);
  }

  private isModelManagementIntent(content: string): boolean {
    return this.isLatestModelSearchIntent(content) || this.isModelListIntent(content);
  }

  private isOperationLogIntent(content: string): boolean {
    return this.hasBracketPhraseIntent(content, this.operationLogPhrases);
  }

  private isAgentListIntent(content: string): boolean {
    return this.hasBracketPhraseIntent(content, this.agentListPhrases);
  }

  private hasBracketPhraseIntent(content: string, phrases: string[]): boolean {
    const commands = this.extractBracketCommands(content);
    if (!commands.length) {
      return false;
    }

    const phraseSet = new Set(phrases.map((phrase) => this.normalizeIntentPhrase(phrase)));
    return commands.some((command) => phraseSet.has(command));
  }

  private extractBracketCommands(content: string): string[] {
    const text = String(content || '');
    if (!text) {
      return [];
    }

    const matches = text.matchAll(/[\[【]([^\]】\n]{1,120})[\]】]/g);
    const commands = new Set<string>();
    for (const match of matches) {
      const raw = String(match?.[1] || '');
      const normalized = this.normalizeIntentPhrase(raw);
      if (normalized) {
        commands.add(normalized);
      }
    }
    return Array.from(commands);
  }

  private normalizeIntentPhrase(value: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private formatOperationLogResponse(result: any): string {
    const total = Number(result?.total || 0);
    const logs = Array.isArray(result?.logs) ? result.logs : [];

    if (total === 0 || logs.length === 0) {
      return '目前在系统的操作日志中没有记录。请问您需要查看特定时间段的日志吗？';
    }

    const latest = logs[0];
    const latestTime = latest?.timestamp ? new Date(latest.timestamp).toLocaleString('zh-CN') : '未知时间';
    const latestAction = latest?.action || latest?.resource || '未知操作';

    return [
      `我知道，当前共检索到 ${total} 条与你相关的系统操作日志。`,
      `最近一条是 ${latestTime}，操作为 ${latestAction}。`,
      '如果你需要，我可以继续按时间段或操作类型帮你筛选。',
    ].join('\n');
  }

  private formatAgentListResponse(result: any): string {
    const total = Number(result?.total || 0);
    const visible = Number(result?.visible || 0);
    const agents = Array.isArray(result?.agents) ? result.agents : [];

    if (visible === 0 || agents.length === 0) {
      return '我查到了系统当前没有可见的 Agent。若需要，我可以继续帮你筛选隐藏 Agent 或按角色查询。';
    }

    const rows = agents.slice(0, 8).map((item: any) => {
      const name = String(item?.name || '未命名 Agent');
      const role = String(item?.role || 'unknown-role');
      const status = item?.isActive === true ? 'active' : 'inactive';
      return `- ${name}（${role}，${status}）`;
    });

    return [
      `我知道，当前系统共登记 ${total} 个 Agent，其中可见 ${visible} 个。`,
      '可见 Agent 示例：',
      ...rows,
      rows.length < visible ? `（其余 ${visible - rows.length} 个可继续展开）` : '',
    ]
      .filter((line) => line)
      .join('\n');
  }

  private async respondWithOperationLogSummary(
    meetingId: string,
    meetingTitle: string,
    assistantAgentId: string,
    triggerMessage: MeetingMessage,
  ): Promise<boolean> {
    try {
      const execution = await this.agentClientService.executeToolQuery(
        'human_operation_log_mcp_list',
        assistantAgentId,
        {
          page: 1,
          pageSize: 20,
        },
        {
          source: 'meeting.operation_log_intent',
          context: {
            executionMode: 'chat',
            collaborationContext: {
              meetingId,
              meetingTitle,
            },
          },
        },
      );

      const result = execution?.result || execution?.data?.result;
      const content = this.formatOperationLogResponse(result || {});

      await this.sendMessage(meetingId, {
        senderId: assistantAgentId,
        senderType: 'agent',
        content,
        type: 'conclusion',
        metadata: {
          relatedMessageId: triggerMessage.id,
        },
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown operation log query error';
      this.logger.warn(`Operation log routing failed in meeting ${meetingId}: ${message}`);
      return false;
    }
  }

  private async respondWithAgentListSummary(
    meetingId: string,
    meetingTitle: string,
    responderAgentId: string,
    triggerMessage: MeetingMessage,
  ): Promise<boolean> {
    try {
      const execution = await this.agentClientService.executeToolQuery(
        'agents_mcp_list',
        responderAgentId,
        {
          includeHidden: false,
          limit: 30,
        },
        {
          source: 'meeting.agent_list_intent',
          context: {
            executionMode: 'chat',
            collaborationContext: {
              meetingId,
              meetingTitle,
            },
          },
        },
      );

      const result = execution?.result || execution?.data?.result;
      const content = this.formatAgentListResponse(result || {});

      await this.sendMessage(meetingId, {
        senderId: responderAgentId,
        senderType: 'agent',
        content,
        type: 'conclusion',
        metadata: {
          relatedMessageId: triggerMessage.id,
        },
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown agent list query error';
      this.logger.warn(`Agent list routing failed in meeting ${meetingId}: ${message}`);
      return false;
    }
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
      if (normalizedName === this.modelManagementAgentName) {
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
    await this.clearAllMeetingAgentThinking(meetingId, 'meeting_ended');
    await this.addSystemMessage(meetingId, `会议 "${meeting.title}" 已结束。`);
    await this.publishMeetingEndedSummaryEvent(meeting);

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
    await this.clearAllMeetingAgentThinking(meetingId, 'meeting_paused');

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
    await this.clearAllMeetingAgentThinking(meetingId, 'meeting_archived');

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

    await this.clearAllMeetingAgentThinking(meetingId, 'meeting_deleted');
    await this.messagesService.deleteMessagesByScene('meeting', meetingId);
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

    let participantAssistantId: string | null = null;
    if (participant.type === 'employee') {
      participantAssistantId = await this.getRequiredExclusiveAssistantAgentId(participant.id);
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

    if (participant.type === 'employee' && participantAssistantId) {
      this.upsertExclusiveAssistantParticipant(meeting, participant.id, participantAssistantId, true);
    }

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

    const isHumanProxyMessage = dto.senderType === 'employee';
    let effectiveSenderId = dto.senderId;
    let effectiveSenderType: 'employee' | 'agent' | 'system' = dto.senderType;

    if (isHumanProxyMessage) {
      const assistantAgentId = await this.getRequiredExclusiveAssistantAgentId(dto.senderId);
      effectiveSenderId = assistantAgentId;
      effectiveSenderType = 'agent';
    }

    const isSystemMessage = effectiveSenderType === 'system';

    // Check if sender is host
    const isHost =
      !isSystemMessage &&
      meeting.hostId === effectiveSenderId &&
      (meeting.hostType as 'employee' | 'agent') === effectiveSenderType;

    // Find participant in the meeting
    const participant = isSystemMessage
      ? undefined
      : meeting.participants.find(
          p => p.participantId === effectiveSenderId && p.participantType === effectiveSenderType,
        );

    if (participant && !participant.isPresent) {
      participant.isPresent = true;
      participant.joinedAt = participant.joinedAt || new Date();
    }

    if (!isSystemMessage && !participant && !isHost) {
      throw new ConflictException('Participant is not in the meeting or not present');
    }

    const message: MeetingMessage = {
      id: uuidv4(),
      senderId: effectiveSenderId,
      senderType: effectiveSenderType,
      content: dto.content,
      type: dto.type || 'opinion',
      timestamp: new Date(),
      metadata: {
        ...(dto.metadata || {}),
        ...(isHumanProxyMessage ? {
          isAIProxy: true,
          proxyForEmployeeId: dto.senderId,
          pendingResponsePaused: false,
        } : {}),
      },
    };

    meeting.messages.push(message);
    meeting.messageCount += 1;
    
    // Update participant stats
    if (participant) {
      participant.messageCount += 1;
      participant.hasSpoken = true;
    }
    
    await meeting.save();

    await this.messagesService.appendMessage({
      sceneType: 'meeting',
      sceneId: meetingId,
      senderType: message.senderType,
      senderId: message.senderId,
      content: message.content,
      messageType: message.type,
      metadata: {
        ...(message.metadata || {}),
        meetingId,
      },
      occurredAt: message.timestamp,
      traceId: message.id,
    });

    this.emitEvent(meetingId, {
      type: 'message',
      meetingId,
      data: message,
      timestamp: new Date(),
    });

    // 触发Agent响应（仅在人类发言后触发，避免Agent之间无限互相触发）
    if (isHumanProxyMessage) {
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

    if (participant.type === 'employee') {
      await this.getRequiredExclusiveAssistantAgentId(participant.id);
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

    let participantAssistantId: string | null = null;
    if (!isAgent) {
      participantAssistantId = await this.getRequiredExclusiveAssistantAgentId(participant.id);
    }

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

    if (!isAgent && participantAssistantId) {
      this.upsertExclusiveAssistantParticipant(meeting, participant.id, participantAssistantId, false);
    }

    await meeting.save();
    const addedParticipantName = await this.resolveParticipantDisplayName(participant.id, participant.type, meeting);
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

    this.ensureMeetingCompatibility(meeting);

    if (meeting.hostId === participantId && meeting.hostType === participantType) {
      throw new ConflictException('Cannot remove host from participants');
    }

    const participantToRemove = meeting.participants.find(
      (p) => p.participantId === participantId && p.participantType === participantType,
    );
    const removedParticipantName = participantToRemove
      ? await this.resolveParticipantDisplayName(participantId, participantType, meeting)
      : participantType === 'agent'
        ? '参会Agent'
        : '参会成员';

    const beforeCount = meeting.participants.length;
    meeting.participants = meeting.participants.filter(
      (p) => !(p.participantId === participantId && p.participantType === participantType),
    );

    if (participantType === 'employee') {
      meeting.participants = meeting.participants.filter(
        (p) => !((p as MeetingParticipantRecord).isExclusiveAssistant && (p as MeetingParticipantRecord).assistantForEmployeeId === participantId),
      );
    }

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

  /**
   * 获取会议
   */
  async getMeeting(meetingId: string): Promise<Meeting | null> {
    return this.meetingModel.findOne({ id: meetingId }).exec();
  }

  async getMeetingDetail(meetingId: string): Promise<Meeting | null> {
    return this.getMeeting(meetingId);
  }

  async getMeetingAgentStates(meetingId: string): Promise<MeetingAgentStatePayload[]> {
    const meeting = await this.getMeeting(meetingId);
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    const keys = await this.redisService.keys(this.buildMeetingAgentStatePattern(meetingId));
    if (keys.length === 0) {
      return [];
    }

    const states = await Promise.all(
      keys.map(async (key) => {
        const raw = await this.redisService.get(key);
        if (!raw) {
          return null;
        }
        try {
          return JSON.parse(raw) as MeetingAgentStatePayload;
        } catch {
          return null;
        }
      }),
    );

    return states
      .filter((item): item is MeetingAgentStatePayload => Boolean(item && item.agentId && item.state === 'thinking'))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
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
           p.participantType === 'agent'
    );

    // Backward compatibility: auto-join configured agent participants in old active meetings
    if (presentAgents.length === 0) {
      const standbyAgents = meeting.participants.filter(
        p => !p.isPresent && p.participantType === 'agent',
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

    const exclusiveAssistantParticipants = presentAgents.filter(
      (participant) => Boolean((participant as MeetingParticipantRecord).isExclusiveAssistant),
    );
    const regularAgentParticipants = presentAgents.filter(
      (participant) =>
        !(participant as MeetingParticipantRecord).isExclusiveAssistant &&
        participant.participantId !== triggerMessage.senderId,
    );

    const isMemoRecord = this.isMemoRecordIntent(triggerMessage.content || '');
    const routeToModelManagementAgent = this.isModelManagementIntent(triggerMessage.content || '') && !isMemoRecord;
    if (routeToModelManagementAgent) {
      const modelAgentId = await this.pickModelManagementResponder(regularAgentParticipants);
      if (modelAgentId) {
        presentAgents = regularAgentParticipants.filter((participant) => participant.participantId === modelAgentId);
      } else {
        presentAgents = regularAgentParticipants;
      }
    } else {
      presentAgents = regularAgentParticipants;
    }

    const mentionTokens = this.extractMentionTokens(triggerMessage.content || '');
    const mentionSet = new Set<string>();
    if (mentionTokens.length > 0) {
      const mentionedAgentIds = await this.resolveMentionedAgentIds(meeting, triggerMessage.content || '');

      if (mentionedAgentIds.length === 0) {
        await this.addSystemMessage(meetingId, '未匹配到被 @ 的在场 Agent，请检查名称后重试。');
        return;
      }

      mentionedAgentIds.forEach((id) => mentionSet.add(id));

      presentAgents = presentAgents.filter((p) => mentionedAgentIds.includes(p.participantId));
    }

    const proxyForEmployeeId =
      typeof triggerMessage.metadata?.proxyForEmployeeId === 'string'
        ? triggerMessage.metadata.proxyForEmployeeId
        : undefined;
    const triggerOwnerEmployeeId =
      triggerMessage.senderType === 'employee' ? triggerMessage.senderId : proxyForEmployeeId;

    let exclusiveAssistantResponders: MeetingDocument['participants'] = [];
    if (mentionSet.size > 0 && triggerOwnerEmployeeId) {
      exclusiveAssistantResponders = exclusiveAssistantParticipants.filter((participant) => {
        const ownerEmployeeId = (participant as MeetingParticipantRecord).assistantForEmployeeId;
        if (!ownerEmployeeId || ownerEmployeeId !== triggerOwnerEmployeeId) {
          return false;
        }

        return mentionSet.has(participant.participantId);
      });
    }

    if (this.isOperationLogIntent(triggerMessage.content || '') && exclusiveAssistantResponders.length > 0) {
      const exclusiveAssistant = exclusiveAssistantResponders[0];
      const handled = await this.respondWithOperationLogSummary(
        meetingId,
        meeting.title,
        exclusiveAssistant.participantId,
        triggerMessage,
      );
      if (handled) {
        return;
      }
    }

    if (this.isAgentListIntent(triggerMessage.content || '')) {
      const queryResponderId =
        exclusiveAssistantResponders[0]?.participantId ||
        presentAgents[0]?.participantId ||
        regularAgentParticipants[0]?.participantId;
      if (queryResponderId) {
        const handled = await this.respondWithAgentListSummary(meetingId, meeting.title, queryResponderId, triggerMessage);
        if (handled) {
          return;
        }
      }
    }

    const finalResponders = Array.from(
      new Map(
        [...presentAgents, ...exclusiveAssistantResponders].map((participant) => [participant.participantId, participant] as const),
      ).values(),
    );
    if (finalResponders.length === 0) {
      if (mentionSet.size > 0 && exclusiveAssistantParticipants.length > 0) {
        await this.addSystemMessage(meetingId, '仅可 @ 自己的专属助理，或 @ 其他在场 Agent。');
      }
      return;
    }

    // 每次人类发言后，常规Agent按原策略响应；专属助理仅在主人明确 @ 时响应。
    const responders = [...finalResponders].sort(() => 0.5 - Math.random());
    const responderTasks = responders.map((participant) => ({
      participant,
      token: uuidv4(),
    }));

    await Promise.all(
      responderTasks.map(({ participant, token }) =>
        this.setAgentState(meetingId, participant.participantId, 'thinking', {
          reason: 'awaiting_response',
          token,
        }),
      ),
    );

    for (let i = 0; i < responderTasks.length; i += 1) {
      const current = responderTasks[i];
      const delay = 800 + i * 700 + Math.random() * 500;
      setTimeout(async () => {
        await this.generateAgentResponse(meetingId, current.participant.participantId, triggerMessage, current.token);
      }, delay);
    }
  }

  /**
   * 生成Agent响应
   */
  private async generateAgentResponse(
    meetingId: string, 
    agentId: string, 
    triggerMessage: MeetingMessage,
    stateToken: string,
  ): Promise<void> {
    try {
      const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
      if (!meeting || meeting.status !== MeetingStatus.ACTIVE) return;

      const latestTriggerMessage = this.getMessageById(meeting, triggerMessage.id);
      if (!latestTriggerMessage) {
        this.logger.log(`Skip response because trigger message was removed: ${triggerMessage.id}`);
        return;
      }
      if (latestTriggerMessage.metadata?.pendingResponsePaused) {
        this.logger.log(`Skip response because trigger message is paused: ${triggerMessage.id}`);
        return;
      }

      const agent = await this.agentClientService.getAgent(agentId);
      if (!agent) return;

      this.logger.log(`Generating response for agent ${agent.name} in meeting ${meetingId}`);

      const contextMessages = await this.buildMeetingResponseContext(meeting, triggerMessage);

      const participantProfiles = await this.buildParticipantContextProfiles(meeting);
      
      const task = {
        title: `参与会议讨论: ${meeting.title}`,
        description: this.buildMeetingResponseTaskDescription(triggerMessage),
        type: 'meeting',
        priority: 'medium',
        status: 'in_progress',
        assignedAgents: [agentId],
        teamId: meetingId,
        messages: contextMessages,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const responseDedupKey = this.buildResponseDedupKey(meetingId, agentId, triggerMessage);
      if (!this.shouldProcessResponse(responseDedupKey)) {
        this.logger.log(
          `Skip duplicate meeting response generation: meetingId=${meetingId} agentId=${agentId} triggerMessageId=${triggerMessage.id || 'N/A'}`,
        );
        return;
      }

      const response = await this.agentClientService.executeTask(agentId, task as any, {
        executionMode: 'chat',
        collaborationContext: this.buildMeetingTeamContext(meeting, triggerMessage, participantProfiles),
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
    } finally {
      await this.clearAgentThinking(meetingId, agentId, { reason: 'response_finished', token: stateToken });
    }
  }

  /**
   * 构建讨论上下文
   */
  private async buildMeetingResponseContext(meeting: Meeting, triggerMessage: MeetingMessage): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];

    const participantProfiles = await this.buildParticipantContextProfiles(meeting);
    const participantNameLookup = this.buildParticipantDisplayNameMap(participantProfiles);

    const recentMessages = meeting.messages.slice(-10);
    for (const msg of recentMessages) {
      const senderDisplayName = this.resolveMessageSenderDisplayName(msg, participantNameLookup);
      messages.push({
        role: msg.senderType === 'agent' ? 'assistant' : 'user',
        content: `${senderDisplayName}: ${msg.content}`,
        timestamp: msg.timestamp,
      });
    }

    const triggerSenderName = this.resolveMessageSenderDisplayName(triggerMessage, participantNameLookup);

    let responseInstruction = '请对此做出回应。';
    const isMemoRecord = this.isMemoRecordIntent(triggerMessage.content || '');
    const isLatestSearch = this.isLatestModelSearchIntent(triggerMessage.content || '');
    const isModelList = this.isModelListIntent(triggerMessage.content || '');
    if (isLatestSearch && !isMemoRecord) {
      responseInstruction +=
        ' 当前用户命中了显式短语命令“[搜索最新openai模型]”，请优先联网搜索并返回候选模型与来源，并在结尾明确询问“是否需要添加到系统？”，未收到明确确认前不要执行模型入库。';
    } else if (isModelList && !isMemoRecord) {
      responseInstruction +=
        ' 当前用户命中了显式短语命令“[当前有哪些模型]”，请先调用模型列表工具获取实时数据，再按 name/provider/model/maxTokens 结构回答，不要返回 Agent 列表。';
    }

    messages.push({
      role: 'user',
      content: `[新消息] ${triggerSenderName}: ${triggerMessage.content}\n\n${responseInstruction}`,
      timestamp: new Date(),
    });

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

    const participantProfiles = await this.buildParticipantContextProfiles(meeting);
    const participantNameLookup = this.buildParticipantDisplayNameMap(participantProfiles);
    const summary = recentMessages
      .map((m) => `${this.resolveMessageSenderDisplayName(m, participantNameLookup)}: ${m.content}`)
      .join('\n');

    const prompt = `你刚加入会议。会议目前的讨论如下：\n\n${summary}\n\n请发表一个简短的入场发言（1-2句话）。`;

    const task = {
      title: '加入会议',
      description: prompt,
      type: 'meeting',
      priority: 'low',
      status: 'in_progress',
      assignedAgents: [participant.id],
      teamId: meetingId,
      messages: [
        {
          role: 'user',
          content: prompt,
          timestamp: new Date(),
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      const triggerMessage: MeetingMessage = {
        id: uuidv4(),
        senderId: 'system',
        senderType: 'system',
        content: prompt,
        type: 'introduction',
        timestamp: new Date(),
      };

      const response = await this.agentClientService.executeTask(participant.id, task as any, {
        executionMode: 'chat',
        collaborationContext: this.buildMeetingTeamContext(meeting, triggerMessage, participantProfiles),
      });
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

    await this.messagesService.appendMessage({
      sceneType: 'meeting',
      sceneId: meetingId,
      senderType: 'system',
      senderId: 'system',
      senderRole: 'system',
      content,
      messageType: 'conclusion',
      metadata: {
        meetingId,
      },
      occurredAt: message.timestamp,
      traceId: message.id,
    });

    this.emitEvent(meetingId, {
      type: 'message',
      meetingId,
      data: message,
      timestamp: new Date(),
    });
  }

  private async publishMeetingEndedSummaryEvent(meeting: MeetingDocument): Promise<void> {
    const meetingId = String(meeting?.id || '').trim();
    if (!meetingId) {
      return;
    }

    const endedAt = meeting.endedAt ? new Date(meeting.endedAt).toISOString() : new Date().toISOString();
    const dedupKey = `${MEETING_ENDED_EVENT_TYPE}:${meetingId}:${endedAt}`;

    try {
      await this.agentClientService.publishInnerMessage({
        senderAgentId: this.meetingSummaryEventSenderAgentId,
        eventType: MEETING_ENDED_EVENT_TYPE,
        title: `会议结束：${meeting.title}`,
        content: `会议 ${meetingId} 已结束，请生成会后总结。`,
        payload: {
          meetingId,
          title: meeting.title,
          endedAt,
          hostId: meeting.hostId,
          hostType: meeting.hostType,
          status: meeting.status,
        },
        source: 'meeting-service',
        dedupKey,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to publish meeting ended event for meeting ${meetingId}: ${reason}`);
    }
  }

  async generateMeetingSummary(meetingId: string, payload: SaveMeetingSummaryDto): Promise<{ generated: boolean; reason?: string }> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      return { generated: false, reason: 'meeting_not_found' };
    }

    this.ensureMeetingCompatibility(meeting);

    const summaryContent = String(payload?.summary || '').trim();
    if (!summaryContent) {
      return { generated: false, reason: 'empty_summary' };
    }

    const existingSummaryContent = String(meeting.summary?.content || '').trim();
    if (!payload?.overwrite && existingSummaryContent && meeting.summary?.generatedAt) {
      return { generated: false, reason: 'already_generated' };
    }

    meeting.summary = {
      content: summaryContent,
      actionItems: this.normalizeSummaryItems(payload?.actionItems),
      decisions: this.normalizeSummaryItems(payload?.decisions),
      generatedAt: new Date(),
    };

    await meeting.save();

    this.emitEvent(meetingId, {
      type: 'summary_generated',
      meetingId,
      data: {
        summary: summaryContent,
        generatedByAgentId: String(payload?.generatedByAgentId || '').trim() || undefined,
      },
      timestamp: new Date(),
    });

    this.logger.log(`Generated summary for meeting ${meetingId}`);
    return { generated: true };
  }

  private normalizeSummaryItems(values?: string[]): string[] {
    if (!Array.isArray(values)) {
      return [];
    }
    return values
      .map((item) => String(item || '').trim())
      .filter(Boolean);
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

  private hasAgentRepliedToMessage(meeting: MeetingDocument, messageId: string): boolean {
    return (meeting.messages || []).some((item) => {
      if (!item || item.senderType !== 'agent') {
        return false;
      }
      const metadata = (item.metadata || {}) as Record<string, unknown>;
      return metadata.relatedMessageId === messageId;
    });
  }

  private getMessageById(meeting: MeetingDocument, messageId: string): MeetingDocument['messages'][number] | null {
    const target = (meeting.messages || []).find((item) => item.id === messageId);
    return target || null;
  }

  private assertMessageController(message: MeetingDocument['messages'][number], employeeId: string): void {
    const controllerId = (message.metadata || {}).proxyForEmployeeId;
    if (!controllerId || controllerId !== employeeId) {
      throw new ConflictException('Only the original sender can control this message');
    }
  }

  async pauseMessageResponse(meetingId: string, messageId: string, employeeId: string): Promise<MeetingDocument['messages'][number]> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.ensureMeetingCompatibility(meeting);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new ConflictException('Only active meetings support message pause');
    }

    const message = this.getMessageById(meeting, messageId);
    if (!message) {
      throw new NotFoundException(`Message not found: ${messageId}`);
    }

    this.assertMessageController(message, employeeId);

    if (this.hasAgentRepliedToMessage(meeting, messageId)) {
      throw new ConflictException('Message already has replies and cannot be paused');
    }

    const metadata = {
      ...(message.metadata || {}),
      pendingResponsePaused: true,
      pendingResponsePausedAt: new Date().toISOString(),
    } as Record<string, unknown>;

    message.metadata = metadata as MeetingMessage['metadata'];
    await meeting.save();
    await this.clearAllMeetingAgentThinking(meetingId, 'message_response_paused');

    return message;
  }

  async revokePausedMessage(meetingId: string, messageId: string, employeeId: string): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.ensureMeetingCompatibility(meeting);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new ConflictException('Only active meetings support message revoke');
    }

    const targetMessage = this.getMessageById(meeting, messageId);
    if (!targetMessage) {
      throw new NotFoundException(`Message not found: ${messageId}`);
    }

    this.assertMessageController(targetMessage, employeeId);

    if (!targetMessage.metadata?.pendingResponsePaused) {
      throw new ConflictException('Message must be paused before revoke');
    }

    if (this.hasAgentRepliedToMessage(meeting, messageId)) {
      throw new ConflictException('Message already has replies and cannot be revoked');
    }

    const messageIndex = meeting.messages.findIndex((item) => item.id === messageId);
    if (messageIndex < 0) {
      throw new NotFoundException(`Message not found: ${messageId}`);
    }

    const [removedMessage] = meeting.messages.splice(messageIndex, 1);
    meeting.messageCount = Math.max(0, (meeting.messageCount || 0) - 1);

    const senderParticipant = meeting.participants.find(
      (participant) =>
        participant.participantId === removedMessage.senderId &&
        participant.participantType === removedMessage.senderType,
    );

    if (senderParticipant) {
      senderParticipant.messageCount = Math.max(0, (senderParticipant.messageCount || 0) - 1);
      if (senderParticipant.messageCount === 0) {
        senderParticipant.hasSpoken = false;
      }
    }

    await meeting.save();
    await this.clearAllMeetingAgentThinking(meetingId, 'message_revoked');

    return meeting;
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

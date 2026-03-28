import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { CollaborationContextFactory } from '@libs/contracts';
import { Meeting, MeetingDocument, MeetingMessage, MeetingStatus } from '../../../shared/schemas/meeting.schema';
import { AgentClientService } from '../../agents-client/agent-client.service';
import { Agent, ChatMessage } from '../../../shared/types';
import { MeetingParticipantRecord, ParticipantContextProfile, ParticipantIdentity } from '../meeting.types';
import { MeetingEventService } from './meeting-event.service';
import { MeetingAgentStateService } from './meeting-agent-state.service';
import { MeetingLifecycleService } from './meeting-lifecycle.service';
import { MeetingParticipantService } from './meeting-participant.service';
import { MeetingMessageService } from './meeting-message.service';

@Injectable()
export class MeetingOrchestrationService {
  private readonly logger = new Logger(MeetingOrchestrationService.name);
  private readonly modelManagementAgentName = 'model management agent';
  private readonly responseDedupWindowMs = 15000;
  private readonly recentResponseKeys = new Map<string, number>();
  private readonly latestModelSearchPhrases = ['搜索最新openai模型', 'search latest openai models'];
  private readonly modelListPhrases = ['当前有哪些模型', 'list models'];
  private readonly memoRecordPhrases = ['记录到备忘录', 'append to memo'];
  private readonly operationLogPhrases = ['查看操作日志', 'operation log'];
  private readonly agentListPhrases = ['查看agent列表', 'list agents'];

  constructor(
    @InjectModel(Meeting.name) private readonly meetingModel: Model<MeetingDocument>,
    private readonly agentClientService: AgentClientService,
    private readonly eventService: MeetingEventService,
    private readonly agentStateService: MeetingAgentStateService,
    private readonly lifecycleService: MeetingLifecycleService,
    private readonly participantService: MeetingParticipantService,
    private readonly messageService: MeetingMessageService,
  ) {}

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
    return CollaborationContextFactory.meeting({
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      meetingDescription: meeting.description,
      meetingType: meeting.type,
      agenda: meeting.agenda,
      initiatorId: triggerMessage.senderId,
      participants: meeting.participants.map((p) => ({
        id: p.participantId,
        type: p.participantType === 'employee' ? 'employee' : 'agent',
        role: p.role === 'host' ? 'host' : 'participant',
      })),
      participantProfiles,
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
        const ownerName = await this.participantService.resolveParticipantDisplayName(
          assistantParticipant.assistantForEmployeeId,
          'employee',
        );
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

      await this.messageService.sendMessage(meetingId, {
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

      await this.messageService.sendMessage(meetingId, {
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


  async triggerAgentResponses(meetingId: string, triggerMessage: MeetingMessage): Promise<void> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting || meeting.status !== MeetingStatus.ACTIVE) return;

    this.lifecycleService.ensureMeetingCompatibility(meeting);
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
        await this.messageService.addSystemMessage(meetingId, '未匹配到被 @ 的在场 Agent，请检查名称后重试。');
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
        await this.messageService.addSystemMessage(meetingId, '仅可 @ 自己的专属助理，或 @ 其他在场 Agent。');
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
        this.agentStateService.setAgentState(meetingId, participant.participantId, 'thinking', {
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

  private async generateAgentResponse(
    meetingId: string, 
    agentId: string, 
    triggerMessage: MeetingMessage,
    stateToken: string,
  ): Promise<void> {
    try {
      const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
      if (!meeting || meeting.status !== MeetingStatus.ACTIVE) return;

      const latestTriggerMessage = this.messageService.getMessageById(meeting, triggerMessage.id);
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

      const participantProfiles = await this.participantService.buildParticipantContextProfiles(meeting);
      
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

      const messageType = this.messageService.analyzeMessageType(response);

      await this.messageService.sendMessage(meetingId, {
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
      await this.agentStateService.clearAgentThinking(meetingId, agentId, { reason: 'response_finished', token: stateToken });
    }
  }

  private async buildMeetingResponseContext(meeting: Meeting, triggerMessage: MeetingMessage): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];

    const participantProfiles = await this.participantService.buildParticipantContextProfiles(meeting);
    const participantNameLookup = this.participantService.buildParticipantDisplayNameMap(participantProfiles);

    const recentMessages = meeting.messages.slice(-10);
    for (const msg of recentMessages) {
      const senderDisplayName = this.participantService.resolveMessageSenderDisplayName(msg, participantNameLookup);
      messages.push({
        role: msg.senderType === 'agent' ? 'assistant' : 'user',
        content: `${senderDisplayName}: ${msg.content}`,
        timestamp: msg.timestamp,
      });
    }

    const triggerSenderName = this.participantService.resolveMessageSenderDisplayName(triggerMessage, participantNameLookup);

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

  async catchUpAgent(meetingId: string, participant: ParticipantIdentity): Promise<void> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) return;

    const agent = await this.agentClientService.getAgent(participant.id);
    if (!agent) return;

    const recentMessages = meeting.messages.slice(-5);
    if (recentMessages.length === 0) return;

    const participantProfiles = await this.participantService.buildParticipantContextProfiles(meeting);
    const participantNameLookup = this.participantService.buildParticipantDisplayNameMap(participantProfiles);
    const summary = recentMessages
      .map((m) => `${this.participantService.resolveMessageSenderDisplayName(m, participantNameLookup)}: ${m.content}`)
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
      await this.messageService.sendMessage(meetingId, {
        senderId: participant.id,
        senderType: 'agent',
        content: response,
        type: 'introduction',
      });
    } catch (error) {
      this.logger.error(`Failed to generate catch-up for agent: ${error.message}`);
    }
  }
}

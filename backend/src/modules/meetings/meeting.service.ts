import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Meeting, MeetingDocument, MeetingType, MeetingStatus, ParticipantRole, MeetingMessage } from '../../shared/schemas/meeting.schema';
import { AgentService } from '../agents/agent.service';
import { ChatMessage } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';

export interface MeetingEvent {
  type: 'message' | 'participant_joined' | 'participant_left' | 'status_changed' | 'agent_typing' | 'summary_generated';
  meetingId: string;
  data: any;
  timestamp: Date;
}

export interface CreateMeetingDto {
  title: string;
  description?: string;
  type: MeetingType;
  hostId: string;
  participantIds?: string[];
  agenda?: string;
  scheduledStartTime?: Date;
  settings?: Meeting['settings'];
}

export interface MeetingMessageDto {
  agentId: string;
  content: string;
  type?: MeetingMessage['type'];
  metadata?: MeetingMessage['metadata'];
}

@Injectable()
export class MeetingService {
  private readonly logger = new Logger(MeetingService.name);
  private eventListeners = new Map<string, ((event: MeetingEvent) => void)[]>();
  private agentSpeakingQueue = new Map<string, string[]>(); // meetingId -> agentId[]

  constructor(
    @InjectModel(Meeting.name) private meetingModel: Model<MeetingDocument>,
    private readonly agentService: AgentService,
  ) {}

  /**
   * 创建新会议
   */
  async createMeeting(dto: CreateMeetingDto): Promise<Meeting> {
    const meeting = new this.meetingModel({
      id: uuidv4(),
      title: dto.title,
      description: dto.description,
      type: dto.type,
      status: MeetingStatus.PENDING,
      hostId: dto.hostId,
      participants: [
        {
          agentId: dto.hostId,
          role: ParticipantRole.HOST,
          isPresent: false,
          hasSpoken: false,
          messageCount: 0,
        },
        ...(dto.participantIds || []).map(id => ({
          agentId: id,
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
        speakingOrder: 'free',
        ...dto.settings,
      },
      messages: [],
      invitedAgentIds: [],
      messageCount: 0,
    });

    const saved = await meeting.save();
    this.logger.log(`Created ${dto.type} meeting: ${saved.title} (${saved.id})`);
    
    return saved;
  }

  /**
   * 开始会议
   */
  async startMeeting(meetingId: string, startedBy: string): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    if (meeting.status === MeetingStatus.ACTIVE) {
      throw new ConflictException('Meeting is already active');
    }

    if (meeting.status === MeetingStatus.ENDED) {
      throw new ConflictException('Meeting has already ended');
    }

    meeting.status = MeetingStatus.ACTIVE;
    meeting.startedAt = new Date();
    
    // 主持人自动标记为在场
    const hostParticipant = meeting.participants.find(p => p.agentId === meeting.hostId);
    if (hostParticipant) {
      hostParticipant.isPresent = true;
      hostParticipant.joinedAt = new Date();
    }

    await meeting.save();

    // 添加系统消息
    await this.addSystemMessage(meetingId, `会议 "${meeting.title}" 已开始。`);

    this.emitEvent(meetingId, {
      type: 'status_changed',
      meetingId,
      data: { status: MeetingStatus.ACTIVE, startedBy },
      timestamp: new Date(),
    });

    this.logger.log(`Meeting ${meetingId} started by ${startedBy}`);

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

    meeting.status = MeetingStatus.ENDED;
    meeting.endedAt = new Date();
    
    // 标记所有参与者为离场
    meeting.participants.forEach(p => {
      if (p.isPresent) {
        p.isPresent = false;
        p.leftAt = new Date();
      }
    });

    await meeting.save();

    // 添加系统消息
    await this.addSystemMessage(meetingId, `会议 "${meeting.title}" 已结束。`);

    // 生成会议总结
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

  /**
   * Agent加入会议
   */
  async joinMeeting(meetingId: string, agentId: string): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    if (meeting.status === MeetingStatus.ENDED) {
      throw new ConflictException('Meeting has already ended');
    }

    let participant = meeting.participants.find(p => p.agentId === agentId);
    
    if (!participant) {
      // 如果不在参与者列表中，添加为参与者
      participant = {
        agentId,
        role: ParticipantRole.PARTICIPANT,
        isPresent: true,
        hasSpoken: false,
        messageCount: 0,
        joinedAt: new Date(),
      };
      meeting.participants.push(participant);
    } else {
      participant.isPresent = true;
      participant.joinedAt = new Date();
    }

    // 从邀请列表中移除
    meeting.invitedAgentIds = meeting.invitedAgentIds.filter(id => id !== agentId);

    await meeting.save();

    const agent = await this.agentService.getAgent(agentId);
    await this.addSystemMessage(meetingId, `${agent?.name || agentId} 加入了会议。`);

    this.emitEvent(meetingId, {
      type: 'participant_joined',
      meetingId,
      data: { agentId, agentName: agent?.name },
      timestamp: new Date(),
    });

    this.logger.log(`Agent ${agentId} joined meeting ${meetingId}`);

    // 如果会议进行中，让agent catch up
    if (meeting.status === MeetingStatus.ACTIVE) {
      await this.catchUpAgent(meetingId, agentId);
    }

    return meeting;
  }

  /**
   * Agent离开会议
   */
  async leaveMeeting(meetingId: string, agentId: string): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    const participant = meeting.participants.find(p => p.agentId === agentId);
    if (participant) {
      participant.isPresent = false;
      participant.leftAt = new Date();
      await meeting.save();

      const agent = await this.agentService.getAgent(agentId);
      await this.addSystemMessage(meetingId, `${agent?.name || agentId} 离开了会议。`);

      this.emitEvent(meetingId, {
        type: 'participant_left',
        meetingId,
        data: { agentId, agentName: agent?.name },
        timestamp: new Date(),
      });

      this.logger.log(`Agent ${agentId} left meeting ${meetingId}`);
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

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new ConflictException('Meeting is not active');
    }

    const participant = meeting.participants.find(p => p.agentId === dto.agentId);
    if (!participant || !participant.isPresent) {
      throw new ConflictException('Agent is not a participant or not present in the meeting');
    }

    const message: MeetingMessage = {
      id: uuidv4(),
      agentId: dto.agentId,
      content: dto.content,
      type: dto.type || 'opinion',
      timestamp: new Date(),
      metadata: dto.metadata,
    };

    meeting.messages.push(message);
    meeting.messageCount += 1;
    participant.messageCount += 1;
    participant.hasSpoken = true;
    
    await meeting.save();

    this.emitEvent(meetingId, {
      type: 'message',
      meetingId,
      data: message,
      timestamp: new Date(),
    });

    // 触发其他agent响应
    await this.triggerAgentResponses(meetingId, message);

    return message;
  }

  /**
   * 邀请Agent参加会议
   */
  async inviteAgent(meetingId: string, agentId: string, invitedBy: string): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    // 检查是否已经是参与者
    const existingParticipant = meeting.participants.find(p => p.agentId === agentId);
    if (existingParticipant) {
      throw new ConflictException('Agent is already a participant');
    }

    // 检查是否已经邀请
    if (meeting.invitedAgentIds.includes(agentId)) {
      throw new ConflictException('Agent has already been invited');
    }

    meeting.invitedAgentIds.push(agentId);
    await meeting.save();

    const agent = await this.agentService.getAgent(agentId);
    const inviter = await this.agentService.getAgent(invitedBy);
    
    await this.addSystemMessage(
      meetingId, 
      `${inviter?.name || invitedBy} 邀请了 ${agent?.name || agentId} 参加本次会议。`
    );

    this.logger.log(`Agent ${agentId} invited to meeting ${meetingId} by ${invitedBy}`);

    return meeting;
  }

  /**
   * 获取单个会议
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
   * 获取Agent参与的会议
   */
  async getMeetingsByAgent(agentId: string): Promise<Meeting[]> {
    return this.meetingModel.find({
      $or: [
        { hostId: agentId },
        { 'participants.agentId': agentId },
        { invitedAgentIds: agentId },
      ],
    }).sort({ createdAt: -1 }).exec();
  }

  /**
   * 获取会议统计
   */
  async getMeetingStats(): Promise<any> {
    const total = await this.meetingModel.countDocuments();
    const byType = await this.meetingModel.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);
    const byStatus = await this.meetingModel.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const totalMessages = await this.meetingModel.aggregate([
      { $group: { _id: null, total: { $sum: '$messageCount' } } },
    ]);

    return {
      total,
      byType,
      byStatus,
      totalMessages: totalMessages[0]?.total || 0,
    };
  }

  /**
   * 触发其他agent响应（核心AI讨论逻辑）
   */
  private async triggerAgentResponses(meetingId: string, triggerMessage: MeetingMessage): Promise<void> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting || meeting.status !== MeetingStatus.ACTIVE) return;

    // 获取在场的其他agent
    const presentAgents = meeting.participants.filter(
      p => p.isPresent && p.agentId !== triggerMessage.agentId
    );

    if (presentAgents.length === 0) return;

    // 随机选择1-2个agent响应（避免所有agent同时发言）
    const shuffled = presentAgents.sort(() => 0.5 - Math.random());
    const responders = shuffled.slice(0, Math.min(2, shuffled.length));

    for (const participant of responders) {
      // 延迟响应，模拟真实讨论节奏
      const delay = 1000 + Math.random() * 2000;
      setTimeout(async () => {
        await this.generateAgentResponse(meetingId, participant.agentId, triggerMessage);
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

      const agent = await this.agentService.getAgent(agentId);
      if (!agent) return;

      this.logger.log(`Generating response for agent ${agent.name} in meeting ${meetingId}`);

      // 构建会议上下文
      const contextMessages = this.buildMeetingContext(meeting, agentId, triggerMessage);
      
      // 调用AI模型生成响应
      const task = {
        title: `参与会议讨论: ${meeting.title}`,
        description: `请对会议中的发言做出回应`,
        type: 'discussion',
        priority: 'medium',
        status: 'in_progress',
        assignedAgents: [agentId],
        teamId: meetingId,
        messages: contextMessages,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const response = await this.agentService.executeTask(agentId, task as any, {
        teamContext: {
          meetingType: meeting.type,
          meetingTitle: meeting.title,
          agenda: meeting.agenda,
          participants: meeting.participants.map(p => p.agentId),
        },
      });

      // 分析响应类型
      const messageType = this.analyzeMessageType(response);

      // 发送AI生成的消息
      await this.sendMessage(meetingId, {
        agentId,
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
   * 构建会议上下文
   */
  private buildMeetingContext(
    meeting: Meeting, 
    agentId: string, 
    triggerMessage: MeetingMessage
  ): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const agent = meeting.participants.find(p => p.agentId === agentId);

    // 系统提示
    messages.push({
      role: 'system',
      content: `你正在参加一个${this.getMeetingTypeName(meeting.type)}会议，会议标题是"${meeting.title}"。
${meeting.agenda ? `会议议程：${meeting.agenda}` : ''}
参与者：${meeting.participants.filter(p => p.isPresent).map(p => p.agentId).join(', ')}
你的角色：${agent?.role === ParticipantRole.HOST ? '主持人' : '参与者'}

请根据会议上下文自然地参与讨论。你可以：
- 表达意见和观点
- 提出问题
- 表示同意或不同意
- 给出建议
- 总结讨论要点

请保持专业、建设性的态度，发言要简洁明了。`,
      timestamp: new Date(),
    });

    // 添加最近的10条消息作为上下文
    const recentMessages = meeting.messages.slice(-10);
    for (const msg of recentMessages) {
      messages.push({
        role: msg.agentId === agentId ? 'assistant' : 'user',
        content: `${msg.agentId}: ${msg.content}`,
        timestamp: msg.timestamp,
      });
    }

    // 特别标注触发响应的消息
    messages.push({
      role: 'user',
      content: `[新消息] ${triggerMessage.agentId}: ${triggerMessage.content}\n\n请对此做出回应。`,
      timestamp: new Date(),
    });

    return messages;
  }

  /**
   * Agent catch up（加入时了解会议进展）
   */
  private async catchUpAgent(meetingId: string, agentId: string): Promise<void> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) return;

    const agent = await this.agentService.getAgent(agentId);
    if (!agent) return;

    // 获取最近的5条消息作为总结
    const recentMessages = meeting.messages.slice(-5);
    if (recentMessages.length === 0) return;

    const summary = recentMessages.map(m => `${m.agentId}: ${m.content}`).join('\n');

    // 让agent发表一个简短的入场发言
    const prompt = `你刚加入会议。会议目前的讨论如下：

${summary}

请发表一个简短的入场发言（1-2句话），表示你已加入并简要表达你的立场或期待。`;

    const task = {
      title: '加入会议',
      description: prompt,
      type: 'discussion',
      priority: 'low',
      status: 'in_progress',
      assignedAgents: [agentId],
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
      const response = await this.agentService.executeTask(agentId, task as any);
      
      await this.sendMessage(meetingId, {
        agentId,
        content: response,
        type: 'introduction',
      });
    } catch (error) {
      this.logger.error(`Failed to generate catch-up for agent ${agentId}: ${error.message}`);
    }
  }

  /**
   * 添加系统消息
   */
  private async addSystemMessage(meetingId: string, content: string): Promise<void> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) return;

    const message: MeetingMessage = {
      id: uuidv4(),
      agentId: 'system',
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

    // 构建总结提示
    const discussionContent = meeting.messages
      .filter(m => m.agentId !== 'system')
      .map(m => `${m.agentId}: ${m.content}`)
      .join('\n');

    const prompt = `请根据以下会议讨论内容生成一个简洁的会议总结：

会议标题：${meeting.title}
会议类型：${this.getMeetingTypeName(meeting.type)}

讨论内容：
${discussionContent}

请提供：
1. 会议摘要（2-3句话）
2. 行动项（如果有的话）
3. 达成的决定（如果有的话）`;

    try {
      // 使用host agent生成总结
      const hostAgent = await this.agentService.getAgent(meeting.hostId);
      if (hostAgent) {
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

        const summary = await this.agentService.executeTask(meeting.hostId, task as any);
        
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
      }
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
    } else if (lowerResponse.includes('建议') || lowerResponse.includes('propose') || lowerResponse.includes('建议')) {
      return 'suggestion';
    } else if (lowerResponse.includes('总结') || lowerResponse.includes('conclusion') || lowerResponse.includes('conclude')) {
      return 'conclusion';
    }
    
    return 'opinion';
  }

  /**
   * 获取会议类型名称
   */
  private getMeetingTypeName(type: MeetingType): string {
    const names: Record<MeetingType, string> = {
      [MeetingType.WEEKLY]: '周会',
      [MeetingType.BOARD]: '董事会',
      [MeetingType.DAILY]: '日常讨论',
      [MeetingType.DEPARTMENT]: '部门会议',
      [MeetingType.AD_HOC]: '临时会议',
      [MeetingType.PROJECT]: '项目会议',
      [MeetingType.EMERGENCY]: '紧急会议',
    };
    return names[type] || type;
  }

  /**
   * 订阅会议事件
   */
  subscribeToEvents(meetingId: string, callback: (event: MeetingEvent) => void): void {
    if (!this.eventListeners.has(meetingId)) {
      this.eventListeners.set(meetingId, []);
    }
    this.eventListeners.get(meetingId)!.push(callback);
  }

  /**
   * 取消订阅
   */
  unsubscribeFromEvents(meetingId: string, callback: (event: MeetingEvent) => void): void {
    const listeners = this.eventListeners.get(meetingId);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * 发送事件
   */
  private emitEvent(meetingId: string, event: MeetingEvent): void {
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

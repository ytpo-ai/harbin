import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Discussion, DiscussionDocument } from '../../shared/schemas/discussion.schema';
import { AgentService } from '../agents/agent.service';
import { DiscussionMessage, Task, ChatMessage } from '../../shared/types';
import { RedisService } from '@libs/infra';
import { v4 as uuidv4 } from 'uuid';

export interface DiscussionEvent {
  type: 'message' | 'agent_joined' | 'agent_left' | 'conclusion' | 'pause';
  data: any;
  timestamp: Date;
}

@Injectable()
export class DiscussionService {
  private eventListeners = new Map<string, ((event: DiscussionEvent) => void)[]>();
  private readonly logger = new Logger(DiscussionService.name);

  constructor(
    @InjectModel(Discussion.name) private discussionModel: Model<DiscussionDocument>,
    private readonly agentService: AgentService,
    private readonly redisService: RedisService,
  ) {}

  async createDiscussion(
    taskId: string, 
    participantIds: string[], 
    initialPrompt?: string
  ): Promise<Discussion> {
    const discussion = new this.discussionModel({
      taskId,
      participants: participantIds,
      messages: [],
      status: 'active',
    });

    const savedDiscussion = await discussion.save();

    // 发送加入事件
    for (const agentId of participantIds) {
      this.emitEvent(savedDiscussion.id, {
        type: 'agent_joined',
        data: { agentId },
        timestamp: new Date(),
      });
    }

    // 如果有初始提示，开始讨论
    if (initialPrompt) {
      await this.sendMessage(savedDiscussion.id, 'system', initialPrompt, 'suggestion');
    }

    return savedDiscussion;
  }

  async sendMessage(
    discussionId: string,
    agentId: string,
    content: string,
    type: DiscussionMessage['type'] = 'opinion'
  ): Promise<DiscussionMessage> {
    const discussion = await this.discussionModel.findById(discussionId).exec();
    if (!discussion) {
      throw new NotFoundException(`Discussion not found: ${discussionId}`);
    }

    if (!discussion.participants.includes(agentId)) {
      throw new Error(`Agent ${agentId} is not a participant in discussion ${discussionId}`);
    }

    const message: DiscussionMessage = {
      id: uuidv4(),
      agentId,
      content,
      type,
      timestamp: new Date(),
    };

    discussion.messages.push(message);
    discussion.updatedAt = new Date();
    await discussion.save();

    // 发送消息事件
    this.emitEvent(discussionId, {
      type: 'message',
      data: message,
      timestamp: new Date(),
    });

    // 触发其他agent的响应
    await this.triggerAgentResponses(discussionId, message);

    return message;
  }

  private async triggerAgentResponses(
    discussionId: string, 
    triggerMessage: DiscussionMessage
  ): Promise<void> {
    const discussion = await this.discussionModel.findById(discussionId).exec();
    if (!discussion || discussion.status !== 'active') return;

    // 获取需要响应的agent（排除刚发消息的agent）
    const respondingAgents = discussion.participants.filter(
      agentId => agentId !== triggerMessage.agentId
    );

    // 并行触发多个agent响应
    const responsePromises = respondingAgents.map(async (agentId) => {
      try {
        await this.generateAgentResponse(discussionId, agentId);
      } catch (error) {
        this.logger.error(`Error generating response from agent ${agentId}:`, error);
      }
    });

    await Promise.allSettled(responsePromises);
  }

  private async generateAgentResponse(discussionId: string, agentId: string): Promise<void> {
    const discussion = await this.discussionModel.findById(discussionId).exec();
    if (!discussion) return;

    const agent = await this.agentService.getAgent(agentId);
    if (!agent || !agent.isActive) {
      this.logger.warn(`Agent ${agentId} not found or inactive`);
      return;
    }

    this.logger.log(`Generating response for agent ${agent.name} in discussion ${discussionId}`);

    // 构建讨论上下文
    const discussionContext = this.buildDiscussionContext(discussion, agentId);
    
    // 创建临时任务用于生成响应
    const responseTask: Task = {
      id: uuidv4(),
      title: `参与讨论: ${discussion.taskId}`,
      description: `参与团队讨论，根据当前讨论内容提供你的意见`,
      type: 'discussion',
      priority: 'medium',
      status: 'in_progress',
      assignedAgents: [agentId],
      teamId: discussionId,
      messages: discussionContext,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      // 生成响应 - 这里会调用AI模型
      this.logger.log(`Calling AI model for agent ${agent.name}, model: ${agent.model.id}`);
      
      const response = await this.agentService.executeTask(agentId, responseTask, {
        teamContext: {
          discussionId,
          participants: discussion.participants,
          currentTopic: discussion.messages[discussion.messages.length - 1]?.content,
        },
      });

      this.logger.log(`Agent ${agent.name} responded with ${response.length} characters`);

      // 分析响应类型
      const messageType = this.analyzeMessageType(response);
      
      // 发送响应到讨论
      await this.sendMessage(discussionId, agentId, response, messageType);
    } catch (error) {
      this.logger.error(`Failed to generate response from agent ${agent.name}: ${error.message}`);
      await this.sendMessage(
        discussionId, 
        agentId, 
        `抱歉，我遇到了技术问题: ${error.message}`, 
        'opinion'
      );
    }
  }

  private buildDiscussionContext(discussion: Discussion, agentId: string): ChatMessage[] {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你正在参与一个团队讨论。讨论ID: ${discussion.id}。\n参与者: ${discussion.participants.join(', ')}。\n请根据讨论内容提供你的见解，保持建设性和协作性。\n你可以表达意见、提出问题、表示同意或不同意，或者给出建议。`,
        timestamp: new Date(),
      }
    ];

    // 添加讨论历史
    for (const msg of discussion.messages) {
      const role = msg.agentId === agentId ? 'assistant' as const : 'user' as const;
      const prefix = `[${msg.type}]`;
      messages.push({
        role,
        content: `${prefix} ${msg.content}`,
        timestamp: msg.timestamp,
      });
    }

    return messages;
  }

  private analyzeMessageType(response: string): DiscussionMessage['type'] {
    const lowerResponse = response.toLowerCase();
    
    if (lowerResponse.includes('?')) {
      return 'question';
    } else if (lowerResponse.match(/(同意|赞同|正确|对|是的|没错)/)) {
      return 'agreement';
    } else if (lowerResponse.match(/(不同意、反对、错了、不对、不是)/)) {
      return 'disagreement';
    } else if (lowerResponse.match(/(建议、应该、可以试试、或许)/)) {
      return 'suggestion';
    } else {
      return 'opinion';
    }
  }

  async concludeDiscussion(discussionId: string, summary?: string): Promise<void> {
    const discussion = await this.discussionModel.findById(discussionId).exec();
    if (!discussion) return;

    discussion.status = 'concluded';
    discussion.updatedAt = new Date();
    await discussion.save();

    if (summary) {
      await this.sendMessage(discussionId, 'system', summary, 'conclusion');
    }

    this.emitEvent(discussionId, {
      type: 'conclusion',
      data: { summary },
      timestamp: new Date(),
    });
  }

  async pauseDiscussion(discussionId: string): Promise<void> {
    const discussion = await this.discussionModel.findById(discussionId).exec();
    if (!discussion) return;

    discussion.status = 'paused';
    discussion.updatedAt = new Date();
    await discussion.save();

    this.emitEvent(discussionId, {
      type: 'pause',
      data: {},
      timestamp: new Date(),
    });
  }

  async resumeDiscussion(discussionId: string): Promise<void> {
    const discussion = await this.discussionModel.findById(discussionId).exec();
    if (!discussion) return;

    discussion.status = 'active';
    discussion.updatedAt = new Date();
    await discussion.save();

    // 触发新一轮讨论
    await this.triggerAgentResponses(discussionId, discussion.messages[discussion.messages.length - 1]);
  }

  async getDiscussion(discussionId: string): Promise<Discussion | null> {
    return this.discussionModel.findById(discussionId).exec();
  }

  async getAllDiscussions(): Promise<Discussion[]> {
    return this.discussionModel.find().exec();
  }

  subscribeToEvents(discussionId: string, callback: (event: DiscussionEvent) => void): void {
    if (!this.eventListeners.has(discussionId)) {
      this.eventListeners.set(discussionId, []);
    }
    this.eventListeners.get(discussionId)!.push(callback);
  }

  unsubscribeFromEvents(discussionId: string, callback: (event: DiscussionEvent) => void): void {
    const listeners = this.eventListeners.get(discussionId);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emitEvent(discussionId: string, event: DiscussionEvent): void {
    void this.redisService.publish(`discussion:${discussionId}`, event).catch(() => {
      // ignore redis publish errors
    });

    const listeners = this.eventListeners.get(discussionId);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(event);
        } catch (error) {
          this.logger.error(`Error in event listener:`, error);
        }
      });
    }
  }

  async addParticipant(discussionId: string, agentId: string): Promise<void> {
    const discussion = await this.discussionModel.findById(discussionId).exec();
    if (!discussion) throw new NotFoundException(`Discussion not found: ${discussionId}`);

    if (!discussion.participants.includes(agentId)) {
      discussion.participants.push(agentId);
      discussion.updatedAt = new Date();
      await discussion.save();

      this.emitEvent(discussionId, {
        type: 'agent_joined',
        data: { agentId },
        timestamp: new Date(),
      });

      // 给新加入的agent发送上下文
      await this.catchUpAgent(discussionId, agentId);
    }
  }

  private async catchUpAgent(discussionId: string, agentId: string): Promise<void> {
    const discussion = await this.discussionModel.findById(discussionId).exec();
    if (!discussion) return;

    const discussionContext = this.buildDiscussionContext(discussion, agentId);
    
    const responseTask: Task = {
      id: uuidv4(),
      title: `加入讨论: ${discussion.taskId}`,
      description: `你刚刚加入了这个讨论，请了解当前情况并参与讨论`,
      type: 'discussion',
      priority: 'medium',
      status: 'in_progress',
      assignedAgents: [agentId],
      teamId: discussionId,
      messages: discussionContext,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.agentService.executeTask(agentId, responseTask, {
      teamContext: {
        discussionId,
        participants: discussion.participants,
        isJoining: true,
      },
    });
  }
}

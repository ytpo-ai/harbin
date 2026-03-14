import { BadRequestException, Body, Controller, Get, Patch, Param, Post, Query } from '@nestjs/common';
import { AgentMessagesService } from './agent-messages.service';

@Controller('agent-messages')
export class AgentMessagesController {
  constructor(private readonly agentMessagesService: AgentMessagesService) {}

  @Post('direct')
  async sendDirect(
    @Body()
    payload: {
      senderAgentId: string;
      receiverAgentId: string;
      eventType?: string;
      title: string;
      content: string;
      payload?: Record<string, any>;
      source?: string;
      dedupKey?: string;
      maxAttempts?: number;
    },
  ) {
    const message = await this.agentMessagesService.sendDirectMessage({
      senderAgentId: payload.senderAgentId,
      receiverAgentId: payload.receiverAgentId,
      eventType: payload.eventType || 'agent.direct',
      title: payload.title,
      content: payload.content,
      payload: payload.payload,
      source: payload.source,
      dedupKey: payload.dedupKey,
      maxAttempts: payload.maxAttempts,
    });

    return {
      success: true,
      data: message,
    };
  }

  @Post('publish')
  async publish(
    @Body()
    payload: {
      senderAgentId: string;
      eventType: string;
      title: string;
      content: string;
      payload?: Record<string, any>;
      source?: string;
      dedupKey?: string;
      maxAttempts?: number;
    },
  ) {
    const result = await this.agentMessagesService.publishMessage(payload);
    return {
      success: true,
      data: result,
    };
  }

  @Patch(':messageId/ack')
  async acknowledge(
    @Param('messageId') messageId: string,
    @Body() payload: { receiverAgentId: string; status?: 'delivered' | 'processing' },
  ) {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId) {
      throw new BadRequestException('messageId is required');
    }

    const receiverAgentId = String(payload?.receiverAgentId || '').trim();
    if (!receiverAgentId) {
      throw new BadRequestException('receiverAgentId is required');
    }

    const status = payload?.status || 'delivered';
    if (!['delivered', 'processing'].includes(status)) {
      throw new BadRequestException('status must be delivered or processing');
    }

    const updated = await this.agentMessagesService.acknowledgeMessage(normalizedMessageId, receiverAgentId, status);
    return {
      success: true,
      data: updated,
    };
  }

  @Patch(':messageId/processed')
  async processed(
    @Param('messageId') messageId: string,
    @Body() payload: { receiverAgentId: string; result?: Record<string, any> },
  ) {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId) {
      throw new BadRequestException('messageId is required');
    }

    const receiverAgentId = String(payload?.receiverAgentId || '').trim();
    if (!receiverAgentId) {
      throw new BadRequestException('receiverAgentId is required');
    }

    const updated = await this.agentMessagesService.markMessageProcessed(normalizedMessageId, receiverAgentId, payload?.result);
    return {
      success: true,
      data: updated,
    };
  }
}

@Controller('agent-message-subscriptions')
export class AgentMessageSubscriptionsController {
  constructor(private readonly agentMessagesService: AgentMessagesService) {}

  @Post()
  async createOrUpdate(
    @Body()
    payload: {
      subscriberAgentId: string;
      eventType: string;
      filters?: Record<string, any>;
      isActive?: boolean;
      source?: string;
    },
  ) {
    const subscription = await this.agentMessagesService.createOrUpdateSubscription(payload);
    return {
      success: true,
      data: subscription,
    };
  }

  @Get()
  async list(
    @Query('subscriberAgentId') subscriberAgentId?: string,
    @Query('eventType') eventType?: string,
    @Query('isActive') isActive?: string,
  ) {
    const normalizedIsActive =
      typeof isActive === 'string'
        ? isActive.toLowerCase() === 'true'
          ? true
          : isActive.toLowerCase() === 'false'
            ? false
            : undefined
        : undefined;

    const data = await this.agentMessagesService.listSubscriptions({
      subscriberAgentId,
      eventType,
      isActive: normalizedIsActive,
    });

    return {
      success: true,
      data,
    };
  }
}

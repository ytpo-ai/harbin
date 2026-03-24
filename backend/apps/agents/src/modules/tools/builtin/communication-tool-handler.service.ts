import { Injectable } from '@nestjs/common';
import { ComposioService } from '../composio.service';
import { InternalApiClient } from '../internal-api-client.service';

@Injectable()
export class CommunicationToolHandler {
  constructor(
    private readonly composioService: ComposioService,
    private readonly internalApiClient: InternalApiClient,
  ) {}

  async sendInternalMessage(
    params: {
      receiverAgentId?: string;
      title?: string;
      content?: string;
      eventType?: string;
      payload?: Record<string, unknown>;
      dedupKey?: string;
      maxAttempts?: number;
    },
    agentId?: string,
  ): Promise<any> {
    const senderAgentId = String(agentId || '').trim();
    if (!senderAgentId) {
      throw new Error('send_internal_message requires execution agentId');
    }

    const receiverAgentId = String(params?.receiverAgentId || '').trim();
    const title = String(params?.title || '').trim();
    const content = String(params?.content || '').trim();
    const eventType = String(params?.eventType || '').trim() || 'inner.direct';
    if (!receiverAgentId) {
      throw new Error('send_internal_message requires receiverAgentId');
    }
    if (!title || !content) {
      throw new Error('send_internal_message requires title and content');
    }

    const payload =
      params?.payload && typeof params.payload === 'object' && !Array.isArray(params.payload)
        ? params.payload
        : {};
    const maxAttempts = Number(params?.maxAttempts || 0);
    const response = await this.internalApiClient.callInnerMessageApi('POST', '/direct', {
      senderAgentId,
      receiverAgentId,
      eventType,
      title,
      content,
      payload,
      source: 'agent-mcp.send_internal_message',
      ...(params?.dedupKey ? { dedupKey: String(params.dedupKey).trim() } : {}),
      ...(Number.isFinite(maxAttempts) && maxAttempts > 0 ? { maxAttempts: Math.floor(maxAttempts) } : {}),
    });

    const message = response?.data || response;
    const messageId = String(message?.messageId || '').trim();
    return {
      action: 'send_internal_message',
      sent: Boolean(messageId),
      messageId,
      status: String(message?.status || 'sent').trim() || 'sent',
      senderAgentId,
      receiverAgentId,
      eventType,
      sentAt: message?.sentAt || new Date().toISOString(),
      raw: message,
    };
  }
  async sendSlackMessage(params: { channel: string; text: string }, userId?: string): Promise<any> {
    if (!params?.channel || !params?.text) {
      throw new Error('slack requires parameters: channel, text');
    }

    const result = await this.composioService.slackSendMessage(params.channel, params.text, userId);
    if (!result.successful) {
      throw new Error(result.error || 'Composio slack send failed');
    }

    return {
      provider: 'composio/slack',
      status: 'sent',
      channel: params.channel,
      text: params.text,
      raw: result.data,
    };
  }
  async sendGmail(
    params: { to: string; subject: string; body: string; action?: 'draft' | 'send' },
    userId?: string,
  ): Promise<any> {
    if (!params?.to || !params?.subject || !params?.body) {
      throw new Error('gmail requires parameters: to, subject, body');
    }

    const action = params.action || 'send';
    const result = await this.composioService.gmailSendEmail(
      params.to,
      params.subject,
      params.body,
      action,
      userId,
    );

    if (!result.successful) {
      throw new Error(result.error || 'Composio gmail send failed');
    }

    return {
      provider: 'composio/gmail',
      status: action === 'draft' ? 'drafted' : 'sent',
      to: params.to,
      subject: params.subject,
      action,
      raw: result.data,
    };
  }}

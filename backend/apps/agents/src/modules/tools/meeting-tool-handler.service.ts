import { Injectable } from '@nestjs/common';
import { InternalApiClient } from './internal-api-client.service';
import { ToolExecutionContext } from './tool-execution-context.type';

@Injectable()
export class MeetingToolHandler {
  constructor(private readonly internalApiClient: InternalApiClient) {}

  private resolveMeetingContext(executionContext?: ToolExecutionContext): {
    meetingId?: string;
  } {
    const teamContext = executionContext?.teamContext || {};
    return {
      meetingId:
        (typeof teamContext.meetingId === 'string' && teamContext.meetingId) ||
        (typeof executionContext?.teamId === 'string' && executionContext.teamId) ||
        undefined,
    };
  }

  async listMeetings(params: { status?: string; limit?: number }): Promise<any> {
    const queryParams = new URLSearchParams();
    if (params?.status) {
      queryParams.append('status', params.status);
    }
    if (params?.limit) {
      queryParams.append('limit', String(params.limit));
    }

    const endpoint = queryParams.toString() ? `?${queryParams.toString()}` : '';
    const result = await this.internalApiClient.callMeetingApi('GET', endpoint);

    const meetings = Array.isArray(result)
      ? result.map((item: any) => {
          if (!item || typeof item !== 'object') return item;
          const { messages, ...lightweight } = item;
          return lightweight;
        })
      : [];

    return {
      action: 'list_meetings',
      total: meetings.length,
      meetings,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getMeetingDetail(params: { meetingId?: string }): Promise<any> {
    if (!params?.meetingId?.trim()) {
      throw new Error('meeting_get_detail requires meetingId');
    }

    const meetingId = params.meetingId.trim();
    const result = await this.internalApiClient.callMeetingApi('GET', `/${meetingId}/detail`);
    const meeting = result?.data || result;

    return {
      action: 'get_detail',
      meetingId,
      meeting,
      fetchedAt: new Date().toISOString(),
    };
  }

  async sendMeetingMessage(
    params: { meetingId?: string; content?: string; type?: string },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    if (!params?.meetingId?.trim()) {
      throw new Error('meeting_send_message requires meetingId');
    }
    if (!params?.content?.trim()) {
      throw new Error('meeting_send_message requires content');
    }

    const meetingContext = this.resolveMeetingContext(executionContext);
    const meetingId = params.meetingId.trim();
    const sendAsAgent = Boolean(agentId && meetingContext.meetingId && meetingContext.meetingId === meetingId);

    const payload = {
      senderId: sendAsAgent ? agentId : 'system',
      senderType: sendAsAgent ? 'agent' : 'system',
      content: params.content.trim(),
      type: params.type || 'opinion',
    };

    const result = await this.internalApiClient.callMeetingApi('POST', `/${meetingId}/messages`, payload);

    return {
      action: 'send_message',
      meetingId,
      senderId: payload.senderId,
      message: result,
      sentAt: new Date().toISOString(),
    };
  }

  async updateMeetingStatus(params: { meetingId?: string; action?: string }): Promise<any> {
    if (!params?.meetingId?.trim()) {
      throw new Error('meeting_update_status requires meetingId');
    }
    if (!params?.action?.trim()) {
      throw new Error('meeting_update_status requires action');
    }

    const action = params.action.trim().toLowerCase();
    const validActions = ['start', 'end', 'pause', 'resume'];
    if (!validActions.includes(action)) {
      throw new Error(`Invalid action: ${action}. Must be one of: ${validActions.join(', ')}`);
    }

    const result = await this.internalApiClient.callMeetingApi('POST', `/${params.meetingId.trim()}/${action}`);

    return {
      action: 'update_status',
      meetingId: params.meetingId,
      previousStatus: result?.previousStatus,
      newStatus: result?.status || action,
      updatedAt: new Date().toISOString(),
    };
  }

  async saveMeetingSummary(
    params: {
      meetingId?: string;
      summary?: string;
      actionItems?: string[];
      decisions?: string[];
      overwrite?: boolean;
    },
    agentId?: string,
  ): Promise<any> {
    if (!params?.meetingId?.trim()) {
      throw new Error('meeting_save_summary requires meetingId');
    }
    if (!params?.summary?.trim()) {
      throw new Error('meeting_save_summary requires summary');
    }

    const meetingId = params.meetingId.trim();
    const result = await this.internalApiClient.callMeetingApi('PUT', `/${meetingId}/summary`, {
      summary: params.summary.trim(),
      actionItems: Array.isArray(params.actionItems) ? params.actionItems : [],
      decisions: Array.isArray(params.decisions) ? params.decisions : [],
      overwrite: Boolean(params.overwrite),
      generatedByAgentId: agentId,
    });
    const summaryResult = result?.data || result;

    return {
      action: 'save_summary',
      meetingId,
      generated: Boolean(summaryResult?.generated),
      reason: summaryResult?.reason,
      processedAt: new Date().toISOString(),
    };
  }
}

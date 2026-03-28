import {
  ChatCollaborationContext,
  CollaborationContext,
  InnerMessageCollaborationContext,
  MeetingCollaborationContext,
  OrchestrationCollaborationContext,
  ResponseDirective,
} from './collaboration-context.types';

export class CollaborationContextFactory {
  static orchestration(params: {
    planId: string;
    roleInPlan: OrchestrationCollaborationContext['roleInPlan'];
    skillActivation?: { mode: 'standard' | 'precise' };
    agentTier?: OrchestrationCollaborationContext['agentTier'];
    collaborators?: OrchestrationCollaborationContext['collaborators'];
    delegationRules?: OrchestrationCollaborationContext['delegationRules'];
    currentTaskId?: string;
    currentTaskTitle?: string;
    executorAgentId?: string;
    dependencies?: unknown;
    upstreamOutputs?: unknown;
  }): OrchestrationCollaborationContext {
    return {
      scenarioMode: 'orchestration',
      responseDirective: 'json-only',
      ...params,
    };
  }

  static meeting(params: {
    meetingId: string;
    meetingTitle?: string;
    meetingDescription?: string;
    meetingType?: string;
    agenda?: string;
    participants?: MeetingCollaborationContext['participants'];
    participantProfiles?: MeetingCollaborationContext['participantProfiles'];
    commandPriority?: MeetingCollaborationContext['commandPriority'];
    initiatorId?: string;
    responseDirective?: ResponseDirective;
  }): MeetingCollaborationContext {
    const { responseDirective = 'text', ...rest } = params;
    return {
      scenarioMode: 'meeting',
      responseDirective,
      collaborationMode: 'meeting',
      ...rest,
    };
  }

  static innerMessage(params: {
    messageId?: string;
    eventType?: string;
    senderAgentId?: string;
    triggerSource?: string;
    meetingId?: string;
    planId?: string;
    scheduleId?: string;
    runtimeTaskType?: 'internal_message' | 'scheduled_task';
    requireJsonResponse?: boolean;
  }): InnerMessageCollaborationContext {
    const { requireJsonResponse = true, ...rest } = params;
    return {
      scenarioMode: 'inner-message',
      responseDirective: requireJsonResponse ? 'json-only' : 'text',
      ...rest,
    };
  }

  static chat(params?: {
    initiator?: ChatCollaborationContext['initiator'];
  }): ChatCollaborationContext {
    return {
      scenarioMode: 'chat',
      responseDirective: 'text',
      ...(params || {}),
    };
  }

  static fromLegacy(raw: Record<string, unknown>): CollaborationContext {
    if (raw.scenarioMode && typeof raw.scenarioMode === 'string') {
      return raw as unknown as CollaborationContext;
    }

    if (raw.meetingId && (raw.collaborationMode === 'meeting' || raw.meetingTitle)) {
      return {
        scenarioMode: 'meeting',
        responseDirective: 'text',
        ...raw,
      } as MeetingCollaborationContext;
    }

    if (raw.planId) {
      const roleInPlan = String(raw.roleInPlan || 'executor');
      return {
        scenarioMode: 'orchestration',
        responseDirective: 'json-only',
        planId: String(raw.planId),
        roleInPlan: roleInPlan as OrchestrationCollaborationContext['roleInPlan'],
        ...raw,
      } as OrchestrationCollaborationContext;
    }

    return {
      scenarioMode: 'chat',
      responseDirective: 'text',
      ...raw,
    } as ChatCollaborationContext;
  }
}

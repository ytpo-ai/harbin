import {
  ChatCollaborationContext,
  CollaborationContext,
  DiscussionCollaborationContext,
  InnerMessageCollaborationContext,
  MeetingCollaborationContext,
  OrchestrationCollaborationContext,
  ResponseDirective,
} from './collaboration-context.types';

export class CollaborationContextFactory {
  static orchestration(params: {
    planId: string;
    initiatorId?: string;
    roleInPlan: OrchestrationCollaborationContext['roleInPlan'];
    responseDirective?: OrchestrationCollaborationContext['responseDirective'];
    skillActivation?: { mode: 'standard' | 'precise'; skillIds?: string[] };
    agentTier?: OrchestrationCollaborationContext['agentTier'];
    collaborators?: OrchestrationCollaborationContext['collaborators'];
    delegationRules?: OrchestrationCollaborationContext['delegationRules'];
    currentTaskId?: string;
    currentTaskTitle?: string;
    executorAgentId?: string;
    dependencies?: unknown;
    upstreamOutputs?: unknown;
    domainType?: OrchestrationCollaborationContext['domainType'];
    phase?: OrchestrationCollaborationContext['phase'];
    taskType?: string;
    projectId?: string;
    projectBinding?: OrchestrationCollaborationContext['projectBinding'];
  }): OrchestrationCollaborationContext {
    const { responseDirective = 'json-only', ...rest } = params;
    return {
      scenarioMode: 'orchestration',
      responseDirective,
      ...rest,
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

  static discussion(params: {
    discussionSpaceId: string;
    discussionThreadId?: string;
    discussionMessageId?: string;
    initiatorId?: string;
    participantId?: string;
    responseDirective?: DiscussionCollaborationContext['responseDirective'];
  }): DiscussionCollaborationContext {
    const { responseDirective = 'text', ...rest } = params;
    return {
      scenarioMode: 'discussion',
      responseDirective,
      collaborationMode: 'discussion',
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

    if (
      raw.discussionSpaceId ||
      raw.discussionThreadId ||
      raw.collaborationMode === 'discussion' ||
      raw.scene === 'discussion'
    ) {
      const patched: Record<string, unknown> = { ...raw };
      // Normalize legacy field names: spaceId → discussionSpaceId, threadId → discussionThreadId
      if (!patched.discussionSpaceId && patched.spaceId) {
        patched.discussionSpaceId = patched.spaceId;
      }
      if (!patched.discussionThreadId && patched.threadId) {
        patched.discussionThreadId = patched.threadId;
      }
      return {
        scenarioMode: 'discussion',
        responseDirective: 'text',
        ...patched,
      } as DiscussionCollaborationContext;
    }

    return {
      scenarioMode: 'chat',
      responseDirective: 'text',
      ...raw,
    } as ChatCollaborationContext;
  }
}

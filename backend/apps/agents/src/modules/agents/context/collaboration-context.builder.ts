import { Injectable } from '@nestjs/common';
import { ChatMessage } from '../../../../../../src/shared/types';
import { ContextBlockBuilder, ContextBuildInput } from './context-block-builder.interface';

@Injectable()
export class CollaborationContextBuilder implements ContextBlockBuilder {
  readonly layer = 'collaboration' as const;

  shouldInject(input: ContextBuildInput): boolean {
    if (input.scenarioType === 'orchestration' || input.scenarioType === 'meeting') {
      return true;
    }
    return Boolean(input.persistedContext?.collaborationContext || input.context.collaborationContext);
  }

  async build(input: ContextBuildInput): Promise<ChatMessage[]> {
    if (input.scenarioType === 'meeting') {
      const meeting = (input.persistedContext?.collaborationContext || input.context.collaborationContext || {}) as Record<string, unknown>;
      return [{
        role: 'system',
        content: `协作上下文(会议): ${JSON.stringify({
          meetingTitle: meeting.meetingTitle,
          meetingType: meeting.meetingType,
          agenda: meeting.agenda,
          participants: meeting.participantProfiles || meeting.participants,
          commandPriority: {
            highestAuthority: 'human_host_or_owner',
            exclusiveAssistantOverride: true,
          },
        })}`,
        timestamp: new Date(),
      }];
    }

    if (input.scenarioType === 'orchestration') {
      const orchestration = (input.persistedContext?.collaborationContext || input.context.collaborationContext || {}) as Record<string, unknown>;
      return [{
        role: 'system',
        content: `协作上下文(编排): ${JSON.stringify({
          agentTier: orchestration.agentTier || 'operations',
          roleInPlan: orchestration.roleInPlan || 'execute_assigned_task',
          collaborators: orchestration.collaborators || [],
          delegationRules: orchestration.delegationRules || {
            canDelegateTo: ['operations', 'temporary'],
            cannotDelegateTo: ['leadership'],
          },
          upstreamOutputs: orchestration.upstreamOutputs || orchestration.dependencyContext || '',
        })}`,
        timestamp: new Date(),
      }];
    }

    const chat = (input.persistedContext?.collaborationContext || input.context.collaborationContext || {}) as Record<string, unknown>;
    if (!Object.keys(chat).length) return [];
    return [{
      role: 'system',
      content: `协作上下文(聊天): ${JSON.stringify(chat)}`,
      timestamp: new Date(),
    }];
  }
}

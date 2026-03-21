import { Injectable } from '@nestjs/common';
import { ChatMessage } from '../../../../../../src/shared/types';
import { ContextBlockBuilder, ContextBuildInput } from './context-block-builder.interface';
import { ContextFingerprintService } from './context-fingerprint.service';

@Injectable()
export class CollaborationContextBuilder implements ContextBlockBuilder {
  readonly layer = 'collaboration' as const;
  readonly meta = { scope: 'run', stability: 'semi-static' } as const;

  constructor(private readonly contextFingerprintService: ContextFingerprintService) {}

  shouldInject(input: ContextBuildInput): boolean {
    if (input.scenarioType === 'orchestration' || input.scenarioType === 'meeting') {
      return true;
    }
    return Boolean(input.persistedContext?.collaborationContext || input.context.collaborationContext);
  }

  async build(input: ContextBuildInput): Promise<ChatMessage[]> {
    if (input.scenarioType === 'meeting') {
      const meeting = (input.persistedContext?.collaborationContext || input.context.collaborationContext || {}) as Record<string, unknown>;
      const participantProfiles = Array.isArray(meeting.participantProfiles) ? (meeting.participantProfiles as Array<Record<string, unknown>>) : [];
      const participantCount = participantProfiles.length || (Array.isArray(meeting.participants) ? meeting.participants.length : 0);
      const meetingTitle = String(meeting.meetingTitle || '').trim();
      const meetingDescription = String(meeting.meetingDescription || '').trim();
      const agenda = String(meeting.agenda || '').trim();
      const roleInMeeting =
        participantProfiles.find((profile) => String(profile.id || '') === String(input.agent.id || '').trim())?.role || 'participant';
      const fullContent =
        `你正在参加一个会议，会议标题是"${meetingTitle || '未命名会议'}"。\n` +
        `${meetingDescription ? `会议描述：${meetingDescription}\n` : ''}` +
        `${agenda ? `会议议程：${agenda}\n` : ''}` +
        `参与者：${participantCount}人在场\n` +
        `你的角色：${roleInMeeting === 'host' ? '主持人' : '参与者'}\n\n` +
        `协作上下文(会议): ${JSON.stringify({
          meetingId: meeting.meetingId,
          meetingTitle,
          meetingType: meeting.meetingType,
          agenda,
          participants: participantProfiles.length ? participantProfiles : meeting.participants,
          commandPriority: {
            highestAuthority: 'human_host_or_owner',
            exclusiveAssistantOverride: true,
          },
        })}`;
      const resolvedContent = await this.contextFingerprintService.resolveSystemContextBlockContent({
        scope: input.contextScope,
        blockType: 'collaboration',
        fullContent,
        snapshot: {
          meetingId: String(meeting.meetingId || '').trim(),
          participantCount,
          agendaId: String(meeting.agendaId || '').trim(),
        },
      });
      if (!resolvedContent) {
        return [];
      }
      return [{ role: 'system', content: resolvedContent, timestamp: new Date() }];
    }

    if (input.scenarioType === 'orchestration') {
      const orchestration = (input.persistedContext?.collaborationContext || input.context.collaborationContext || {}) as Record<string, unknown>;
      const upstreamOutputs = orchestration.upstreamOutputs || orchestration.dependencyContext || '';
      const fullContent = `协作上下文(编排): ${JSON.stringify({
        agentTier: orchestration.agentTier || 'operations',
        roleInPlan: orchestration.roleInPlan || 'execute_assigned_task',
        collaborators: orchestration.collaborators || [],
        delegationRules: orchestration.delegationRules || {
          canDelegateTo: ['operations', 'temporary'],
          cannotDelegateTo: ['leadership'],
        },
        upstreamOutputs,
      })}`;
      const resolvedContent = await this.contextFingerprintService.resolveSystemContextBlockContent({
        scope: input.contextScope,
        blockType: 'collaboration',
        fullContent,
        snapshot: {
          planId: String(orchestration.planId || '').trim(),
          collaboratorCount: Array.isArray(orchestration.collaborators) ? orchestration.collaborators.length : 0,
          upstreamOutputHash: this.contextFingerprintService.hashFingerprint(JSON.stringify(upstreamOutputs)),
        },
      });
      if (!resolvedContent) {
        return [];
      }
      return [{ role: 'system', content: resolvedContent, timestamp: new Date() }];
    }

    const chat = (input.persistedContext?.collaborationContext || input.context.collaborationContext || {}) as Record<string, unknown>;
    if (!Object.keys(chat).length) return [];
    const fullContent = `协作上下文(聊天): ${JSON.stringify(chat)}`;
    const resolvedContent = await this.contextFingerprintService.resolveSystemContextBlockContent({
      scope: input.contextScope,
      blockType: 'collaboration',
      fullContent,
      snapshot: {
        chatHash: this.contextFingerprintService.hashFingerprint(JSON.stringify(chat)),
      },
    });
    if (!resolvedContent) {
      return [];
    }
    return [{ role: 'system', content: resolvedContent, timestamp: new Date() }];
  }
}

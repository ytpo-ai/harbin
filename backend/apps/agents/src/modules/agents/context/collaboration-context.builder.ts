import { Injectable } from '@nestjs/common';
import { CollaborationContext, CollaborationContextFactory } from '@libs/contracts';
import { ChatMessage } from '../../../../../../src/shared/types';
import { ContextBlockBuilder, ContextBuildInput } from './context-block-builder.interface';
import { ContextFingerprintService } from './context-fingerprint.service';

const JSON_ONLY_DIRECTIVE = [
  '[输出格式约束] 当前为结构化 JSON 输出模式。',
  '回复必须是合法 JSON 对象，以 { 开头 } 结尾。',
  '非 JSON 内容将被系统丢弃。',
].join('\n');

const JSON_PREFERRED_DIRECTIVE = [
  '[输出格式偏好] 优先以 JSON 对象格式回复。',
  '如确需自然语言说明，可在 JSON 的 "message" 字段中附加。',
].join('\n');

@Injectable()
export class CollaborationContextBuilder implements ContextBlockBuilder {
  readonly layer = 'collaboration' as const;
  readonly meta = { scope: 'run', stability: 'semi-static' } as const;

  constructor(private readonly contextFingerprintService: ContextFingerprintService) {}

  shouldInject(input: ContextBuildInput): boolean {
    if (input.scenarioType === 'orchestration' || input.scenarioType === 'meeting' || input.scenarioType === 'inner-message') {
      return true;
    }
    return Boolean(input.persistedContext?.collaborationContext || input.context.collaborationContext);
  }

  async build(input: ContextBuildInput): Promise<ChatMessage[]> {
    const resolvedContext = this.resolveCollaborationContext(input);
    const scenarioType = this.resolveScenarioType(input, resolvedContext);

    if (scenarioType === 'meeting') {
      const meeting = resolvedContext as Record<string, unknown>;
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

    if (scenarioType === 'orchestration') {
      const orchestration = resolvedContext as Record<string, unknown>;
      const upstreamOutputs = orchestration.upstreamOutputs || orchestration.dependencyContext || '';
      const contentParts: string[] = [
        `协作上下文(编排): ${JSON.stringify({
          agentTier: orchestration.agentTier || 'operations',
          roleInPlan: orchestration.roleInPlan || 'executor',
          collaborators: orchestration.collaborators || [],
          delegationRules: orchestration.delegationRules || {
            canDelegateTo: ['operations', 'temporary'],
            cannotDelegateTo: ['leadership'],
          },
          upstreamOutputs,
        })}`,
      ];
      this.pushResponseDirectiveConstraint(contentParts, orchestration);

      const fullContent = contentParts.join('\n');
      const resolvedContent = await this.contextFingerprintService.resolveSystemContextBlockContent({
        scope: input.contextScope,
        blockType: 'collaboration',
        fullContent,
        snapshot: {
          planId: String(orchestration.planId || '').trim(),
          collaboratorCount: Array.isArray(orchestration.collaborators) ? orchestration.collaborators.length : 0,
          upstreamOutputHash: this.contextFingerprintService.hashFingerprint(JSON.stringify(upstreamOutputs)),
          responseDirective: String(orchestration.responseDirective || '').trim() || undefined,
        },
      });
      if (!resolvedContent) {
        return [];
      }
      return [{ role: 'system', content: resolvedContent, timestamp: new Date() }];
    }

    if (scenarioType === 'inner-message') {
      const inner = resolvedContext as Record<string, unknown>;
      const contentParts: string[] = [
        `协作上下文(内部消息): ${JSON.stringify({
          messageId: inner.messageId,
          eventType: inner.eventType,
          triggerSource: inner.triggerSource,
          senderAgentId: inner.senderAgentId,
          runtimeTaskType: inner.runtimeTaskType,
          meetingId: inner.meetingId,
          planId: inner.planId,
        })}`,
      ];
      this.pushResponseDirectiveConstraint(contentParts, inner);

      const fullContent = contentParts.join('\n');
      const resolvedContent = await this.contextFingerprintService.resolveSystemContextBlockContent({
        scope: input.contextScope,
        blockType: 'collaboration',
        fullContent,
        snapshot: {
          messageId: String(inner.messageId || '').trim() || undefined,
          eventType: String(inner.eventType || '').trim() || undefined,
          runtimeTaskType: String(inner.runtimeTaskType || '').trim() || undefined,
        },
      });
      if (!resolvedContent) {
        return [];
      }
      return [{ role: 'system', content: resolvedContent, timestamp: new Date() }];
    }

    const chat = resolvedContext as Record<string, unknown>;
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

  private resolveCollaborationContext(input: ContextBuildInput): CollaborationContext | Record<string, unknown> {
    const raw = (input.persistedContext?.collaborationContext || input.context.collaborationContext || {}) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') {
      return {};
    }
    return CollaborationContextFactory.fromLegacy(raw);
  }

  private resolveScenarioType(
    input: ContextBuildInput,
    context: CollaborationContext | Record<string, unknown>,
  ): ContextBuildInput['scenarioType'] {
    if ('scenarioMode' in context) {
      const scenarioMode = String((context as CollaborationContext).scenarioMode || '').trim();
      if (scenarioMode === 'meeting' || scenarioMode === 'orchestration' || scenarioMode === 'inner-message' || scenarioMode === 'chat') {
        return scenarioMode;
      }
    }
    return input.scenarioType;
  }

  private pushResponseDirectiveConstraint(contentParts: string[], context: Record<string, unknown>): void {
    const responseDirective = String(context.responseDirective || '').trim();
    if (responseDirective === 'json-only') {
      contentParts.push(JSON_ONLY_DIRECTIVE);
      return;
    }
    if (responseDirective === 'json-preferred') {
      contentParts.push(JSON_PREFERRED_DIRECTIVE);
      return;
    }
    if (String(context.format || '').trim() === 'json') {
      contentParts.push(JSON_ONLY_DIRECTIVE);
    }
  }
}

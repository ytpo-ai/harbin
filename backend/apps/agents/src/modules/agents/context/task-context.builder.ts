import { Injectable } from '@nestjs/common';
import { AGENT_PROMPTS } from '@agent/modules/prompt-registry/agent-prompt-catalog';
import { ChatMessage } from '../../../../../../src/shared/types';
import { ContextBlockBuilder, ContextBuildInput } from './context-block-builder.interface';
import { ContextFingerprintService } from './context-fingerprint.service';
import { ContextPromptService } from './context-prompt.service';

@Injectable()
export class TaskContextBuilder implements ContextBlockBuilder {
  readonly layer = 'task' as const;
  readonly meta = { scope: 'run', stability: 'semi-static' } as const;

  constructor(
    private readonly contextPromptService: ContextPromptService,
    private readonly contextFingerprintService: ContextFingerprintService,
  ) {}

  shouldInject(input: ContextBuildInput): boolean {
    return input.scenarioType === 'orchestration' || input.scenarioType === 'meeting';
  }

  async build(input: ContextBuildInput): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];
    const meetingLikeTask = input.scenarioType === 'meeting';

    if (!meetingLikeTask) {
      const descAlreadyInHistory =
        input.task.description &&
        input.task.description.length > 50 &&
        input.context.previousMessages.some(
          (msg) =>
            msg.role === 'user' &&
            typeof msg.content === 'string' &&
            msg.content.includes(input.task.description.slice(0, 100)),
        );
      const taskInfoSnapshot = {
        title: String(input.task.title || '').trim(),
        description: String(input.task.description || '').trim(),
        type: String(input.task.type || '').trim(),
        priority: String(input.task.priority || '').trim(),
      };
      const fullTaskInfoContent = descAlreadyInHistory
        ? `任务信息:\n标题: ${taskInfoSnapshot.title}\n类型: ${taskInfoSnapshot.type}\n优先级: ${taskInfoSnapshot.priority}`
        : `任务信息:\n标题: ${taskInfoSnapshot.title}\n描述: ${taskInfoSnapshot.description}\n类型: ${taskInfoSnapshot.type}\n优先级: ${taskInfoSnapshot.priority}`;
      const taskInfoContent = await this.contextFingerprintService.resolveSystemContextBlockContent({
        scope: input.contextScope,
        blockType: 'task-info',
        fullContent: fullTaskInfoContent,
        snapshot: taskInfoSnapshot,
        buildDelta: (previous, current) => this.contextFingerprintService.buildTaskInfoDelta(previous as any, current as any),
        deltaPrefix: '任务信息增量更新：',
      });
      if (taskInfoContent) {
        messages.push({ role: 'system', content: taskInfoContent, timestamp: new Date() });
      }
      return messages;
    }

    const meetingExecutionPolicyTemplate = await this.contextPromptService.resolvePromptTemplate(
      AGENT_PROMPTS.defaultMeetingExecutionPolicyPrompt,
    );
    const meetingExecutionPolicy = await this.contextFingerprintService.resolveSystemContextBlockContent({
      scope: input.contextScope,
      blockType: 'meeting-execution-policy',
      fullContent: meetingExecutionPolicyTemplate.content,
      snapshot: {
        version: 'context-module',
        templateVersion: meetingExecutionPolicyTemplate.version || 'code-default',
        templateSource: meetingExecutionPolicyTemplate.source,
        contentHash: this.contextFingerprintService.hashFingerprint(meetingExecutionPolicyTemplate.content),
      },
    });
    if (meetingExecutionPolicy) {
      messages.push({
        role: 'system',
        content: meetingExecutionPolicy,
        timestamp: new Date(),
        metadata: {
          promptSlug: AGENT_PROMPTS.defaultMeetingExecutionPolicyPrompt.slug,
        },
      });
    }
    return messages;
  }
}

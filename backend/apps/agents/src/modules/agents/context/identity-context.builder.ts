import { Injectable } from '@nestjs/common';
import { AGENT_PROMPTS } from '@agent/modules/prompt-registry/agent-prompt-catalog';
import { ChatMessage } from '../../../../../../src/shared/types';
import { ContextBlockBuilder, ContextBuildInput } from './context-block-builder.interface';

@Injectable()
export class IdentityContextBuilder implements ContextBlockBuilder {
  readonly layer = 'identity' as const;

  shouldInject(): boolean {
    return true;
  }

  async build(input: ContextBuildInput): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];
    messages.push({
      role: 'system',
      content: await input.helpers.resolvePromptContent(AGENT_PROMPTS.agentWorkingGuideline),
      timestamp: new Date(),
    });
    messages.push({
      role: 'system',
      content: input.agent.systemPrompt,
      timestamp: new Date(),
    });

    if (!input.identityMemos.length) {
      return messages;
    }

    const identityContent = input.identityMemos
      .map((memo) => {
        const content = String(memo.content || '');
        const topic = memo.payload?.topic ? String(memo.payload.topic) : '';
        return `## ${memo.title}${topic ? ` (${topic})` : ''}\n\n${content}`;
      })
      .join('\n\n---\n\n');

    const identitySnapshot = input.identityMemos
      .map((memo) => ({
        title: String(memo.title || '').trim(),
        topic: memo.payload?.topic ? String(memo.payload.topic).trim() : '',
        contentHash: input.helpers.hashFingerprint(String(memo.content || '')),
      }))
      .sort((a, b) => `${a.title}:${a.topic}`.localeCompare(`${b.title}:${b.topic}`));

    const identityMessage = await input.helpers.resolveSystemContextBlockContent({
      scope: input.contextScope,
      blockType: 'identity',
      fullContent: `【身份与职责】以下是你的身份定义，请始终以此为准：\n\n${identityContent}`,
      snapshot: { items: identitySnapshot },
      buildDelta: (previous, current) =>
        input.helpers.buildIdentityMemoDelta(
          Array.isArray((previous as any)?.items) ? (previous as any).items : [],
          Array.isArray((current as any)?.items) ? (current as any).items : [],
        ),
      deltaPrefix: '【身份与职责增量更新】',
    });

    if (identityMessage) {
      messages.push({ role: 'system', content: identityMessage, timestamp: new Date() });
    }
    return messages;
  }
}

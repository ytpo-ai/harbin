import { Injectable } from '@nestjs/common';
import { ChatMessage } from '../../../../../../src/shared/types';
import { buildSystemContextKey, normalizeSystemContent } from './context-fingerprint.util';
import { ContextBlockBuilder, ContextBuildInput } from './context-block-builder.interface';
import { IdentityContextBuilder } from './identity-context.builder';
import { ToolsetContextBuilder } from './toolset-context.builder';
import { DomainContextBuilder } from './domain-context.builder';
import { CollaborationContextBuilder } from './collaboration-context.builder';
import { TaskContextBuilder } from './task-context.builder';
import { MemoryContextBuilder } from './memory-context.builder';

@Injectable()
export class ContextAssemblerService {
  constructor(
    private readonly identityBuilder: IdentityContextBuilder,
    private readonly toolsetBuilder: ToolsetContextBuilder,
    private readonly domainBuilder: DomainContextBuilder,
    private readonly collaborationBuilder: CollaborationContextBuilder,
    private readonly taskBuilder: TaskContextBuilder,
    private readonly memoryBuilder: MemoryContextBuilder,
  ) {}

  private get builders(): ContextBlockBuilder[] {
    return [
      this.identityBuilder,
      this.toolsetBuilder,
      this.domainBuilder,
      this.collaborationBuilder,
      this.taskBuilder,
      this.memoryBuilder,
    ];
  }

  async assemble(input: ContextBuildInput): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];

    for (const builder of this.builders) {
      if (builder.shouldInject(input)) {
        const blockMessages = await builder.build(input);
        messages.push(...blockMessages);
      }
    }

    const injectedSystemContents = new Set<string>();
    const injectedContextKeys = new Set<string>();
    for (const message of messages) {
      if (message.role !== 'system') continue;
      const normalized = normalizeSystemContent(String(message.content || ''));
      if (!normalized) continue;
      injectedSystemContents.add(normalized);
      const contextKey = buildSystemContextKey(normalized);
      if (contextKey) {
        injectedContextKeys.add(contextKey);
      }
    }

    const previousSystemMessages = (input.context.previousMessages || []).filter((message) => message?.role === 'system');
    const previousNonSystemMessages = (input.context.previousMessages || []).filter((message) => message?.role !== 'system');

    const uniquePreviousSystemMessages = previousSystemMessages.filter((message) => {
      const normalized = normalizeSystemContent(String(message?.content || ''));
      if (!normalized) return false;
      if (injectedSystemContents.has(normalized)) return false;

      const contextKey = buildSystemContextKey(normalized);
      if (contextKey && injectedContextKeys.has(contextKey)) return false;

      injectedSystemContents.add(normalized);
      if (contextKey) {
        injectedContextKeys.add(contextKey);
      }
      return true;
    });

    messages.push(...uniquePreviousSystemMessages);
    messages.push(...previousNonSystemMessages);
    return messages;
  }
}

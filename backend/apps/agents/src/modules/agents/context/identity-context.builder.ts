import { Injectable } from '@nestjs/common';
import { AGENT_PROMPTS } from '@agent/modules/prompt-registry/agent-prompt-catalog';
import { ChatMessage } from '../../../../../../src/shared/types';
import { ContextBlockBuilder, ContextBuildInput } from './context-block-builder.interface';
import { ContextFingerprintService } from './context-fingerprint.service';
import { ContextPromptService } from './context-prompt.service';
import { PromptResolverService } from '@agent/modules/prompt-registry/prompt-resolver.service';

@Injectable()
export class IdentityContextBuilder implements ContextBlockBuilder {
  readonly layer = 'identity' as const;
  readonly meta = { scope: 'run', stability: 'semi-static' } as const;

  constructor(
    private readonly contextPromptService: ContextPromptService,
    private readonly contextFingerprintService: ContextFingerprintService,
    private readonly promptResolverService: PromptResolverService,
  ) {}

  shouldInject(): boolean {
    return true;
  }

  async build(input: ContextBuildInput): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];
    const guidelineContent = await this.contextPromptService.resolvePromptContent(AGENT_PROMPTS.agentWorkingGuideline);
    const systemPromptContent = String(input.agent.systemPrompt || '').trim();
    const agentPromptTemplateRef = this.normalizePromptTemplateRef((input.agent as any).promptTemplateRef);
    const agentPromptTemplateContent = await this.resolvePromptTemplateRefContent(agentPromptTemplateRef, '');
    const identityBaseFullContent = [guidelineContent, systemPromptContent, agentPromptTemplateContent]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join('\n\n');
    const identityBaseSnapshot = {
      guidelineHash: this.contextFingerprintService.hashFingerprint(guidelineContent),
      systemPromptHash: this.contextFingerprintService.hashFingerprint(systemPromptContent),
      promptTemplateHash: this.contextFingerprintService.hashFingerprint(agentPromptTemplateContent),
    };
    const identityBaseContent = await this.contextFingerprintService.resolveSystemContextBlockContent({
      scope: input.contextScope,
      blockType: 'identity-base',
      fullContent: identityBaseFullContent,
      snapshot: identityBaseSnapshot,
    });
    if (identityBaseContent) {
      messages.push({
        role: 'system',
        content: guidelineContent,
        timestamp: new Date(),
        metadata: {
          promptSlug: AGENT_PROMPTS.agentWorkingGuideline.slug,
        },
      });
      if (systemPromptContent) {
        messages.push({
          role: 'system',
          content: systemPromptContent,
          timestamp: new Date(),
        });
      }
      if (agentPromptTemplateContent) {
        messages.push({
          role: 'system',
          content: agentPromptTemplateContent,
          timestamp: new Date(),
        });
      }
    }

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
        contentHash: this.contextFingerprintService.hashFingerprint(String(memo.content || '')),
      }))
      .sort((a, b) => `${a.title}:${a.topic}`.localeCompare(`${b.title}:${b.topic}`));

    const identityMessage = await this.contextFingerprintService.resolveSystemContextBlockContent({
      scope: input.contextScope,
      blockType: 'identity',
      fullContent: `【身份与职责】以下是你的身份定义，请始终以此为准：\n\n${identityContent}`,
      snapshot: { items: identitySnapshot },
      buildDelta: (previous, current) =>
        this.contextFingerprintService.buildIdentityMemoDelta(
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

  private normalizePromptTemplateRef(input: unknown): { scene: string; role: string } | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return null;
    }
    const scene = String((input as any).scene || '').trim();
    const role = String((input as any).role || '').trim();
    if (!scene || !role) {
      return null;
    }
    return { scene, role };
  }

  private async resolvePromptTemplateRefContent(
    ref: { scene: string; role: string } | null,
    defaultContent: string,
  ): Promise<string> {
    if (!ref) {
      return defaultContent;
    }

    try {
      const resolved = await this.promptResolverService.resolve({
        scene: ref.scene,
        role: ref.role,
        defaultContent,
        cacheOnly: true,
      });
      return String(resolved.content || '').trim();
    } catch {
      return defaultContent;
    }
  }
}

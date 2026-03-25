import { Injectable } from '@nestjs/common';
import { ChatMessage } from '../../../../../../src/shared/types';
import { ContextBlockBuilder, ContextBuildInput } from './context-block-builder.interface';
import { ContextFingerprintService } from './context-fingerprint.service';

@Injectable()
export class DomainContextBuilder implements ContextBlockBuilder {
  readonly layer = 'domain' as const;
  readonly meta = { scope: 'run', stability: 'static' } as const;

  constructor(private readonly contextFingerprintService: ContextFingerprintService) {}

  shouldInject(input: ContextBuildInput): boolean {
    return Boolean(input.persistedContext?.domainContext?.domainType || input.persistedContext?.domainContext?.description);
  }

  async build(input: ContextBuildInput): Promise<ChatMessage[]> {
    const domain = input.persistedContext?.domainContext || {
      domainType: 'general',
      description: '通用对话任务',
    };

    const constraints = Array.isArray(domain.constraints) && domain.constraints.length
      ? `\n约束:\n${domain.constraints.map((item) => `- ${item}`).join('\n')}`
      : '';
    const refs = Array.isArray(domain.knowledgeRefs) && domain.knowledgeRefs.length
      ? `\n知识引用:\n${domain.knowledgeRefs.map((item) => `- ${item}`).join('\n')}`
      : '';

    const content = `业务领域上下文:\n- domainType: ${domain.domainType || 'general'}\n- description: ${domain.description || ''}${constraints}${refs}`;
    const resolvedContent = await this.contextFingerprintService.resolveSystemContextBlockContent({
      scope: input.contextScope,
      blockType: 'domain',
      fullContent: content,
      snapshot: {
        domainType: String(domain.domainType || 'general').trim(),
        descriptionHash: this.contextFingerprintService.hashFingerprint(String(domain.description || '')),
        constraintCount: Array.isArray(domain.constraints) ? domain.constraints.length : 0,
        refCount: Array.isArray(domain.knowledgeRefs) ? domain.knowledgeRefs.length : 0,
      },
    });
    if (!resolvedContent) {
      return [];
    }

    return [{ role: 'system', content: resolvedContent, timestamp: new Date() }];
  }
}

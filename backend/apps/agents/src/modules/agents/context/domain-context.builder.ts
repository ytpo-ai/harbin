import { Injectable } from '@nestjs/common';
import { ChatMessage } from '../../../../../../src/shared/types';
import { inferDomainTypeFromText } from '../../../../../../src/shared/domain-context/domain-type.util';
import { ContextBlockBuilder, ContextBuildInput } from './context-block-builder.interface';

@Injectable()
export class DomainContextBuilder implements ContextBlockBuilder {
  readonly layer = 'domain' as const;

  shouldInject(input: ContextBuildInput): boolean {
    if (input.scenarioType === 'orchestration') {
      return true;
    }
    return Boolean(input.persistedContext?.domainContext?.domainType || input.persistedContext?.domainContext?.description);
  }

  async build(input: ContextBuildInput): Promise<ChatMessage[]> {
    const fallbackDomainType = this.resolveFallbackDomainType(input);
    const domain = input.persistedContext?.domainContext || {
      domainType: fallbackDomainType,
      description: input.scenarioType === 'orchestration' ? '执行编排任务并完成交付' : '通用对话任务',
    };

    const constraints = Array.isArray(domain.constraints) && domain.constraints.length
      ? `\n约束:\n${domain.constraints.map((item) => `- ${item}`).join('\n')}`
      : '';
    const refs = Array.isArray(domain.knowledgeRefs) && domain.knowledgeRefs.length
      ? `\n知识引用:\n${domain.knowledgeRefs.map((item) => `- ${item}`).join('\n')}`
      : '';

    return [{
      role: 'system',
      content: `业务领域上下文:\n- domainType: ${domain.domainType || 'general'}\n- description: ${domain.description || ''}${constraints}${refs}`,
      timestamp: new Date(),
    }];
  }

  private resolveFallbackDomainType(input: ContextBuildInput): string {
    return inferDomainTypeFromText({
      prompt: `${input.task.title || ''} ${input.task.description || ''} ${input.task.type || ''}`,
    });
  }
}

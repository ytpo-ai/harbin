import { Injectable } from '@nestjs/common';
import { AgentPromptTemplate } from '@agent/modules/prompt-registry/agent-prompt-catalog';
import { PromptResolverService } from '@agent/modules/prompt-registry/prompt-resolver.service';

@Injectable()
export class ContextPromptService {
  constructor(private readonly promptResolverService: PromptResolverService) {}

  async resolvePromptTemplate<TPayload>(
    template: AgentPromptTemplate<TPayload>,
    payload?: TPayload,
  ): Promise<{ content: string; source: 'session_override' | 'db_published' | 'redis_cache' | 'code_default'; version?: number }> {
    const buildDefaultContent = template.buildDefaultContent as unknown as (input?: TPayload) => string;
    const defaultContent = buildDefaultContent(payload);
    const resolved = await this.promptResolverService.resolve({
      scene: template.scene,
      role: template.role,
      defaultContent,
      cacheOnly: true,
    });
    return {
      content: resolved.content,
      source: resolved.source,
      version: resolved.version,
    };
  }

  async resolvePromptContent<TPayload>(template: AgentPromptTemplate<TPayload>, payload?: TPayload): Promise<string> {
    const resolved = await this.resolvePromptTemplate(template, payload);
    return resolved.content;
  }
}

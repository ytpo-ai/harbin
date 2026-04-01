import { Injectable } from '@nestjs/common';
import { ContextBlockBuilder, ContextBuildInput, AssembledContext } from './context-block-builder.interface';
import { IdentityContextBuilder } from './identity-context.builder';
import { ToolsetContextBuilder } from './toolset-context.builder';
import { DomainContextBuilder } from './domain-context.builder';
import { CollaborationContextBuilder } from './collaboration-context.builder';
import { TaskContextBuilder } from './task-context.builder';
import { DeductionContextBuilder } from './deduction-context.builder';
import { MemoryContextBuilder } from './memory-context.builder';

@Injectable()
export class ContextAssemblerService {
  constructor(
    private readonly identityBuilder: IdentityContextBuilder,
    private readonly toolsetBuilder: ToolsetContextBuilder,
    private readonly domainBuilder: DomainContextBuilder,
    private readonly collaborationBuilder: CollaborationContextBuilder,
    private readonly taskBuilder: TaskContextBuilder,
    private readonly deductionBuilder: DeductionContextBuilder,
    private readonly memoryBuilder: MemoryContextBuilder,
  ) {}

  private get builders(): ContextBlockBuilder[] {
    return [
      this.identityBuilder,
      this.toolsetBuilder,
      this.domainBuilder,
      this.collaborationBuilder,
      this.taskBuilder,
      this.deductionBuilder,
      this.memoryBuilder,
    ];
  }

  async assemble(input: ContextBuildInput): Promise<AssembledContext> {
    const messages: AssembledContext['messages'] = [];
    const blockMetas: AssembledContext['blockMetas'] = [];
    let systemBlockCount = 0;

    for (const builder of this.builders) {
      if (builder.shouldInject(input)) {
        const blockMessages = await builder.build(input);
        messages.push(...blockMessages);
        const systemMessageCount = blockMessages.filter((message) => message.role === 'system').length;
        systemBlockCount += systemMessageCount;
        blockMetas.push({
          layer: builder.layer,
          scope: builder.meta.scope,
          stability: builder.meta.stability,
          messageCount: blockMessages.length,
          systemMessageCount,
        });
      }
    }

    const previousNonSystemMessages = (input.context.previousMessages || []).filter((message) => message?.role !== 'system');
    messages.push(...previousNonSystemMessages);
    return {
      messages,
      systemBlockCount,
      blockMetas,
    };
  }
}

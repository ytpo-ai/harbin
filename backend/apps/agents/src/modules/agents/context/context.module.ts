import { Module } from '@nestjs/common';
import { MemoModule } from '@agent/modules/memos/memo.module';
import { PromptRegistryModule } from '@agent/modules/prompt-registry/prompt-registry.module';
import { ContextAssemblerService } from './context-assembler.service';
import { IdentityContextBuilder } from './identity-context.builder';
import { ToolsetContextBuilder } from './toolset-context.builder';
import { DomainContextBuilder } from './domain-context.builder';
import { CollaborationContextBuilder } from './collaboration-context.builder';
import { TaskContextBuilder } from './task-context.builder';
import { MemoryContextBuilder } from './memory-context.builder';
import { ContextFingerprintService } from './context-fingerprint.service';
import { ContextStrategyService } from './context-strategy.service';
import { ContextPromptService } from './context-prompt.service';

@Module({
  imports: [MemoModule, PromptRegistryModule],
  providers: [
    ContextAssemblerService,
    ContextFingerprintService,
    ContextStrategyService,
    ContextPromptService,
    IdentityContextBuilder,
    ToolsetContextBuilder,
    DomainContextBuilder,
    CollaborationContextBuilder,
    TaskContextBuilder,
    MemoryContextBuilder,
  ],
  exports: [ContextAssemblerService, ContextFingerprintService, ContextStrategyService],
})
export class ContextModule {}

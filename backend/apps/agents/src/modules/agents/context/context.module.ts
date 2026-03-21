import { Module } from '@nestjs/common';
import { MemoModule } from '@agent/modules/memos/memo.module';
import { ContextAssemblerService } from './context-assembler.service';
import { IdentityContextBuilder } from './identity-context.builder';
import { ToolsetContextBuilder } from './toolset-context.builder';
import { DomainContextBuilder } from './domain-context.builder';
import { CollaborationContextBuilder } from './collaboration-context.builder';
import { TaskContextBuilder } from './task-context.builder';
import { MemoryContextBuilder } from './memory-context.builder';

@Module({
  imports: [MemoModule],
  providers: [
    ContextAssemblerService,
    IdentityContextBuilder,
    ToolsetContextBuilder,
    DomainContextBuilder,
    CollaborationContextBuilder,
    TaskContextBuilder,
    MemoryContextBuilder,
  ],
  exports: [ContextAssemblerService],
})
export class ContextModule {}

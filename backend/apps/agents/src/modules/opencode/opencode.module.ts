import { Module } from '@nestjs/common';
import { OpenCodeAdapter } from './opencode.adapter';
import { OpenCodeExecutionService } from './opencode-execution.service';

@Module({
  providers: [OpenCodeAdapter, OpenCodeExecutionService],
  exports: [OpenCodeAdapter, OpenCodeExecutionService],
})
export class OpenCodeModule {}

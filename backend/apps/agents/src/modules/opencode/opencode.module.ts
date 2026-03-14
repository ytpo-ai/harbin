import { Module } from '@nestjs/common';
import { OpenCodeAdapter } from './opencode.adapter';
import { OpenCodeExecutionService } from './opencode-execution.service';
import { RuntimeModule } from '../runtime/runtime.module';

@Module({
  imports: [RuntimeModule],
  providers: [OpenCodeAdapter, OpenCodeExecutionService],
  exports: [OpenCodeAdapter, OpenCodeExecutionService],
})
export class OpenCodeModule {}

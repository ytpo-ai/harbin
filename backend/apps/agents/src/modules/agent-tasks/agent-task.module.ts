import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentTask, AgentTaskSchema } from '../../schemas/agent-task.schema';
import { AgentTaskController } from './agent-task.controller';
import { AgentTaskService } from './agent-task.service';
import { RuntimeSseStreamService } from './runtime-sse-stream.service';
import { AgentTaskWorker } from './agent-task.worker';
import { RuntimeModule } from '../runtime/runtime.module';
import { AgentModule } from '../agents/agent.module';
import { OpenCodeServeRouterService } from './opencode-serve-router.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AgentTask.name, schema: AgentTaskSchema }]),
    RuntimeModule,
    AgentModule,
  ],
  controllers: [AgentTaskController],
  providers: [AgentTaskService, RuntimeSseStreamService, OpenCodeServeRouterService, AgentTaskWorker],
  exports: [AgentTaskService],
})
export class AgentTaskModule {}

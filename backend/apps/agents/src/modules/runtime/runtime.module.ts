import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InfraModule } from '@libs/infra';
import { AgentRun, AgentRunSchema } from '../../schemas/agent-run.schema';
import { AgentMessage, AgentMessageSchema } from '../../schemas/agent-message.schema';
import { AgentPart, AgentPartSchema } from '../../schemas/agent-part.schema';
import { AgentEventOutbox, AgentEventOutboxSchema } from '../../schemas/agent-event-outbox.schema';
import { RuntimePersistenceService } from './runtime-persistence.service';
import { HookDispatcherService } from './hook-dispatcher.service';
import { RuntimeOrchestratorService } from './runtime-orchestrator.service';
import { RuntimeController } from './runtime.controller';

@Module({
  imports: [
    InfraModule,
    MongooseModule.forFeature([
      { name: AgentRun.name, schema: AgentRunSchema },
      { name: AgentMessage.name, schema: AgentMessageSchema },
      { name: AgentPart.name, schema: AgentPartSchema },
      { name: AgentEventOutbox.name, schema: AgentEventOutboxSchema },
    ]),
  ],
  controllers: [RuntimeController],
  providers: [RuntimePersistenceService, HookDispatcherService, RuntimeOrchestratorService],
  exports: [RuntimePersistenceService, HookDispatcherService, RuntimeOrchestratorService],
})
export class RuntimeModule {}

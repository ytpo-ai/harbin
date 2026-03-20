import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InfraModule } from '@libs/infra';
import { AgentRun, AgentRunSchema } from '../../schemas/agent-run.schema';
import { AgentMessage, AgentMessageSchema } from '../../schemas/agent-message.schema';
import { AgentPart, AgentPartSchema } from '../../schemas/agent-part.schema';
import { AgentEventOutbox, AgentEventOutboxSchema } from '../../schemas/agent-event-outbox.schema';
import {
  AgentRuntimeMaintenanceAudit,
  AgentRuntimeMaintenanceAuditSchema,
} from '../../schemas/agent-runtime-maintenance-audit.schema';
import { AgentSession, AgentSessionSchema } from '../../schemas/agent-session.schema';
import { RuntimePersistenceService } from './runtime-persistence.service';
import { HookDispatcherService } from './hook-dispatcher.service';
import { RuntimeOrchestratorService } from './runtime-orchestrator.service';
import { RuntimeActionLogSyncService } from './runtime-action-log-sync.service';
import { RuntimeEiSyncService } from './runtime-ei-sync.service';
import { RuntimeController } from './runtime.controller';
import { MemoModule } from '../memos/memo.module';
import { RuntimeMemoSnapshotQueueService } from './runtime-memo-snapshot-queue.service';
import { HookRegistryService } from './hooks/hook-registry.service';
import { HookPipelineService } from './hooks/hook-pipeline.service';
import { AgentActionLogModule } from '../action-logs/agent-action-log.module';

@Module({
  imports: [
    InfraModule,
    MemoModule,
    AgentActionLogModule,
    MongooseModule.forFeature([
      { name: AgentRun.name, schema: AgentRunSchema },
      { name: AgentMessage.name, schema: AgentMessageSchema },
      { name: AgentPart.name, schema: AgentPartSchema },
      { name: AgentEventOutbox.name, schema: AgentEventOutboxSchema },
      { name: AgentRuntimeMaintenanceAudit.name, schema: AgentRuntimeMaintenanceAuditSchema },
      { name: AgentSession.name, schema: AgentSessionSchema },
    ]),
  ],
  controllers: [RuntimeController],
  providers: [
    RuntimePersistenceService,
    HookDispatcherService,
    RuntimeOrchestratorService,
    RuntimeActionLogSyncService,
    RuntimeEiSyncService,
    RuntimeMemoSnapshotQueueService,
    HookRegistryService,
    HookPipelineService,
  ],
  exports: [
    RuntimePersistenceService,
    HookDispatcherService,
    RuntimeOrchestratorService,
    RuntimeActionLogSyncService,
    RuntimeEiSyncService,
    RuntimeMemoSnapshotQueueService,
    HookRegistryService,
    HookPipelineService,
  ],
})
export class RuntimeModule {}

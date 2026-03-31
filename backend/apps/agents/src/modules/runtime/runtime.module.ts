import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InfraModule } from '@libs/infra';
import { AgentRun, AgentRunSchema } from '@agent/schemas/agent-run.schema';
import { AgentMessage, AgentMessageSchema } from '@agent/schemas/agent-message.schema';
import { AgentPart, AgentPartSchema } from '@agent/schemas/agent-part.schema';
import { AgentEventOutbox, AgentEventOutboxSchema } from '@agent/schemas/agent-event-outbox.schema';
import {
  AgentRuntimeMaintenanceAudit,
  AgentRuntimeMaintenanceAuditSchema,
} from '@agent/schemas/agent-runtime-maintenance-audit.schema';
import { AgentSession, AgentSessionSchema } from '@agent/schemas/agent-session.schema';
import { AgentRunScore, AgentRunScoreSchema } from '@agent/schemas/agent-run-score.schema';
import { RuntimePersistenceService } from './runtime-persistence.service';
import { HookDispatcherService } from './hook-dispatcher.service';
import { RuntimeOrchestratorService } from './runtime-orchestrator.service';
import { RuntimeActionLogIngestionService } from './runtime-action-log.service';
import { RuntimeEiSyncService } from './runtime-ei-sync.service';
import { RuntimeController } from './runtime.controller';
import { AgentRunScoreController } from './agent-run-score.controller';
import { AgentRunScoreService } from './agent-run-score.service';
import { MemoModule } from '../memos/memo.module';
import { RuntimeMemoSnapshotQueueService } from './runtime-memo-snapshot-queue.service';
import { HookRegistryService } from './hooks/hook-registry.service';
import { HookPipelineService } from './hooks/hook-pipeline.service';
import { AgentActionLogModule } from '../action-logs/agent-action-log.module';
import { DebugTimingProvider } from '@libs/common';

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
      { name: AgentRunScore.name, schema: AgentRunScoreSchema },
    ]),
  ],
  controllers: [RuntimeController, AgentRunScoreController],
  providers: [
    RuntimePersistenceService,
    AgentRunScoreService,
    HookDispatcherService,
    RuntimeOrchestratorService,
    RuntimeActionLogIngestionService,
    RuntimeEiSyncService,
    RuntimeMemoSnapshotQueueService,
    HookRegistryService,
    HookPipelineService,
    DebugTimingProvider,
  ],
  exports: [
    RuntimePersistenceService,
    AgentRunScoreService,
    HookDispatcherService,
    RuntimeOrchestratorService,
    RuntimeActionLogIngestionService,
    RuntimeEiSyncService,
    RuntimeMemoSnapshotQueueService,
    HookRegistryService,
    HookPipelineService,
    DebugTimingProvider,
  ],
})
export class RuntimeModule {}

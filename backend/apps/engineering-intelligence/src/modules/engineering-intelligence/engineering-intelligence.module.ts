import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EngineeringIntelligenceController } from './engineering-intelligence.controller';
import { EngineeringIntelligenceService } from './engineering-intelligence.service';
import { EngineeringRepository, EngineeringRepositorySchema } from '../../schemas/engineering-repository.schema';
import {
  EiOpenCodeRunSyncBatch,
  EiOpenCodeRunSyncBatchSchema,
} from '../../schemas/ei-opencode-run-sync-batch.schema';
import {
  EiOpenCodeEventFact,
  EiOpenCodeEventFactSchema,
} from '../../schemas/ei-opencode-event-fact.schema';
import {
  EiOpenCodeRunAnalytics,
  EiOpenCodeRunAnalyticsSchema,
} from '../../schemas/ei-opencode-run-analytics.schema';
import {
  EiProjectStatisticsSnapshot,
  EiProjectStatisticsSnapshotSchema,
} from '../../schemas/ei-project-statistics-snapshot.schema';
import { EiRequirement, EiRequirementSchema } from '../../schemas/ei-requirement.schema';
import { RdProject, RdProjectSchema } from '../../../../../src/shared/schemas/rd-project.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EngineeringRepository.name, schema: EngineeringRepositorySchema },
      { name: EiOpenCodeRunSyncBatch.name, schema: EiOpenCodeRunSyncBatchSchema },
      { name: EiOpenCodeEventFact.name, schema: EiOpenCodeEventFactSchema },
      { name: EiOpenCodeRunAnalytics.name, schema: EiOpenCodeRunAnalyticsSchema },
      { name: EiProjectStatisticsSnapshot.name, schema: EiProjectStatisticsSnapshotSchema },
      { name: EiRequirement.name, schema: EiRequirementSchema },
      { name: RdProject.name, schema: RdProjectSchema },
    ]),
  ],
  controllers: [EngineeringIntelligenceController],
  providers: [EngineeringIntelligenceService],
})
export class EngineeringIntelligenceModule {}

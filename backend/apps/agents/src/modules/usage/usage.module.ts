import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsageController } from './usage.controller';
import { UsageAggregationService } from './usage-aggregation.service';
import { AgentMessage, AgentMessageSchema } from '../../schemas/agent-message.schema';
import { Agent, AgentSchema } from '../../schemas/agent.schema';
import { ModelRegistry, ModelRegistrySchema } from '../../schemas/model-registry.schema';
import {
  UsageDailySnapshot,
  UsageDailySnapshotSchema,
} from '../../schemas/usage-daily-snapshot.schema';
import { ModelModule } from '../models/model.module';

@Module({
  imports: [
    ModelModule,
    MongooseModule.forFeature([
      { name: AgentMessage.name, schema: AgentMessageSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: ModelRegistry.name, schema: ModelRegistrySchema },
      { name: UsageDailySnapshot.name, schema: UsageDailySnapshotSchema },
    ]),
  ],
  controllers: [UsageController],
  providers: [UsageAggregationService],
  exports: [UsageAggregationService],
})
export class UsageModule {}

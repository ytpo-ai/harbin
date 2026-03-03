import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentMemo, AgentMemoSchema } from '../../schemas/agent-memo.schema';
import { AgentMemoVersion, AgentMemoVersionSchema } from '../../schemas/agent-memo-version.schema';
import { MemoAggregationService } from './memo-aggregation.service';
import { MemoController } from './memo.controller';
import { MemoDocSyncService } from './memo-doc-sync.service';
import { MemoEventBusService } from './memo-event-bus.service';
import { MemoService } from './memo.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgentMemo.name, schema: AgentMemoSchema },
      { name: AgentMemoVersion.name, schema: AgentMemoVersionSchema },
    ]),
  ],
  controllers: [MemoController],
  providers: [MemoService, MemoDocSyncService, MemoAggregationService, MemoEventBusService],
  exports: [MemoService, MemoEventBusService],
})
export class MemoModule {}

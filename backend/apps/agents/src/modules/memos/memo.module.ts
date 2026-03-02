import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentMemo, AgentMemoSchema } from '../../schemas/agent-memo.schema';
import { MemoAggregationService } from './memo-aggregation.service';
import { MemoController } from './memo.controller';
import { MemoDocSyncService } from './memo-doc-sync.service';
import { MemoService } from './memo.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AgentMemo.name, schema: AgentMemoSchema }]),
  ],
  controllers: [MemoController],
  providers: [MemoService, MemoDocSyncService, MemoAggregationService],
  exports: [MemoService],
})
export class MemoModule {}

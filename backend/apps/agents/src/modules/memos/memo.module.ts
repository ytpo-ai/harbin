import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Agent, AgentSchema } from '../../../../../src/shared/schemas/agent.schema';
import { Tool, ToolSchema } from '../../../../../src/shared/schemas/tool.schema';
import { AgentMemo, AgentMemoSchema } from '../../schemas/agent-memo.schema';
import { AgentMemoVersion, AgentMemoVersionSchema } from '../../schemas/agent-memo-version.schema';
import { Skill, SkillSchema } from '../../schemas/skill.schema';
import { OrchestrationTask, OrchestrationTaskSchema } from '../../../../../src/shared/schemas/orchestration-task.schema';
import { AgentRun, AgentRunSchema } from '../../schemas/agent-run.schema';
import { AgentPart, AgentPartSchema } from '../../schemas/agent-part.schema';
import { MemoAggregationService } from './memo-aggregation.service';
import { MemoController } from './memo.controller';
import { MemoDocSyncService } from './memo-doc-sync.service';
import { MemoEventBusService } from './memo-event-bus.service';
import { MemoService } from './memo.service';
import { IdentityAggregationService } from './identity-aggregation.service';
import { EvaluationAggregationService } from './evaluation-aggregation.service';
import { MemoTaskTodoService } from './memo-task-todo.service';
import { MemoTaskHistoryService } from './memo-task-history.service';
import { MemoAggregationCommandConsumerService } from './memo-aggregation-command-consumer.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgentMemo.name, schema: AgentMemoSchema },
      { name: AgentMemoVersion.name, schema: AgentMemoVersionSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: Tool.name, schema: ToolSchema },
      { name: Skill.name, schema: SkillSchema },
      { name: OrchestrationTask.name, schema: OrchestrationTaskSchema },
      { name: AgentRun.name, schema: AgentRunSchema },
      { name: AgentPart.name, schema: AgentPartSchema },
    ]),
  ],
  controllers: [MemoController],
  providers: [
    MemoService,
    MemoDocSyncService,
    MemoAggregationService,
    MemoEventBusService,
    IdentityAggregationService,
    EvaluationAggregationService,
    MemoTaskTodoService,
    MemoTaskHistoryService,
    MemoAggregationCommandConsumerService,
  ],
  exports: [MemoService, MemoEventBusService, IdentityAggregationService, EvaluationAggregationService],
})
export class MemoModule {}

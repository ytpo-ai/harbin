import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../../auth/auth.module';
import { AgentClientModule } from '../../agents-client/agent-client.module';
import { OrchestrationModule } from '../orchestration.module';
import { Agent, AgentSchema } from '../../../shared/schemas/agent.schema';
import {
  OrchestrationSchedule,
  OrchestrationScheduleSchema,
} from '../../../shared/schemas/orchestration-schedule.schema';
import {
  OrchestrationTask,
  OrchestrationTaskSchema,
} from '../../../shared/schemas/orchestration-task.schema';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    AgentClientModule,
    OrchestrationModule,
    MongooseModule.forFeature([
      { name: OrchestrationSchedule.name, schema: OrchestrationScheduleSchema },
      { name: OrchestrationTask.name, schema: OrchestrationTaskSchema },
      { name: Agent.name, schema: AgentSchema },
    ]),
  ],
  controllers: [SchedulerController],
  providers: [SchedulerService],
})
export class OrchestrationSchedulerModule {}

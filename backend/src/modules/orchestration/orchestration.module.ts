import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AgentClientModule } from '../agents-client/agent-client.module';
import { Employee, EmployeeSchema } from '../../shared/schemas/employee.schema';
import { Agent, AgentSchema } from '../../shared/schemas/agent.schema';
import {
  OrchestrationPlan,
  OrchestrationPlanSchema,
} from '../../shared/schemas/orchestration-plan.schema';
import {
  OrchestrationTask,
  OrchestrationTaskSchema,
} from '../../shared/schemas/orchestration-task.schema';
import { Tool, ToolSchema } from '../../shared/schemas/tool.schema';
import {
  OrchestrationSchedule,
  OrchestrationScheduleSchema,
} from '../../shared/schemas/orchestration-schedule.schema';
import { OrchestrationController } from './orchestration.controller';
import { OrchestrationService } from './orchestration.service';
import { PlannerService } from './planner.service';
import { MessagesModule } from '../messages/messages.module';
import { PlanSession, PlanSessionSchema } from '../../shared/schemas/plan-session.schema';
import { SessionManagerService } from './session-manager.service';

@Module({
  imports: [
    AuthModule,
    AgentClientModule,
    MessagesModule,
    MongooseModule.forFeature([
      { name: OrchestrationPlan.name, schema: OrchestrationPlanSchema },
      { name: OrchestrationTask.name, schema: OrchestrationTaskSchema },
      { name: PlanSession.name, schema: PlanSessionSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: Tool.name, schema: ToolSchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: OrchestrationSchedule.name, schema: OrchestrationScheduleSchema },
    ]),
  ],
  controllers: [OrchestrationController],
  providers: [OrchestrationService, PlannerService, SessionManagerService],
  exports: [OrchestrationService],
})
export class OrchestrationModule {}

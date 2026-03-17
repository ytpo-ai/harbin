import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AgentClientModule } from '../agents-client/agent-client.module';
import { Employee, EmployeeSchema } from '../../shared/schemas/employee.schema';
import { Agent, AgentSchema } from '../../shared/schemas/agent.schema';
import { AgentRole, AgentRoleSchema } from '../../shared/schemas/agent-role.schema';
import {
  OrchestrationPlan,
  OrchestrationPlanSchema,
} from '../../shared/schemas/orchestration-plan.schema';
import {
  OrchestrationTask,
  OrchestrationTaskSchema,
} from '../../shared/schemas/orchestration-task.schema';
import { Tool, ToolSchema } from '../../../apps/agents/src/schemas/tool.schema';
import {
  OrchestrationSchedule,
  OrchestrationScheduleSchema,
} from '../../shared/schemas/orchestration-schedule.schema';
import { OrchestrationController } from './orchestration.controller';
import { OrchestrationService } from './orchestration.service';
import { PlannerService } from './planner.service';
import { MessagesModule } from '../messages/messages.module';
import { PlanSession, PlanSessionSchema } from '../../shared/schemas/orchestration-plan-session.schema';
import { SessionManagerService } from './session-manager.service';
import { TaskClassificationService } from './services/task-classification.service';
import { TaskOutputValidationService } from './services/task-output-validation.service';
import { ExecutorSelectionService } from './services/executor-selection.service';
import { InnerMessageModule } from '../inner-message/inner-message.module';

@Module({
  imports: [
    AuthModule,
    AgentClientModule,
    InnerMessageModule,
    MessagesModule,
    MongooseModule.forFeature([
      { name: OrchestrationPlan.name, schema: OrchestrationPlanSchema },
      { name: OrchestrationTask.name, schema: OrchestrationTaskSchema },
      { name: PlanSession.name, schema: PlanSessionSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: Tool.name, schema: ToolSchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: AgentRole.name, schema: AgentRoleSchema },
      { name: OrchestrationSchedule.name, schema: OrchestrationScheduleSchema },
    ]),
  ],
  controllers: [OrchestrationController],
  providers: [
    OrchestrationService,
    PlannerService,
    SessionManagerService,
    TaskClassificationService,
    TaskOutputValidationService,
    ExecutorSelectionService,
  ],
  exports: [OrchestrationService],
})
export class OrchestrationModule {}

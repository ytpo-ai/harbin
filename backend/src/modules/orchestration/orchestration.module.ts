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
import { AgentSession, AgentSessionSchema } from '../../shared/schemas/agent-session.schema';
import { Tool, ToolSchema } from '../../shared/schemas/tool.schema';
import { OrchestrationController } from './orchestration.controller';
import { OrchestrationService } from './orchestration.service';
import { PlannerService } from './planner.service';
import { SessionManagerService } from './session-manager.service';

@Module({
  imports: [
    AuthModule,
    AgentClientModule,
    MongooseModule.forFeature([
      { name: OrchestrationPlan.name, schema: OrchestrationPlanSchema },
      { name: OrchestrationTask.name, schema: OrchestrationTaskSchema },
      { name: AgentSession.name, schema: AgentSessionSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: Tool.name, schema: ToolSchema },
      { name: Employee.name, schema: EmployeeSchema },
    ]),
  ],
  controllers: [OrchestrationController],
  providers: [OrchestrationService, PlannerService, SessionManagerService],
  exports: [OrchestrationService, SessionManagerService],
})
export class OrchestrationModule {}

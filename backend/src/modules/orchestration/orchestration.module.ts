import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AgentClientModule } from '../agents-client/agent-client.module';
import { Employee, EmployeeSchema } from '../../shared/schemas/employee.schema';
import { Agent, AgentSchema } from '@agent/schemas/agent.schema';
import { AgentRole, AgentRoleSchema } from '@agent/schemas/agent-role.schema';
import {
  OrchestrationPlan,
  OrchestrationPlanSchema,
} from '../../shared/schemas/orchestration-plan.schema';
import {
  OrchestrationTask,
  OrchestrationTaskSchema,
} from '../../shared/schemas/orchestration-task.schema';
import { Tool, ToolSchema } from '../../../apps/agents/src/schemas/tool.schema';
import { Skill, SkillSchema } from '../../../apps/agents/src/schemas/agent-skill.schema';
import {
  OrchestrationRun,
  OrchestrationRunSchema,
} from '../../shared/schemas/orchestration-run.schema';
import {
  OrchestrationRunTask,
  OrchestrationRunTaskSchema,
} from '../../shared/schemas/orchestration-run-task.schema';
import { OrchestrationController } from './orchestration.controller';
import { OrchestrationService } from './orchestration.service';
import { PlannerService } from './planner.service';
import { MessagesModule } from '../messages/messages.module';
import { PlanSession, PlanSessionSchema } from '../../shared/schemas/orchestration-plan-session.schema';
import { SessionManagerService } from './session-manager.service';
import { TaskOutputValidationService } from './services/task-output-validation.service';
import { ExecutorSelectionService } from './services/executor-selection.service';
import { SceneOptimizationService } from './services/scene-optimization.service';
import { PlanManagementService } from './services/plan-management.service';
import { TaskManagementService } from './services/task-management.service';
import { PlanExecutionService } from './services/plan-execution.service';
import { IncrementalPlanningService } from './services/incremental-planning.service';
import { TaskLifecycleService } from './services/task-lifecycle.service';
import { PlanStatsService } from './services/plan-stats.service';
import { PlanEventStreamService } from './services/plan-event-stream.service';
import { OrchestrationContextService } from './services/orchestration-context.service';
import { OrchestrationExecutionEngineService } from './services/orchestration-execution-engine.service';
import { OrchestrationStepDispatcherService } from './services/orchestration-step-dispatcher.service';
import { OrchestrationEventListenerService } from './services/orchestration-event-listener.service';
import { OrchestrationMessageCenterEventService } from './services/orchestration-message-center-event.service';

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
      { name: AgentRole.name, schema: AgentRoleSchema },
      { name: Skill.name, schema: SkillSchema },
      { name: OrchestrationRun.name, schema: OrchestrationRunSchema },
      { name: OrchestrationRunTask.name, schema: OrchestrationRunTaskSchema },
    ]),
  ],
  controllers: [OrchestrationController],
  providers: [
    OrchestrationService,
    PlannerService,
    SessionManagerService,
    PlanManagementService,
    TaskManagementService,
    PlanExecutionService,
    IncrementalPlanningService,
    OrchestrationStepDispatcherService,
    OrchestrationEventListenerService,
    TaskLifecycleService,
    PlanStatsService,
    PlanEventStreamService,
    OrchestrationContextService,
    OrchestrationExecutionEngineService,
    OrchestrationMessageCenterEventService,
    TaskOutputValidationService,
    ExecutorSelectionService,
    SceneOptimizationService,
  ],
  exports: [OrchestrationService],
})
export class OrchestrationModule {}

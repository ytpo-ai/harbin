import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { InfraModule } from '@libs/infra';
import appConfig from '../../../src/config/app.config';
import databaseConfig from '../../../src/config/database.config';
import aiConfig from '../../../src/config/ai.config';
import jwtConfig from '../../../src/config/jwt.config';
import { EngineeringRepository, EngineeringRepositorySchema } from './schemas/engineering-repository.schema';
import { EiOpenCodeRunSyncBatch, EiOpenCodeRunSyncBatchSchema } from './schemas/ei-opencode-run-sync-batch.schema';
import { EiOpenCodeEventFact, EiOpenCodeEventFactSchema } from './schemas/ei-opencode-event-fact.schema';
import { EiOpenCodeRunAnalytics, EiOpenCodeRunAnalyticsSchema } from './schemas/ei-opencode-run-analytics.schema';
import {
  EiProjectStatisticsSnapshot,
  EiProjectStatisticsSnapshotSchema,
} from './schemas/ei-project-statistics-snapshot.schema';
import { EiRequirement, EiRequirementSchema } from './schemas/ei-requirement.schema';
import { EiDocCommitFact, EiDocCommitFactSchema } from './schemas/ei-doc-commit-fact.schema';
import { EiAppConfig, EiAppConfigSchema } from './schemas/ei-app-config.schema';
import { IncubationProject, IncubationProjectSchema } from './schemas/incubation-project.schema';
import { RdTask, RdTaskSchema } from '../../../src/shared/schemas/ei-task.schema';
import { RdProject, RdProjectSchema } from '../../../src/shared/schemas/ei-project.schema';
import { Employee, EmployeeSchema } from '../../../src/shared/schemas/employee.schema';
import { OrchestrationPlan, OrchestrationPlanSchema } from '../../../src/shared/schemas/orchestration-plan.schema';
import { OrchestrationRun, OrchestrationRunSchema } from '../../../src/shared/schemas/orchestration-run.schema';
import { OrchestrationTask, OrchestrationTaskSchema } from '../../../src/shared/schemas/orchestration-task.schema';
import { Schedule, ScheduleSchema } from '../../../src/shared/schemas/schedule.schema';
import { Meeting, MeetingSchema } from '../../../src/shared/schemas/meeting.schema';
import { AuthModule } from '../../../src/modules/auth/auth.module';
import { AgentClientModule } from '../../../src/modules/agents-client/agent-client.module';
import { ApiKeysModule } from '../../../src/modules/api-keys/api-keys.module';
import { EiRepositoriesController } from './controllers/repositories.controller';
import { EiOpencodeSyncController } from './controllers/opencode-sync.controller';
import { EiStatisticsController } from './controllers/statistics.controller';
import { EiRequirementsController } from './controllers/requirements.controller';
import { EiTasksController } from './controllers/tasks.controller';
import { EiProjectsController } from './controllers/projects.controller';
import { EiOpencodeController } from './controllers/opencode.controller';
import { DocsHeatController } from './controllers/docs-heat.controller';
import { EiConfigController } from './controllers/config.controller';
import { IncubationProjectsController } from './controllers/incubation-projects.controller';
import { EiRepositoriesService } from './services/repositories.service';
import { EiOpencodeSyncService } from './services/opencode-sync.service';
import { EiStatisticsService } from './services/statistics.service';
import { EiRequirementsService } from './services/requirements.service';
import { EiManagementService } from './services/management.service';
import { OpencodeService } from './services/opencode-client.service';
import { EiTasksService } from './services/tasks.service';
import { EiProjectsService } from './services/projects.service';
import { EiOpencodeService } from './services/opencode.service';
import { DocsHeatService } from './services/docs-heat.service';
import { EiAppConfigService } from './services/ei-app-config.service';
import { EiGithubClientService } from './services/ei-github-client.service';
import { IncubationProjectsService } from './services/incubation-projects.service';
import { IncubationProjectAggregationService } from './services/incubation-project-aggregation.service';
import { EiRuntimeSyncConsumerService } from './services/ei-runtime-sync-consumer.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.development', '.env'],
      load: [appConfig, databaseConfig, aiConfig, jwtConfig],
    }),
    AuthModule,
    AgentClientModule,
    ApiKeysModule,
    InfraModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const dbConfig = configService.get('database');
        return {
          uri: dbConfig.uri,
          ...dbConfig.options,
        };
      },
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: EngineeringRepository.name, schema: EngineeringRepositorySchema },
      { name: EiOpenCodeRunSyncBatch.name, schema: EiOpenCodeRunSyncBatchSchema },
      { name: EiOpenCodeEventFact.name, schema: EiOpenCodeEventFactSchema },
      { name: EiOpenCodeRunAnalytics.name, schema: EiOpenCodeRunAnalyticsSchema },
      { name: EiProjectStatisticsSnapshot.name, schema: EiProjectStatisticsSnapshotSchema },
      { name: EiRequirement.name, schema: EiRequirementSchema },
      { name: EiDocCommitFact.name, schema: EiDocCommitFactSchema },
      { name: EiAppConfig.name, schema: EiAppConfigSchema },
      { name: RdTask.name, schema: RdTaskSchema },
      { name: RdProject.name, schema: RdProjectSchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: IncubationProject.name, schema: IncubationProjectSchema },
      { name: OrchestrationPlan.name, schema: OrchestrationPlanSchema },
      { name: OrchestrationRun.name, schema: OrchestrationRunSchema },
      { name: OrchestrationTask.name, schema: OrchestrationTaskSchema },
      { name: Schedule.name, schema: ScheduleSchema },
      { name: Meeting.name, schema: MeetingSchema },
    ]),
  ],
  controllers: [
    EiRepositoriesController,
    EiOpencodeSyncController,
    EiStatisticsController,
    EiRequirementsController,
    EiTasksController,
    EiProjectsController,
    EiOpencodeController,
    DocsHeatController,
    EiConfigController,
    IncubationProjectsController,
  ],
  providers: [
    EiRepositoriesService,
    EiOpencodeSyncService,
    EiStatisticsService,
    EiRequirementsService,
    EiManagementService,
    OpencodeService,
    EiTasksService,
    EiProjectsService,
    EiOpencodeService,
    DocsHeatService,
    EiAppConfigService,
    EiGithubClientService,
    IncubationProjectsService,
    IncubationProjectAggregationService,
    EiRuntimeSyncConsumerService,
  ],
})
export class EngineeringIntelligenceAppModule {}

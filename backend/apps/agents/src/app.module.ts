import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentModule } from './modules/agents/agent.module';
import { ModelModule } from './modules/models/model.module';
import { ApiKeysModule } from '../../../src/modules/api-keys/api-keys.module';
import appConfig from '../../../src/config/app.config';
import databaseConfig from '../../../src/config/database.config';
import aiConfig from '../../../src/config/ai.config';
import jwtConfig from '../../../src/config/jwt.config';
import { InfraModule } from '@libs/infra';
import { InternalContextMiddleware } from './security/internal-context.middleware';
import { AgentStreamController } from './controllers/stream.controller';
import { HealthController } from './controllers/health.controller';
import { SkillModule } from './modules/skills/skill.module';
import { MemoModule } from './modules/memos/memo.module';
import { AgentTaskModule } from './modules/agent-tasks/agent-task.module';
import { PromptRegistryAdminModule } from './modules/prompt-registry/prompt-registry-admin.module';
import { AgentActionLogModule } from './modules/action-logs/agent-action-log.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.development', '.env'],
      load: [appConfig, databaseConfig, aiConfig, jwtConfig],
    }),
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
    InfraModule,
    ModelModule,
    ApiKeysModule,
    AgentTaskModule,
    PromptRegistryAdminModule,
    AgentActionLogModule,
    AgentModule,
    SkillModule,
    MemoModule,
  ],
  controllers: [HealthController, AgentStreamController],
})
export class AgentsAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(InternalContextMiddleware).forRoutes('*');
  }
}

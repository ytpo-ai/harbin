import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ModelModule } from './modules/models/model.module';
import { AgentModule } from './modules/agents/agent.module';
import { TaskModule } from './modules/tasks/task.module';
import { ChatModule } from './modules/chat/chat.module';
import { ToolModule } from './modules/tools/tool.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { HRModule } from './modules/hr/hr.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { MeetingModule } from './modules/meetings/meeting.module';
import { EmployeeModule } from './modules/employees/employee.module';
import { InvitationModule } from './modules/invitations/invitation.module';
import { AuthModule } from './modules/auth/auth.module';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import aiConfig from './config/ai.config';
import jwtConfig from './config/jwt.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
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
    ModelModule,
    AgentModule,
    TaskModule,
    ChatModule,
    ToolModule,
    OrganizationModule,
    HRModule,
    GovernanceModule,
    ApiKeysModule,
    MeetingModule,
    EmployeeModule,
    InvitationModule,
    AuthModule,
  ],
})
export class AppModule {}
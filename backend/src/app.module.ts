import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HRModule } from './modules/hr/hr.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { MeetingModule } from './modules/meetings/meeting.module';
import { EmployeeModule } from './modules/employees/employee.module';
import { InvitationModule } from './modules/invitations/invitation.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrchestrationModule } from './modules/orchestration/orchestration.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { AgentClientModule } from './modules/agents-client/agent-client.module';
import { OperationLogModule } from './modules/operation-logs/operation-log.module';
import { MessagesModule } from './modules/messages/messages.module';
import { MessageCenterModule } from './modules/message-center/message-center.module';
import { InfraModule } from '@libs/infra';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import aiConfig from './config/ai.config';
import jwtConfig from './config/jwt.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.development', '.env'],
      load: [appConfig, databaseConfig, aiConfig, jwtConfig],
    }),
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
    OperationLogModule,
    MessagesModule,
    MessageCenterModule,
    AgentClientModule,
    HRModule,
    ApiKeysModule,
    MeetingModule,
    EmployeeModule,
    InvitationModule,
    AuthModule,
    OrchestrationModule,
    SchedulerModule,
  ],
})
export class AppModule {}

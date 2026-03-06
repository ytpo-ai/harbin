import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AgentActionLog, AgentActionLogSchema } from '../../shared/schemas/agent-action-log.schema';
import { AgentActionLogService } from './agent-action-log.service';
import { AgentActionLogController } from './agent-action-log.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: AgentActionLog.name, schema: AgentActionLogSchema },
    ]),
  ],
  providers: [AgentActionLogService],
  controllers: [AgentActionLogController],
  exports: [AgentActionLogService],
})
export class AgentActionLogModule {}

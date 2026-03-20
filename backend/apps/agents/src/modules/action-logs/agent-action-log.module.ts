import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentActionLog, AgentActionLogSchema } from '../../schemas/agent-action-log.schema';
import { AgentActionLogService } from './agent-action-log.service';
import { AgentActionLogController } from './agent-action-log.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: AgentActionLog.name, schema: AgentActionLogSchema }])],
  controllers: [AgentActionLogController],
  providers: [AgentActionLogService],
  exports: [AgentActionLogService],
})
export class AgentActionLogModule {}

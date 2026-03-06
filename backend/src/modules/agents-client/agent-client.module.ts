import { Module } from '@nestjs/common';
import { AgentClientService } from './agent-client.service';
import { AgentActionLogModule } from '../agent-action-logs/agent-action-log.module';

@Module({
  imports: [AgentActionLogModule],
  providers: [AgentClientService],
  exports: [AgentClientService],
})
export class AgentClientModule {}

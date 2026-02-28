import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Agent, AgentSchema } from '../../shared/schemas/agent.schema';
import { AgentProfile, AgentProfileSchema } from '../../shared/schemas/agent-profile.schema';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { ModelModule } from '../models/model.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ToolModule } from '../tools/tool.module';
import { AgentClientService } from './agent-client.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
      { name: AgentProfile.name, schema: AgentProfileSchema },
    ]),
    ModelModule,
    ApiKeysModule,
    ToolModule,
  ],
  controllers: [AgentController],
  providers: [AgentService, AgentClientService],
  exports: [AgentService, AgentClientService],
})
export class AgentModule {}

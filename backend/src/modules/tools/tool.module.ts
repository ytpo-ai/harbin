import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { Tool, ToolSchema } from '../../shared/schemas/tool.schema';
import { ToolExecution, ToolExecutionSchema } from '../../shared/schemas/toolExecution.schema';
import { Agent, AgentSchema } from '../../shared/schemas/agent.schema';
import { AgentProfile, AgentProfileSchema } from '../../shared/schemas/agent-profile.schema';
import { ToolService } from './tool.service';
import { ToolController } from './tool.controller';
import { ComposioService } from './composio.service';
import { ToolClientService } from './tool-client.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Tool.name, schema: ToolSchema },
      { name: ToolExecution.name, schema: ToolExecutionSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: AgentProfile.name, schema: AgentProfileSchema },
    ])
  ],
  controllers: [ToolController],
  providers: [ToolService, ComposioService, ToolClientService],
  exports: [ToolService, ComposioService, ToolClientService],
})
export class ToolModule {}

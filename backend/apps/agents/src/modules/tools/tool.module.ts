import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { Tool, ToolSchema } from '../../../../../src/shared/schemas/tool.schema';
import { ToolExecution, ToolExecutionSchema } from '../../../../../src/shared/schemas/toolExecution.schema';
import { Agent, AgentSchema } from '../../../../../src/shared/schemas/agent.schema';
import { AgentProfile, AgentProfileSchema } from '../../../../../src/shared/schemas/agent-profile.schema';
import { ToolService } from './tool.service';
import { ToolController } from './tool.controller';
import { ComposioService } from './composio.service';

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
  providers: [ToolService, ComposioService],
  exports: [ToolService, ComposioService],
})
export class ToolModule {}

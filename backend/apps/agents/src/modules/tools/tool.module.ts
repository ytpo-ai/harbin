import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { Tool, ToolSchema } from '../../../../../src/shared/schemas/tool.schema';
import { Toolkit, ToolkitSchema } from '../../../../../src/shared/schemas/toolkit.schema';
import { ToolExecution, ToolExecutionSchema } from '../../../../../src/shared/schemas/toolExecution.schema';
import { Agent, AgentSchema } from '../../../../../src/shared/schemas/agent.schema';
import { AgentProfile, AgentProfileSchema } from '../../../../../src/shared/schemas/agent-profile.schema';
import { Employee, EmployeeSchema } from '../../../../../src/shared/schemas/employee.schema';
import { OperationLog, OperationLogSchema } from '../../../../../src/shared/schemas/operation-log.schema';
import { ToolService } from './tool.service';
import { ToolController } from './tool.controller';
import { ComposioService } from './composio.service';
import { ExaService } from './exa.service';
import { WebToolsService } from './web-tools.service';
import { ModelModule } from '../models/model.module';
import { MemoModule } from '../memos/memo.module';
import { SkillModule } from '../skills/skill.module';

@Module({
  imports: [
    ConfigModule,
    ModelModule,
    MemoModule,
    SkillModule,
    MongooseModule.forFeature([
      { name: Tool.name, schema: ToolSchema },
      { name: Toolkit.name, schema: ToolkitSchema },
      { name: ToolExecution.name, schema: ToolExecutionSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: AgentProfile.name, schema: AgentProfileSchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: OperationLog.name, schema: OperationLogSchema },
    ])
  ],
  controllers: [ToolController],
  providers: [ToolService, ComposioService, ExaService, WebToolsService],
  exports: [ToolService, ComposioService, ExaService, WebToolsService],
})
export class ToolModule {}

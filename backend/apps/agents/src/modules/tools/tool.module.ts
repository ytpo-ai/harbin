import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { Tool, ToolSchema } from '../../schemas/tool.schema';
import { Toolkit, ToolkitSchema } from '../../schemas/toolkit.schema';
import { ToolExecution, ToolExecutionSchema } from '../../schemas/tool-execution.schema';
import { Agent, AgentSchema } from '@agent/schemas/agent.schema';
import { AgentProfile, AgentProfileSchema } from '@agent/schemas/agent-profile.schema';
import { Employee, EmployeeSchema } from '../../../../../src/shared/schemas/employee.schema';
import { OperationLog, OperationLogSchema } from '../../../../../src/shared/schemas/operation-log.schema';
import { ApiKey, ApiKeySchema } from '../../../../../src/shared/schemas/api-key.schema';
import { Skill, SkillSchema } from '../../schemas/agent-skill.schema';
import { AgentRole, AgentRoleSchema } from '../../schemas/agent-role.schema';
import {
  AgentToolCredential,
  AgentToolCredentialSchema,
} from '../../schemas/agent-tool-credential.schema';
import {
  AgentToolTokenRevocation,
  AgentToolTokenRevocationSchema,
} from '../../schemas/agent-tool-token-revocation.schema';
import { ToolService } from './tool.service';
import { ToolController } from './tool.controller';
import { ComposioService } from './composio.service';
import { ExaService } from './exa.service';
import { WebToolsService } from './web-tools.service';
import { ModelModule } from '../models/model.module';
import { MemoModule } from '../memos/memo.module';
import { SkillModule } from '../skills/skill.module';
import { InternalApiClient } from './internal-api-client.service';
import { ToolGovernanceService } from './tool-governance.service';
import { OrchestrationToolHandler } from './orchestration-tool-handler.service';
import { RequirementToolHandler } from './requirement-tool-handler.service';
import { RepoToolHandler } from './repo-tool-handler.service';
import { ModelToolHandler } from './model-tool-handler.service';
import { SkillToolHandler } from './skill-tool-handler.service';
import { AuditToolHandler } from './audit-tool-handler.service';
import { MeetingToolHandler } from './meeting-tool-handler.service';
import { AgentToolAuthService } from './agent-tool-auth.service';
import { AgentToolAuthGuard } from './agent-tool-auth.guard';
import { AgentActionLogModule } from '../action-logs/agent-action-log.module';

@Module({
  imports: [
    ConfigModule,
    ModelModule,
    MemoModule,
    SkillModule,
    AgentActionLogModule,
    MongooseModule.forFeature([
      { name: Tool.name, schema: ToolSchema },
      { name: Toolkit.name, schema: ToolkitSchema },
      { name: ToolExecution.name, schema: ToolExecutionSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: AgentProfile.name, schema: AgentProfileSchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: OperationLog.name, schema: OperationLogSchema },
      { name: ApiKey.name, schema: ApiKeySchema },
      { name: Skill.name, schema: SkillSchema },
      { name: AgentRole.name, schema: AgentRoleSchema },
      { name: AgentToolCredential.name, schema: AgentToolCredentialSchema },
      { name: AgentToolTokenRevocation.name, schema: AgentToolTokenRevocationSchema },
    ]),
  ],
  controllers: [ToolController],
  providers: [
    ToolService,
    ComposioService,
    ExaService,
    WebToolsService,
    InternalApiClient,
    ToolGovernanceService,
    OrchestrationToolHandler,
    RequirementToolHandler,
    RepoToolHandler,
    ModelToolHandler,
    SkillToolHandler,
    AuditToolHandler,
    MeetingToolHandler,
    AgentToolAuthService,
    AgentToolAuthGuard,
  ],
  exports: [
    ToolService,
    ComposioService,
    ExaService,
    WebToolsService,
    InternalApiClient,
    ToolGovernanceService,
    OrchestrationToolHandler,
    RequirementToolHandler,
    RepoToolHandler,
    ModelToolHandler,
    SkillToolHandler,
    AuditToolHandler,
    MeetingToolHandler,
    AgentToolAuthService,
    AgentToolAuthGuard,
  ],
})
export class ToolModule {}

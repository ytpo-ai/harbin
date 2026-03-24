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
import { ModelModule } from '../models/model.module';
import { MemoModule } from '../memos/memo.module';
import { SkillModule } from '../skills/skill.module';
import { InternalApiClient } from './internal-api-client.service';
import { ToolGovernanceService } from './tool-governance.service';
import {
  AgentMasterToolHandler,
  AgentRoleToolHandler,
  AuditToolHandler,
  CommunicationToolHandler,
  MeetingToolHandler,
  MemoToolHandler,
  ModelToolHandler,
  OrchestrationToolHandler,
  PromptRegistryToolHandler,
  RdIntelligenceToolHandler,
  RepoToolHandler,
  RequirementToolHandler,
  SkillToolHandler,
  WebToolsService,
} from './builtin';
import { PromptRegistryAdminModule } from '../prompt-registry/prompt-registry-admin.module';
import { AgentToolAuthService } from './agent-tool-auth.service';
import { AgentToolAuthGuard } from './agent-tool-auth.guard';
import { AgentActionLogModule } from '../action-logs/agent-action-log.module';
import { InfraModule } from '@libs/infra';
import { ToolRegistryService } from './tool-registry.service';
import { ToolExecutionService } from './tool-execution.service';
import { ToolExecutionDispatcherService } from './tool-execution-dispatcher.service';

@Module({
  imports: [
    ConfigModule,
    InfraModule,
    ModelModule,
    MemoModule,
    SkillModule,
    AgentActionLogModule,
    PromptRegistryAdminModule,
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
    ToolRegistryService,
    ToolExecutionService,
    ToolExecutionDispatcherService,
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
    PromptRegistryToolHandler,
    AgentMasterToolHandler,
    AgentRoleToolHandler,
    MemoToolHandler,
    CommunicationToolHandler,
    RdIntelligenceToolHandler,
    AgentToolAuthService,
    AgentToolAuthGuard,
  ],
  exports: [
    ToolService,
    ToolRegistryService,
    ToolExecutionService,
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
    PromptRegistryToolHandler,
    AgentMasterToolHandler,
    AgentRoleToolHandler,
    MemoToolHandler,
    CommunicationToolHandler,
    RdIntelligenceToolHandler,
    AgentToolAuthService,
    AgentToolAuthGuard,
  ],
})
export class ToolModule {}

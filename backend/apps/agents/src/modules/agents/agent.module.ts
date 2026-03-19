import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Agent, AgentSchema } from '../../../../../src/shared/schemas/agent.schema';
import { AgentProfile, AgentProfileSchema } from '../../../../../src/shared/schemas/agent-profile.schema';
import { AgentRun, AgentRunSchema } from '../../schemas/agent-run.schema';
import { Skill, SkillSchema } from '../../schemas/agent-skill.schema';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { ModelModule } from '../models/model.module';
import { ApiKeysModule } from '../../../../../src/modules/api-keys/api-keys.module';
import { ToolModule } from '../tools/tool.module';
import { MemoModule } from '../memos/memo.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { OpenCodeModule } from '../opencode/opencode.module';
import { AgentExecutionService } from './agent-execution.service';
import { AgentOrchestrationIntentService } from './agent-orchestration-intent.service';
import { AgentOpenCodePolicyService } from './agent-opencode-policy.service';
import { AgentMcpProfileService } from './agent-mcp-profile.service';
import { AgentRoleService } from './agent-role.service';
import { AgentExecutorService } from './agent-executor.service';
import { PromptRegistryModule as PromptRegistryCoreModule } from '../prompt-registry/prompt-registry.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
      { name: AgentProfile.name, schema: AgentProfileSchema },
      { name: AgentRun.name, schema: AgentRunSchema },
      { name: Skill.name, schema: SkillSchema },
    ]),
    ModelModule,
    ApiKeysModule,
    ToolModule,
    MemoModule,
    RuntimeModule,
    OpenCodeModule,
    PromptRegistryCoreModule,
  ],
  controllers: [AgentController],
  providers: [
    AgentService,
    AgentExecutionService,
    AgentOrchestrationIntentService,
    AgentOpenCodePolicyService,
    AgentMcpProfileService,
    AgentRoleService,
    AgentExecutorService,
  ],
  exports: [AgentService],
})
export class AgentModule {}

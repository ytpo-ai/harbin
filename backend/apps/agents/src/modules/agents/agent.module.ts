import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Agent, AgentSchema } from '../../../../../src/shared/schemas/agent.schema';
import { AgentProfile, AgentProfileSchema } from '../../../../../src/shared/schemas/agent-profile.schema';
import { AgentSkill, AgentSkillSchema } from '../../schemas/agent-skill.schema';
import { AgentRun, AgentRunSchema } from '../../schemas/agent-run.schema';
import { Skill, SkillSchema } from '../../schemas/skill.schema';
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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
      { name: AgentProfile.name, schema: AgentProfileSchema },
      { name: AgentSkill.name, schema: AgentSkillSchema },
      { name: AgentRun.name, schema: AgentRunSchema },
      { name: Skill.name, schema: SkillSchema },
    ]),
    ModelModule,
    ApiKeysModule,
    ToolModule,
    MemoModule,
    RuntimeModule,
    OpenCodeModule,
  ],
  controllers: [AgentController],
  providers: [AgentService, AgentExecutionService, AgentOrchestrationIntentService, AgentOpenCodePolicyService, AgentMcpProfileService],
  exports: [AgentService],
})
export class AgentModule {}

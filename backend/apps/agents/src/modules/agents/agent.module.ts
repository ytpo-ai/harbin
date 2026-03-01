import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Agent, AgentSchema } from '../../../../../src/shared/schemas/agent.schema';
import { AgentProfile, AgentProfileSchema } from '../../../../../src/shared/schemas/agent-profile.schema';
import { AgentSkill, AgentSkillSchema } from '../../schemas/agent-skill.schema';
import { Skill, SkillSchema } from '../../schemas/skill.schema';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { ModelModule } from '../models/model.module';
import { ApiKeysModule } from '../../../../../src/modules/api-keys/api-keys.module';
import { ToolModule } from '../tools/tool.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
      { name: AgentProfile.name, schema: AgentProfileSchema },
      { name: AgentSkill.name, schema: AgentSkillSchema },
      { name: Skill.name, schema: SkillSchema },
    ]),
    ModelModule,
    ApiKeysModule,
    ToolModule,
  ],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}

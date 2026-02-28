import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SkillController } from './skill.controller';
import { SkillService } from './skill.service';
import { SkillDocSyncService } from './skill-doc-sync.service';
import { Skill, SkillSchema } from '../../shared/schemas/skill.schema';
import { AgentSkill, AgentSkillSchema } from '../../shared/schemas/agent-skill.schema';
import { SkillSuggestion, SkillSuggestionSchema } from '../../shared/schemas/skill-suggestion.schema';
import { Agent, AgentSchema } from '../../shared/schemas/agent.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Skill.name, schema: SkillSchema },
      { name: AgentSkill.name, schema: AgentSkillSchema },
      { name: SkillSuggestion.name, schema: SkillSuggestionSchema },
      { name: Agent.name, schema: AgentSchema },
    ]),
  ],
  controllers: [SkillController],
  providers: [SkillService, SkillDocSyncService],
  exports: [SkillService],
})
export class SkillModule {}

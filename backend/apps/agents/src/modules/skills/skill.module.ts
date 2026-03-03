import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SkillController } from './skill.controller';
import { SkillService } from './skill.service';
import { SkillDocSyncService } from './skill-doc-sync.service';
import { Skill, SkillSchema } from '../../schemas/skill.schema';
import { AgentSkill, AgentSkillSchema } from '../../schemas/agent-skill.schema';
import { SkillSuggestion, SkillSuggestionSchema } from '../../schemas/skill-suggestion.schema';
import { Agent, AgentSchema } from '../../../../../src/shared/schemas/agent.schema';
import { MemoModule } from '../memos/memo.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Skill.name, schema: SkillSchema },
      { name: AgentSkill.name, schema: AgentSkillSchema },
      { name: SkillSuggestion.name, schema: SkillSuggestionSchema },
      { name: Agent.name, schema: AgentSchema },
    ]),
    MemoModule,
  ],
  controllers: [SkillController],
  providers: [SkillService, SkillDocSyncService],
  exports: [SkillService],
})
export class SkillModule {}

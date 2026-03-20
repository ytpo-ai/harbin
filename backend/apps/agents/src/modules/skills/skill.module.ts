import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SkillController } from './skill.controller';
import { SkillService } from './skill.service';
import { SkillDocLoaderService } from './skill-doc-loader.service';
import { Skill, SkillSchema } from '../../schemas/agent-skill.schema';
import { Agent, AgentSchema } from '@agent/schemas/agent.schema';
import { MemoModule } from '../memos/memo.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Skill.name, schema: SkillSchema },
      { name: Agent.name, schema: AgentSchema },
    ]),
    MemoModule,
  ],
  controllers: [SkillController],
  providers: [SkillService, SkillDocLoaderService],
  exports: [SkillService],
})
export class SkillModule {}

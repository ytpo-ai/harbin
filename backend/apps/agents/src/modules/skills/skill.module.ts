import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SkillController } from './skill.controller';
import { SkillService } from './skill.service';
import { SkillDocLoaderService } from './skill-doc-loader.service';
import { Skill, SkillSchema } from '../../schemas/agent-skill.schema';
import { Agent, AgentSchema } from '@agent/schemas/agent.schema';
import { MemoModule } from '../memos/memo.module';
import {
  SkillMarketPlatform,
  SkillMarketPlatformSchema,
} from '@agent/schemas/skill-market-platform.schema';
import {
  SkillGithubRepo,
  SkillGithubRepoSchema,
} from '@agent/schemas/skill-github-repo.schema';
import { SkillMarketService } from './skill-market.service';
import { SkillMarketController } from './skill-market.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Skill.name, schema: SkillSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: SkillMarketPlatform.name, schema: SkillMarketPlatformSchema },
      { name: SkillGithubRepo.name, schema: SkillGithubRepoSchema },
    ]),
    MemoModule,
  ],
  controllers: [SkillController, SkillMarketController],
  providers: [SkillService, SkillDocLoaderService, SkillMarketService],
  exports: [SkillService],
})
export class SkillModule {}

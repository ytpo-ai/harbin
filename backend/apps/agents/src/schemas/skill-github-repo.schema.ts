import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export const SKILL_GITHUB_REPO_STATUS = ['pending', 'imported', 'skipped'] as const;

export type SkillGithubRepoStatus = (typeof SKILL_GITHUB_REPO_STATUS)[number];
export type SkillGithubRepoDocument = SkillGithubRepo & Document;

@Schema({ timestamps: true, collection: 'skill_github_repos' })
export class SkillGithubRepo {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ required: true, index: true })
  platformId: string;

  @Prop({ required: true, unique: true, trim: true })
  fullName: string;

  @Prop({ required: true, trim: true })
  url: string;

  @Prop()
  description?: string;

  @Prop({ default: 0 })
  stars: number;

  @Prop()
  language?: string;

  @Prop({ type: [String], default: [] })
  topics: string[];

  @Prop({ required: true, trim: true })
  owner: string;

  @Prop({ required: true })
  indexedAt: Date;

  @Prop({ enum: SKILL_GITHUB_REPO_STATUS, default: 'pending', index: true })
  status: SkillGithubRepoStatus;

  @Prop({ index: true })
  skillId?: string;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const SkillGithubRepoSchema = SchemaFactory.createForClass(SkillGithubRepo);

SkillGithubRepoSchema.index({ platformId: 1, status: 1 });
SkillGithubRepoSchema.index({ fullName: 1 }, { unique: true });
SkillGithubRepoSchema.index({ stars: -1 });

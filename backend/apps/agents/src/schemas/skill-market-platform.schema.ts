import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export const SKILL_MARKET_PLATFORM_STATUS = ['active', 'disabled'] as const;

export type SkillMarketPlatformStatus = (typeof SKILL_MARKET_PLATFORM_STATUS)[number];
export type SkillMarketPlatformDocument = SkillMarketPlatform & Document;

@Schema({ timestamps: true, collection: 'skill_market_platforms' })
export class SkillMarketPlatform {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, trim: true })
  url: string;

  @Prop({ default: 100, index: true })
  priority: number;

  @Prop({ enum: SKILL_MARKET_PLATFORM_STATUS, default: 'active', index: true })
  status: SkillMarketPlatformStatus;

  @Prop()
  description?: string;

  @Prop()
  lastIndexedAt?: Date;

  @Prop({ default: 0 })
  repoCount?: number;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const SkillMarketPlatformSchema = SchemaFactory.createForClass(SkillMarketPlatform);

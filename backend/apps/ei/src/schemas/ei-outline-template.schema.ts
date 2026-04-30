import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EiOutlineTemplateDocument = EiOutlineTemplate & Document;

export type EiOutlineTemplateType = 'industry_observation' | 'product_analysis' | 'technical_review';

@Schema({ timestamps: true, collection: 'ei_outline_templates' })
export class EiOutlineTemplate {
  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  description?: string;

  @Prop({ type: String, enum: ['industry_observation', 'product_analysis', 'technical_review'], required: true })
  templateType: EiOutlineTemplateType;

  @Prop({ type: [String], default: [] })
  applicableIndustries: string[];

  @Prop({ type: [Object], default: [] })
  sections: Array<{
    key?: string;
    title: string;
    description?: string;
    parentSectionKey?: string;
    order: number;
    depth: number;
    metadata?: {
      suggestedDataSources?: string[];
      collectFrequency?: string;
      isStructuredData?: boolean;
    };
  }>;

  @Prop({ type: [Object], default: [] })
  suggestedDataSources: Array<{
    name: string;
    sourceType: 'api' | 'rss' | 'web_scrape' | 'manual';
    config: Record<string, unknown>;
    collectFrequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
  }>;

  @Prop({ type: Boolean, default: false })
  isSystem: boolean;

  @Prop()
  createdBy?: string;
}

export const EiOutlineTemplateSchema = SchemaFactory.createForClass(EiOutlineTemplate);

EiOutlineTemplateSchema.index({ templateType: 1, isSystem: 1 });
EiOutlineTemplateSchema.index({ applicableIndustries: 1 });

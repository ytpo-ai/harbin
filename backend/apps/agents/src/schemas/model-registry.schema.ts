import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ModelRegistryDocument = ModelRegistry & Document;

@Schema({ collection: 'agent_model_registry', timestamps: true })
export class ModelRegistry {
  @Prop({ required: true, unique: true, trim: true })
  id: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ trim: true })
  availability?: string;

  @Prop({ type: Boolean, default: false })
  deprecated?: boolean;

  @Prop({ required: true, lowercase: true, trim: true })
  provider: string;

  @Prop({ required: true, lowercase: true, trim: true })
  model: string;

  @Prop({ type: Number, default: 4096 })
  maxTokens?: number;

  @Prop({ type: Number, default: 0.7 })
  temperature?: number;

  @Prop({ type: Number, default: 1 })
  topP?: number;

  @Prop({
    type: {
      input: { type: Number },
      output: { type: Number },
      cache_read: { type: Number },
      cache_write: { type: Number },
      reasoning: { type: Number },
    },
    _id: false,
    default: undefined,
  })
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    reasoning?: number;
  };

  @Prop({
    type: {
      enabled: { type: Boolean, default: false },
      effort: { type: String, enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      verbosity: { type: String, enum: ['low', 'medium', 'high'] },
    },
    default: undefined,
  })
  reasoning?: {
    enabled: boolean;
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    verbosity?: 'low' | 'medium' | 'high';
  };

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const ModelRegistrySchema = SchemaFactory.createForClass(ModelRegistry);

ModelRegistrySchema.index({ provider: 1, model: 1 }, { unique: true });

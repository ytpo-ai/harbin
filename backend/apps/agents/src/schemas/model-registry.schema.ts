import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ModelRegistryDocument = ModelRegistry & Document;

@Schema({ collection: 'model_registry', timestamps: true })
export class ModelRegistry {
  @Prop({ required: true, unique: true, trim: true })
  id: string;

  @Prop({ required: true, trim: true })
  name: string;

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

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const ModelRegistrySchema = SchemaFactory.createForClass(ModelRegistry);

ModelRegistrySchema.index({ provider: 1, model: 1 }, { unique: true });

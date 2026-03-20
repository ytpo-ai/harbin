import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EiDocsHeatWeight = {
  pattern: string;
  weight: number;
  label?: string;
};

export type EiDocsHeatConfig = {
  weights: EiDocsHeatWeight[];
  excludes: string[];
  defaultWeight: number;
  topN: number;
  updatedAt?: Date;
  updatedBy?: string;
};

export type EiAppConfigDocument = EiAppConfig & Document;

@Schema({ timestamps: true, collection: 'ei_app_configs' })
export class EiAppConfig {
  @Prop({ required: true, unique: true, default: 'default' })
  configId: string;

  @Prop({ type: Object, default: {} })
  docsHeat: EiDocsHeatConfig;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EiAppConfigSchema = SchemaFactory.createForClass(EiAppConfig);

EiAppConfigSchema.index({ configId: 1 }, { unique: true });

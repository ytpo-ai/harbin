import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ToolDocument = Tool & Document;

@Schema({ timestamps: true })
export class Tool {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ index: true })
  canonicalId?: string;

  @Prop({ index: true })
  provider?: string;

  @Prop({ index: true })
  executionChannel?: string;

  @Prop({ index: true })
  toolkitId?: string;

  @Prop({ index: true })
  namespace?: string;

  @Prop()
  resource?: string;

  @Prop()
  action?: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  description: string;

  @Prop({ 
    required: true, 
    enum: ['code_execution', 'web_search', 'file_operation', 'data_analysis', 'video_editing', 'api_call', 'custom'] 
  })
  type: 'code_execution' | 'web_search' | 'file_operation' | 'data_analysis' | 'video_editing' | 'api_call' | 'custom';

  @Prop({ required: true })
  category: string;

  @Prop({ type: [String], default: [] })
  capabilitySet?: string[];

  @Prop({ type: [String], default: [] })
  tags?: string[];

  @Prop({ enum: ['active', 'hidden', 'deprecated'], default: 'active' })
  status?: 'active' | 'hidden' | 'deprecated';

  @Prop({ default: false })
  deprecated?: boolean;

  @Prop()
  replacedBy?: string;

  @Prop({ type: [String], default: [] })
  aliases?: string[];

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ type: Object })
  config?: any;

  @Prop({ type: Object })
  inputSchema?: any;

  @Prop({ type: Object })
  outputSchema?: any;

  @Prop({ type: [{
    id: String,
    name: String,
    description: String,
    level: { type: String, enum: ['basic', 'intermediate', 'advanced', 'admin'] }
  }] })
  requiredPermissions: {
    id: string;
    name: string;
    description: string;
    level: 'basic' | 'intermediate' | 'advanced' | 'admin';
  }[];

  @Prop({ default: 0 })
  tokenCost?: number;

  @Prop({ default: 0 })
  executionTime?: number;

  @Prop({ type: Object, required: false })
  implementation?: {
    type: 'built_in' | 'api_call' | 'script';
    endpoint?: string;
    script?: string;
    parameters: any;
  };
}

export const ToolSchema = SchemaFactory.createForClass(Tool);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DiscussionDocument = Discussion & Document;

@Schema({ timestamps: true })
export class Discussion {
  @Prop()
  id?: string;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
  @Prop({ required: true })
  taskId: string;

  @Prop({ type: [String], required: true })
  participants: string[];

  @Prop({ type: [{
    id: String,
    agentId: String,
    content: String,
    type: { type: String, enum: ['opinion', 'question', 'agreement', 'disagreement', 'suggestion', 'conclusion'] },
    timestamp: Date,
    metadata: Object
  }], default: [] })
  messages: {
    id: string;
    agentId: string;
    content: string;
    type: 'opinion' | 'question' | 'agreement' | 'disagreement' | 'suggestion' | 'conclusion';
    timestamp: Date;
    metadata?: any;
  }[];

  @Prop({ enum: ['active', 'concluded', 'paused'], default: 'active' })
  status: 'active' | 'concluded' | 'paused';
}

export const DiscussionSchema = SchemaFactory.createForClass(Discussion);
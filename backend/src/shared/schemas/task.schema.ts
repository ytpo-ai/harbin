import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TaskDocument = Task & Document;

@Schema({ timestamps: true, collection: 'tasks' })
export class Task {
  @Prop()
  id?: string;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  type: string;

  @Prop({ enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' })
  priority: 'low' | 'medium' | 'high' | 'urgent';

  @Prop({ enum: ['pending', 'in_progress', 'completed', 'failed'], default: 'pending' })
  status: 'pending' | 'in_progress' | 'completed' | 'failed';

  @Prop({ type: [String], default: [] })
  assignedAgents: string[];

  @Prop({ required: true })
  teamId: string;

  @Prop({ type: [{
    role: { type: String, enum: ['user', 'assistant', 'system'] },
    content: String,
    timestamp: Date,
    metadata: Object
  }], default: [] })
  messages: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    metadata?: any;
  }[];

  @Prop()
  result?: string;

  @Prop()
  completedAt?: Date;
}

export const TaskSchema = SchemaFactory.createForClass(Task);

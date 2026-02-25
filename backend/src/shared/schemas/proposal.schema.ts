import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProposalDocument = Proposal & Document;

@Schema({ timestamps: true })
export class Proposal {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ 
    required: true, 
    enum: ['hire', 'fire', 'tool_access', 'strategy', 'budget', 'policy'] 
  })
  type: 'hire' | 'fire' | 'tool_access' | 'strategy' | 'budget' | 'policy';

  @Prop({ required: true })
  proposerId: string;

  @Prop({ 
    required: true, 
    enum: ['proposed', 'voting', 'approved', 'rejected', 'implemented'],
    default: 'proposed' 
  })
  status: 'proposed' | 'voting' | 'approved' | 'rejected' | 'implemented';

  @Prop({ type: [{
    voterId: String,
    shares: Number,
    decision: { type: String, enum: ['for', 'against', 'abstain'] },
    reason: String,
    timestamp: Date
  }] })
  votes: {
    voterId: string;
    shares: number;
    decision: 'for' | 'against' | 'abstain';
    reason: string;
    timestamp: Date;
  }[];

  @Prop({ required: true })
  deadline: Date;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ type: Object })
  metadata?: any;
}

export const ProposalSchema = SchemaFactory.createForClass(Proposal);